import type {
  TrackerOptions,
  TelemetryEvent,
  DecisionInput,
  DecisionPayload,
  PlayprintData,
  MatchRecord,
  StorageAdapter,
  ExtractionOptions,
  EventSanitizer,
  ExportedPlayerData,
  DeletionResult,
  GameModule,
} from './types';
import { InMemoryStorage } from './storage';
import { inferRisk, inferTags, defaultComputeTempo } from './inference';
import { extractProfile } from './extraction';
import { uuid, now, clamp } from './utils';

const DEFAULT_SCHEMA_VERSION = '1.0';
const DEFAULT_MAX_EVENTS = 200;
const DEFAULT_MIN_MATCHES = 5;

/**
 * PlayprintTracker — main API surface for recording match telemetry.
 *
 * Usage:
 *   const tracker = new PlayprintTracker({ gameId: 'my_game' });
 *   tracker.startMatch();
 *   tracker.decision({ label: 'attack' });
 *   tracker.outcome({ type: 'hit', delta: 0.3 });
 *   const profile = await tracker.endMatch('win');
 */
export class PlayprintTracker {
  private readonly gameId: string;
  private readonly accountId: string;
  private readonly anonymousId: string;
  private readonly schemaVersion: string;
  private readonly storage: StorageAdapter;
  private readonly riskMap?: Record<string, number>;
  private readonly computeTempo: (seq: number) => 'early' | 'mid' | 'late';
  private readonly bluffTag: string;
  private readonly patternBreakTag: string;
  private readonly maxEvents: number;
  private readonly minMatches: number;
  private readonly maxMatches?: number;
  private readonly extensionExtractors?: Record<string, (matches: MatchRecord[]) => unknown>;
  private readonly sanitize?: EventSanitizer;

  private events: TelemetryEvent[] = [];
  private sequence = 0;
  private matchId = '';
  private active = false;

  constructor(options: TrackerOptions) {
    this.gameId = options.gameId;
    this.accountId = options.accountId ?? '';
    // Anonymous players get a unique per-tracker temporary ID so their data
    // never collides with other anonymous players in shared storage.
    this.anonymousId = uuid();
    this.schemaVersion = options.schemaVersion ?? DEFAULT_SCHEMA_VERSION;
    this.storage = options.storage ?? new InMemoryStorage();
    this.riskMap = options.riskMap;
    this.computeTempo = options.computeTempo ?? defaultComputeTempo;
    this.bluffTag = options.bluffTag ?? 'heavy_bluff';
    this.patternBreakTag = options.patternBreakTag ?? 'pattern_break';
    this.maxEvents = options.maxEventsPerMatch ?? DEFAULT_MAX_EVENTS;
    this.minMatches = options.minMatchesForProfile ?? DEFAULT_MIN_MATCHES;
    this.maxMatches = options.maxMatches;
    this.extensionExtractors = options.extensionExtractors;
    this.sanitize = options.sanitize;
  }

  /**
   * Start a new match. Resets event buffer and sequence counter.
   * Throws if a match is already active — call endMatch() or discardMatch() first.
   * Returns the generated match ID.
   */
  startMatch(opts?: {
    matchId?: string;
    gamePayload?: Record<string, unknown>;
  }): string {
    if (this.active) {
      throw new Error(
        'Cannot start match: a match is already active. Call endMatch() or discardMatch() first.',
      );
    }

    this.events = [];
    this.sequence = 0;
    this.matchId = opts?.matchId ?? uuid();
    this.active = true;

    this.pushEvent('match.start', undefined, undefined, opts?.gamePayload);
    return this.matchId;
  }

  /** Discard the current match without saving. Resets the tracker. */
  discardMatch(): void {
    this.events = [];
    this.sequence = 0;
    this.matchId = '';
    this.active = false;
  }

  /** Record a decision event. Accepts tiered input. */
  decision(input: DecisionInput): void {
    if (!this.active) {
      throw new Error('Cannot record decision: no active match. Call startMatch() first.');
    }

    const resolved = this.resolveDecision(input);
    const gamePayload = 'gamePayload' in input ? input.gamePayload : undefined;
    this.pushEvent('decision', resolved, undefined, gamePayload);
  }

  /** Emit a custom event (for game-specific event types like communication). */
  emit(eventName: string, gamePayload?: Record<string, unknown>): void {
    if (!this.active) {
      throw new Error('Cannot emit event: no active match. Call startMatch() first.');
    }
    this.pushEvent(eventName, undefined, undefined, gamePayload);
  }

  /** Record an outcome event. */
  outcome(input: {
    type: string;
    delta: number;
    attribution?: string;
    gamePayload?: Record<string, unknown>;
  }): void {
    if (!this.active) {
      throw new Error('Cannot record outcome: no active match. Call startMatch() first.');
    }

    if (!Number.isFinite(input.delta)) {
      throw new Error(`Invalid outcome delta: ${input.delta}. Must be a finite number.`);
    }

    this.pushEvent(
      'outcome',
      undefined,
      {
        outcome_type: input.type,
        delta: input.delta,
        attribution: input.attribution,
      },
      input.gamePayload,
    );
  }

  /**
   * End the current match. Saves the match record via storage,
   * then extracts and returns the updated profile.
   */
  async endMatch(
    result: 'win' | 'loss' | 'draw',
    gamePayload?: Record<string, unknown>,
  ): Promise<PlayprintData> {
    if (!this.active) {
      throw new Error('Cannot end match: no active match. Call startMatch() first.');
    }

    this.pushEvent('match.end', undefined, undefined, gamePayload);
    this.active = false;

    const match: MatchRecord = {
      matchId: this.matchId,
      result,
      events: [...this.events],
    };

    const accountId = this.accountId || this.anonymousId;
    await this.storage.saveMatch(accountId, match);

    const allMatches = await this.storage.loadMatches(accountId);
    const profile = extractProfile(allMatches, this.extractionOptions());

    await this.storage.saveProfile(accountId, profile);
    return profile;
  }

  /** Get a copy of the current match's events. */
  getEvents(): TelemetryEvent[] {
    return [...this.events];
  }

  /** Compute profile from all stored matches. */
  async getProfile(): Promise<PlayprintData> {
    const accountId = this.accountId || this.anonymousId;
    const allMatches = await this.storage.loadMatches(accountId);
    return extractProfile(allMatches, this.extractionOptions());
  }

  /** Whether a match is currently in progress. */
  isActive(): boolean {
    return this.active;
  }

  /** Whether enough matches have been recorded for a meaningful profile. */
  async isProfileReady(): Promise<boolean> {
    const accountId = this.accountId || this.anonymousId;
    const matches = await this.storage.loadMatches(accountId);
    return matches.length >= this.minMatches;
  }

  // ── Data portability (GDPR) ────────────────────────────────

  /**
   * Export all stored data for this account in a portable format.
   * Satisfies GDPR Article 20 (right to data portability).
   */
  async exportData(): Promise<ExportedPlayerData> {
    const accountId = this.accountId || this.anonymousId;
    const matches = await this.storage.loadMatches(accountId);
    const profile = await this.storage.loadProfile(accountId);

    return {
      accountId,
      exportedAt: now(),
      schemaVersion: DEFAULT_SCHEMA_VERSION,
      matches,
      profile,
    };
  }

  /**
   * Delete all stored data for this account.
   * Satisfies GDPR Article 17 (right to erasure).
   *
   * If a match is currently active, it is discarded before deletion.
   * Returns a summary of what was deleted.
   */
  async deleteData(): Promise<DeletionResult> {
    if (this.active) {
      this.discardMatch();
    }

    const accountId = this.accountId || this.anonymousId;
    const matches = await this.storage.loadMatches(accountId);
    const profile = await this.storage.loadProfile(accountId);

    const result: DeletionResult = {
      accountId,
      deletedAt: now(),
      matchesDeleted: matches.length,
      profileDeleted: profile !== null,
    };

    await this.storage.clear(accountId);
    return result;
  }

  // ── Private helpers ────────────────────────────────────────

  private extractionOptions(): ExtractionOptions {
    return {
      bluffTag: this.bluffTag,
      patternBreakTag: this.patternBreakTag,
      maxMatches: this.maxMatches,
      extensionExtractors: this.extensionExtractors,
    };
  }

  private resolveDecision(input: DecisionInput): DecisionPayload {
    // Tier 3: full DecisionPayload (has decision_type)
    if ('decision_type' in input) {
      return {
        decision_type: input.decision_type,
        risk: clamp(input.risk, 0, 1),
        information: clamp(input.information, 0, 1),
        tempo: input.tempo ?? this.computeTempo(this.sequence),
        intent_tags: input.intent_tags,
      };
    }

    // Tier 2: label + explicit risk/information
    if ('risk' in input && 'information' in input) {
      return {
        decision_type: input.label,
        risk: clamp(input.risk, 0, 1),
        information: clamp(input.information, 0, 1),
        tempo: this.computeTempo(this.sequence),
        intent_tags: inferTags(input.label),
      };
    }

    // Tier 1: label only — inferRisk already returns [0,1]
    const risk = inferRisk(input.label, this.riskMap);
    return {
      decision_type: input.label,
      risk,
      information: 0.5,
      tempo: this.computeTempo(this.sequence),
      intent_tags: inferTags(input.label),
    };
  }

  private pushEvent(
    eventName: string,
    decision?: DecisionPayload,
    outcome?: { outcome_type: string; delta: number; attribution?: string },
    gamePayload?: Record<string, unknown>,
  ): void {
    let event: TelemetryEvent | null = {
      event_id: uuid(),
      event_name: eventName,
      schema_version: this.schemaVersion,
      timestamp: now(),
      match_id: this.matchId,
      game_id: this.gameId,
      sequence: this.sequence++,
    };

    if (this.accountId) event.account_id = this.accountId;
    if (decision) event.decision = decision;
    if (outcome) event.outcome = outcome;
    if (gamePayload) event.game_payload = gamePayload;

    // Apply sanitizer if configured — sanitizer can redact fields or drop events
    if (this.sanitize) {
      event = this.sanitize(event);
      if (!event) return;
    }

    // Buffer at capacity: drop the OLDEST event so late events
    // (e.g. match.end) are never lost.
    if (this.events.length >= this.maxEvents) {
      this.events.shift();
    }

    this.events.push(event);
  }
}

// ── Standalone GDPR utilities ─────────────────────────────────

/**
 * Export all stored data for an account from any StorageAdapter.
 * Standalone version — use when you don't have a tracker instance.
 */
export async function exportPlayerData(
  storage: StorageAdapter,
  accountId: string,
): Promise<ExportedPlayerData> {
  const matches = await storage.loadMatches(accountId);
  const profile = await storage.loadProfile(accountId);

  return {
    accountId,
    exportedAt: now(),
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    matches,
    profile,
  };
}

/**
 * Delete all stored data for an account from any StorageAdapter.
 * Standalone version — use when you don't have a tracker instance.
 */
export async function deletePlayerData(
  storage: StorageAdapter,
  accountId: string,
): Promise<DeletionResult> {
  const matches = await storage.loadMatches(accountId);
  const profile = await storage.loadProfile(accountId);

  const result: DeletionResult = {
    accountId,
    deletedAt: now(),
    matchesDeleted: matches.length,
    profileDeleted: profile !== null,
  };

  await storage.clear(accountId);
  return result;
}

// ── Tracker factory ───────────────────────────────────────────

/**
 * Create a `PlayprintTracker` pre-configured from a `GameModule`.
 *
 * Extracts `gameId`, `schemaVersion`, `riskMap`, `computeTempo`, `bluffTag`, `patternBreakTag`,
 * and `extensionExtractors` from the module. Additional options can be provided
 * to override or supplement the module's defaults.
 *
 * Example:
 * ```ts
 * const tracker = createTracker(shadowHandsModule, { accountId: 'user-123' });
 * ```
 */
export function createTracker(
  module: GameModule<any>,
  opts?: Partial<TrackerOptions>,
): PlayprintTracker {
  return new PlayprintTracker({
    gameId: module.gameId,
    schemaVersion: module.schemaVersion,
    riskMap: module.riskMap,
    computeTempo: module.computeTempo,
    bluffTag: module.bluffTag,
    patternBreakTag: module.patternBreakTag,
    extensionExtractors: module.extensionExtractors,
    ...opts,
  });
}
