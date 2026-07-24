import { PlayprintTracker } from '@playprint/core';
import type { DecisionInput, PlayprintData } from '@playprint/core';
import type {
  BatchDecision,
  DecisionSequenceEntry,
  FetchLike,
  FlushResult,
  IdentityScope,
  IngestEvent,
  MatchContext,
  OpponentType,
  PlayprintClientOptions,
  PlayprintEnvironment,
  WireEnvironment,
} from './types';
import { deriveGameScopedId, hashUserId } from './hash';
import { generateAnonymousId, generateSessionId, sleep } from './utils';

// ── Constants (mirroring the playprint.ai ingest contract) ─────

const DEFAULT_ENDPOINT = 'https://playprint.ai';
const INGEST_PATH = '/api/telemetry/ingest';
const PROFILE_PATH = '/api/telemetry/profile';
const INGEST_SCHEMA_VERSION = '1.1.0';
const DEFAULT_MAPPING_VERSION = '1.0.0';
const MAX_DECISIONS_PER_BATCH = 200;
const MAX_EVENTS_PER_REQUEST = 500;
const DEFAULT_MAX_QUEUE_SIZE = 1000;
const DEFAULT_MAX_DECISIONS_PER_MATCH = 500;
const MAX_DECISION_PAYLOAD_BYTES = 2048;
const MAX_SEND_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 50;

// Anonymous-ID persistence keys. Game scope keys are per-title so persisted
// identities can never link a player across games; the network key is shared
// so opted-in titles CAN share one identity on the device.
const ANON_STORAGE_PREFIX = 'playprint_anon_';
const NETWORK_ANON_STORAGE_KEY = 'playprint_anon_network';
const MIN_ANON_ID_LENGTH = 16; // ingest API minimum for anonymous_user_id

/** Map the documented environment names onto the ingest API's vocabulary. */
const WIRE_ENVIRONMENTS: Record<PlayprintEnvironment, WireEnvironment> = {
  dev: 'dev',
  staging: 'staging',
  production: 'prod',
};

// ── Structural global access (no DOM/Node type dependency) ─────

interface WindowLike {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

interface NavigatorLike {
  sendBeacon?: (url: string, data?: unknown) => boolean;
}

interface GlobalScope {
  window?: WindowLike;
  navigator?: NavigatorLike;
  fetch?: FetchLike;
  Blob?: new (parts: string[], options?: { type?: string }) => unknown;
  setInterval?: (handler: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

function globals(): GlobalScope {
  return globalThis as unknown as GlobalScope;
}

// ── Storage-safe guard (same SSR-safe pattern as core's LocalStorageAdapter) ─

interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Resolve the localStorage global, or null when unavailable (SSR, Node, workers). */
function webStorage(): WebStorageLike | null {
  const g = globalThis as { localStorage?: WebStorageLike };
  try {
    return typeof g.localStorage === 'undefined' || g.localStorage === null
      ? null
      : g.localStorage;
  } catch {
    return null; // access itself can throw (privacy modes)
  }
}

// ── Decision payload bounding ──────────────────────────────────

/** Deep-copy a value, dropping functions (object props and array elements). */
function stripFunctions(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((v) => typeof v !== 'function').map(stripFunctions);
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (typeof val === 'function') continue;
      out[key] = stripFunctions(val);
    }
    return out;
  }
  return value;
}

/**
 * Bound a caller-supplied decision context: strip functions, then cap the
 * serialized size at ~2KB. Oversized or unserializable contexts collapse to
 * a marker object so the entry (and its ordering) is never lost.
 */
function boundDecisionPayload(
  context: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const stripped = stripFunctions(context) as Record<string, unknown>;
  let serialized: string;
  try {
    serialized = JSON.stringify(stripped);
  } catch {
    return { truncated: true }; // circular or otherwise unserializable
  }
  if (serialized.length > MAX_DECISION_PAYLOAD_BYTES) {
    return { truncated: true, original_size: serialized.length };
  }
  return stripped;
}

/**
 * PlayprintClient — the bridge between the `@playprint/core` engine and the
 * hosted playprint.ai platform.
 *
 * Wraps a `PlayprintTracker` for local, offline profiling while shipping the
 * platform's 3-event telemetry stream (`match.start`, `decision.batch`,
 * `match.end`) to `POST /api/telemetry/ingest`, authenticated via the
 * `X-PLAYPRINT-KEY` header.
 *
 * Usage:
 * ```ts
 * const pp = new PlayprintClient({ apiKey: 'pp_live_...', gameId: 'my_game' });
 * pp.startMatch({ opponentType: 'ai' });
 * pp.trackDecision({ label: 'attack' });
 * await pp.endMatch('win');
 * await pp.flush();
 * const profile = await pp.getProfile();
 * ```
 */
export class PlayprintClient {
  private readonly apiKey: string;
  private readonly gameId: string;
  private readonly environment: PlayprintEnvironment;
  private readonly wireEnvironment: WireEnvironment;
  private readonly endpoint: string;
  private readonly fetchFn: FetchLike;
  private readonly maxQueueSize: number;
  private readonly tracker: PlayprintTracker;
  private readonly identityScope: IdentityScope;
  private readonly anonymousUserId: string;
  private readonly sessionId: string;

  private queue: IngestEvent[] = [];
  private flushing = false;
  private flushTimer: unknown = null;
  private pageHideHandler: (() => void) | null = null;
  private currentMatchId: string | null = null;
  private currentOpponentType: OpponentType = 'ai';
  private decisionCounts = new Map<string, number>();
  private readonly aggregate: boolean;
  private readonly maxDecisionsPerMatch: number;
  private decisionLog: DecisionSequenceEntry[] = [];
  private decisionSeq = 0;
  private droppedDecisions = 0;
  private matchStartedAt = 0;

  constructor(options: PlayprintClientOptions) {
    if (!options.apiKey) throw new Error('PlayprintClient requires an apiKey.');
    if (!options.gameId) throw new Error('PlayprintClient requires a gameId.');

    const environment = options.environment ?? 'production';
    if (!(environment in WIRE_ENVIRONMENTS)) {
      throw new Error(
        `Invalid environment: ${environment}. Must be one of: dev, staging, production.`,
      );
    }

    this.apiKey = options.apiKey;
    this.gameId = options.gameId;
    this.environment = environment;
    this.wireEnvironment = WIRE_ENVIRONMENTS[environment];
    this.endpoint = (options.endpoint ?? DEFAULT_ENDPOINT).replace(/\/+$/, '');
    this.maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
    this.aggregate = options.aggregate ?? false;
    this.maxDecisionsPerMatch = Math.max(
      1,
      options.maxDecisionsPerMatch ?? DEFAULT_MAX_DECISIONS_PER_MATCH,
    );
    this.fetchFn =
      options.fetchFn ??
      ((input, init) => {
        const f = globals().fetch;
        if (!f) {
          throw new Error('No global fetch available. Provide options.fetchFn.');
        }
        return f(input, init);
      });

    // Identity scoping. Default 'game': per-game, unlinkable identities —
    // the COPPA-safe posture. 'network' (cross-game Legends) is opt-in.
    const identityScope = options.identityScope ?? 'game';
    if (identityScope !== 'game' && identityScope !== 'network') {
      throw new Error(
        `Invalid identityScope: ${identityScope}. Must be 'game' or 'network'.`,
      );
    }
    this.identityScope = identityScope;

    // Anonymous identity: ≥16 chars as required by the ingest API. Persisted
    // in localStorage by default (per-game key in 'game' scope, shared key in
    // 'network' scope); per-instance when persistence is off or unavailable.
    // Identified players are supported via deriveGameScopedId()/hashUserId().
    this.anonymousUserId =
      options.persistAnonymousId === false
        ? generateAnonymousId()
        : this.loadOrCreateAnonymousId();
    this.sessionId = generateSessionId();

    // Local profiling engine, keyed by the same anonymous identity.
    this.tracker = new PlayprintTracker({
      gameId: this.gameId,
      accountId: this.anonymousUserId,
      storage: options.storage,
    });

    // Periodic flush — unref'd in Node so the timer never keeps the process alive.
    if (options.flushIntervalMs && options.flushIntervalMs > 0) {
      const g = globals();
      if (g.setInterval) {
        const timer = g.setInterval(() => {
          void this.flush();
        }, options.flushIntervalMs);
        (timer as { unref?: () => void } | null)?.unref?.();
        this.flushTimer = timer;
      }
    }

    // Browser page-hide flush via sendBeacon (best effort).
    const win = globals().window;
    if (win && typeof win.addEventListener === 'function') {
      this.pageHideHandler = () => {
        this.flushWithBeacon();
      };
      win.addEventListener('pagehide', this.pageHideHandler);
    }
  }

  // ── Match lifecycle ────────────────────────────────────────

  /**
   * Start a match. Begins local tracking and enqueues a `match.start`
   * ingest event. Returns the match ID.
   */
  startMatch(opts?: {
    matchId?: string;
    opponentType?: OpponentType;
    gamePayload?: Record<string, unknown>;
  }): string {
    const matchId = this.tracker.startMatch({
      matchId: opts?.matchId,
      gamePayload: opts?.gamePayload,
    });
    this.currentMatchId = matchId;
    this.currentOpponentType = opts?.opponentType ?? 'ai';
    this.decisionCounts = new Map();
    this.decisionLog = [];
    this.decisionSeq = 0;
    this.droppedDecisions = 0;
    this.matchStartedAt = Date.now();

    this.enqueue({
      ...this.envelope(),
      event_name: 'match.start',
      match_id: matchId,
      opponent_type: this.currentOpponentType,
      ...(opts?.gamePayload ? { payload: opts.gamePayload } : {}),
    });
    return matchId;
  }

  /**
   * Record a decision. Delegates to the core tracker (tiered input) and, by
   * default, appends an ordered `{seq, t_offset_ms, decision_type, payload}`
   * entry to the per-decision stream shipped at `endMatch()`. `context` is
   * carried verbatim on the entry's `payload` (functions stripped, serialized
   * size capped at ~2KB per decision). Beyond `maxDecisionsPerMatch`
   * (default 500) the OLDEST entries are dropped and reported via
   * `match_context.dropped_count`. With option `{ aggregate: true }` the
   * legacy `(decision_type, count)` aggregation is used instead and
   * `context` only feeds the local tracker path.
   */
  trackDecision(input: DecisionInput, context?: Record<string, unknown>): void {
    this.tracker.decision(input);
    const label = 'label' in input ? input.label : input.decision_type;
    const seq = this.decisionSeq++;
    if (this.aggregate) {
      this.decisionCounts.set(label, (this.decisionCounts.get(label) ?? 0) + 1);
      return;
    }
    const entry: DecisionSequenceEntry = {
      seq,
      t_offset_ms: Math.max(0, Date.now() - this.matchStartedAt),
      decision_type: label,
      value: 1,
      count: 1,
    };
    if (context) {
      const payload = boundDecisionPayload(context);
      if (payload) entry.payload = payload;
    }
    this.decisionLog.push(entry);
    while (this.decisionLog.length > this.maxDecisionsPerMatch) {
      this.decisionLog.shift(); // drop OLDEST beyond cap
      this.droppedDecisions++;
    }
  }

  /**
   * Send a pre-aggregated decision batch (the gameplay-mapping vocabulary).
   * Batches larger than 200 decisions are split to respect the ingest cap.
   * When a match is active, each entry is also recorded on the local tracker.
   */
  trackDecisionBatch(decisions: BatchDecision[], matchContext?: MatchContext): void {
    const matchId = matchContext?.match_id ?? this.currentMatchId;
    if (!matchId) {
      throw new Error(
        'trackDecisionBatch requires an active match or matchContext.match_id.',
      );
    }
    if (decisions.length === 0) return;

    if (this.tracker.isActive()) {
      for (const decision of decisions) {
        this.tracker.decision({ label: decision.decision_type });
      }
    }

    const mappingVersion = matchContext?.mapping_version ?? DEFAULT_MAPPING_VERSION;
    const context: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(matchContext ?? {})) {
      if (key !== 'match_id' && key !== 'mapping_version') context[key] = value;
    }

    for (let i = 0; i < decisions.length; i += MAX_DECISIONS_PER_BATCH) {
      const chunk = decisions.slice(i, i + MAX_DECISIONS_PER_BATCH);
      this.enqueue({
        ...this.envelope(),
        event_name: 'decision.batch',
        match_id: matchId,
        payload: {
          mapping_version: mappingVersion,
          match_context: { ...context, identity_scope: this.identityScope },
          decisions: chunk,
        },
      });
    }
  }

  /**
   * End the match. Enqueues the recorded decision stream as ordered
   * `decision.batch` events (chunked to the ingest's 200-decision cap, with
   * `chunk_index`/`chunk_count` and the final `outcome` in `match_context`
   * so (state, action, outcome) triples are reconstructable server-side) —
   * or a single aggregated batch with option `{ aggregate: true }` — plus a
   * `match.end` event carrying `outcome` and `decision_count`, then
   * finalizes the local match and returns the updated local profile.
   */
  async endMatch(
    result: 'win' | 'loss' | 'draw',
    gamePayload?: Record<string, unknown>,
  ): Promise<PlayprintData> {
    const matchId = this.currentMatchId;
    if (!matchId) {
      throw new Error('Cannot end match: no active match. Call startMatch() first.');
    }

    if (this.aggregate && this.decisionCounts.size > 0) {
      const decisions: BatchDecision[] = [...this.decisionCounts.entries()]
        .slice(0, MAX_DECISIONS_PER_BATCH)
        .map(([decisionType, count]) => ({
          decision_type: decisionType,
          value: count,
          count,
        }));
      this.enqueue({
        ...this.envelope(),
        event_name: 'decision.batch',
        match_id: matchId,
        payload: {
          mapping_version: DEFAULT_MAPPING_VERSION,
          match_context: {
            source: 'sdk_aggregated',
            outcome: result,
            identity_scope: this.identityScope,
          },
          decisions,
        },
      });
    } else if (this.decisionLog.length > 0) {
      const chunkCount = Math.ceil(this.decisionLog.length / MAX_DECISIONS_PER_BATCH);
      const baseContext: Record<string, unknown> = {
        source: 'sdk_sequence',
        outcome: result,
        identity_scope: this.identityScope,
        chunk_count: chunkCount,
        ...(this.droppedDecisions > 0 ? { dropped_count: this.droppedDecisions } : {}),
      };
      for (let i = 0; i < chunkCount; i++) {
        const chunk = this.decisionLog.slice(
          i * MAX_DECISIONS_PER_BATCH,
          (i + 1) * MAX_DECISIONS_PER_BATCH,
        );
        this.enqueue({
          ...this.envelope(),
          event_name: 'decision.batch',
          match_id: matchId,
          payload: {
            mapping_version: DEFAULT_MAPPING_VERSION,
            match_context: { ...baseContext, chunk_index: i },
            decisions: chunk,
          },
        });
      }
    }

    this.enqueue({
      ...this.envelope(),
      event_name: 'match.end',
      match_id: matchId,
      opponent_type: this.currentOpponentType,
      payload: { ...(gamePayload ?? {}), outcome: result, decision_count: this.decisionSeq },
    });

    const profile = await this.tracker.endMatch(result, gamePayload);
    this.currentMatchId = null;
    this.decisionCounts = new Map();
    this.decisionLog = [];
    this.decisionSeq = 0;
    this.droppedDecisions = 0;
    return profile;
  }

  // ── Delivery ───────────────────────────────────────────────

  /**
   * Send all queued events to the hosted ingest endpoint.
   *
   * Retries transient failures with exponential backoff (max 3 attempts per
   * request). On persistent failure, events are requeued — capped at
   * `maxQueueSize` with the OLDEST events dropped first. Permanently rejected
   * requests (4xx other than 408/429) are dropped, not retried.
   */
  async flush(): Promise<FlushResult> {
    const result: FlushResult = { sent: 0, requeued: 0, dropped: 0 };
    if (this.flushing || this.queue.length === 0) return result;

    this.flushing = true;
    const pending = this.queue;
    this.queue = [];
    try {
      for (let i = 0; i < pending.length; i += MAX_EVENTS_PER_REQUEST) {
        const chunk = pending.slice(i, i + MAX_EVENTS_PER_REQUEST);
        const outcome = await this.sendWithRetry(chunk);
        if (outcome === 'sent') {
          result.sent += chunk.length;
        } else if (outcome === 'rejected') {
          result.dropped += chunk.length;
        } else {
          // Transient failure: requeue this chunk and everything after it,
          // ahead of anything enqueued while we were flushing.
          const remaining = pending.slice(i);
          this.queue = [...remaining, ...this.queue];
          const overflow = this.queue.length - this.maxQueueSize;
          if (overflow > 0) {
            this.queue.splice(0, overflow); // drop OLDEST beyond cap
            result.dropped += overflow;
          }
          result.requeued += Math.min(remaining.length, this.queue.length);
          break;
        }
      }
    } finally {
      this.flushing = false;
    }
    return result;
  }

  /**
   * Best-effort synchronous flush via `navigator.sendBeacon`, used on browser
   * page-hide. Returns `false` when sendBeacon is unavailable or refused the
   * payload. Note: sendBeacon cannot set the `X-PLAYPRINT-KEY` header, so this
   * path relies on the server accepting keyless page-hide beacons; prefer
   * `flush()` whenever the page is still alive.
   */
  flushWithBeacon(): boolean {
    if (this.queue.length === 0) return true;
    const nav = globals().navigator;
    if (!nav || typeof nav.sendBeacon !== 'function') return false;

    const events = this.queue.slice(0, MAX_EVENTS_PER_REQUEST);
    const body = JSON.stringify({ events });
    const BlobCtor = globals().Blob;
    const data = BlobCtor ? new BlobCtor([body], { type: 'application/json' }) : body;
    const accepted = nav.sendBeacon(`${this.endpoint}${INGEST_PATH}`, data);
    if (accepted) {
      this.queue = this.queue.slice(events.length);
    }
    return accepted;
  }

  /** Number of ingest events currently queued. */
  get queueSize(): number {
    return this.queue.length;
  }

  /**
   * Stop background work: clears the periodic flush timer and removes the
   * page-hide listener. Queued events remain and can still be flushed manually.
   */
  stop(): void {
    const g = globals();
    if (this.flushTimer !== null) {
      g.clearInterval?.(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pageHideHandler && g.window) {
      g.window.removeEventListener('pagehide', this.pageHideHandler);
      this.pageHideHandler = null;
    }
  }

  // ── Profiles ───────────────────────────────────────────────

  /**
   * Fetch the hosted profile (traits, Legend presentation, skills, ghost
   * biases) from `GET /api/telemetry/profile`.
   *
   * @param userId - Raw user ID; hashed before the request. In the default
   *   `'game'` identity scope the hash is game-scoped via
   *   `deriveGameScopedId(userId, gameId)`; in `'network'` scope it is the
   *   unscoped `hashUserId(userId)` (legacy behavior). Omit to look up this
   *   client's generated anonymous identity.
   * @returns Parsed profile JSON, or `null` when no profile exists (404).
   */
  async getProfile(userId?: string): Promise<Record<string, unknown> | null> {
    const anonymousUserId = userId
      ? this.identityScope === 'game'
        ? await deriveGameScopedId(userId, this.gameId)
        : await hashUserId(userId)
      : this.anonymousUserId;
    const url =
      `${this.endpoint}${PROFILE_PATH}` +
      `?game_id=${encodeURIComponent(this.gameId)}` +
      `&anonymous_user_id=${encodeURIComponent(anonymousUserId)}`;
    const res = await this.fetchFn(url, {
      method: 'GET',
      headers: { 'X-PLAYPRINT-KEY': this.apiKey },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Profile request failed with status ${res.status}.`);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  /**
   * Compute the local profile from stored matches via `@playprint/core`'s
   * `extractProfile()` — works fully offline, no backend required.
   */
  async getLocalProfile(): Promise<PlayprintData> {
    return this.tracker.getProfile();
  }

  /** The generated anonymous user ID used for ingest events. */
  getAnonymousUserId(): string {
    return this.anonymousUserId;
  }

  /** The configured (documented) environment name. */
  getEnvironment(): PlayprintEnvironment {
    return this.environment;
  }

  /**
   * The configured identity scope: `'game'` (default — per-game, unlinkable
   * identities) or `'network'` (opt-in cross-game identity). Also emitted as
   * `identity_scope` in the `match_context` of `decision.batch` events so the
   * platform can verify and enforce it server-side.
   */
  getIdentityScope(): IdentityScope {
    return this.identityScope;
  }

  // ── Private helpers ────────────────────────────────────────

  /** localStorage key for the persisted anonymous ID, per identity scope. */
  private anonymousIdStorageKey(): string {
    return this.identityScope === 'network'
      ? NETWORK_ANON_STORAGE_KEY
      : `${ANON_STORAGE_PREFIX}${this.gameId}`;
  }

  /**
   * Load the persisted anonymous ID for this client's scope, generating and
   * persisting a fresh one when absent. Falls back to a per-instance ID when
   * storage is unavailable (SSR/Node) or blocked. Stored values shorter than
   * the ingest minimum are ignored and replaced.
   */
  private loadOrCreateAnonymousId(): string {
    const store = webStorage();
    const key = this.anonymousIdStorageKey();
    if (store) {
      try {
        const existing = store.getItem(key);
        if (typeof existing === 'string' && existing.length >= MIN_ANON_ID_LENGTH) {
          return existing;
        }
      } catch {
        // Read blocked — fall through to a fresh identity.
      }
    }
    const generated = generateAnonymousId();
    if (store) {
      try {
        store.setItem(key, generated);
      } catch {
        // Storage full/blocked — per-session identity only.
      }
    }
    return generated;
  }

  private envelope(): Omit<IngestEvent, 'event_name'> {
    return {
      schema_version: INGEST_SCHEMA_VERSION,
      timestamp_client: new Date().toISOString(),
      game_id: this.gameId,
      environment: this.wireEnvironment,
      anonymous_user_id: this.anonymousUserId,
      session_id: this.sessionId,
    };
  }

  private enqueue(event: IngestEvent): void {
    this.queue.push(event);
    while (this.queue.length > this.maxQueueSize) {
      this.queue.shift(); // drop OLDEST beyond cap
    }
  }

  private async sendWithRetry(
    events: IngestEvent[],
  ): Promise<'sent' | 'rejected' | 'failed'> {
    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 2));
      }
      try {
        const res = await this.fetchFn(`${this.endpoint}${INGEST_PATH}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-PLAYPRINT-KEY': this.apiKey,
          },
          body: JSON.stringify({ events }),
          keepalive: true,
        });
        if (res.ok) return 'sent';
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          // Invalid payload or auth — retrying would poison the queue forever.
          return 'rejected';
        }
      } catch {
        // Network error — retry.
      }
    }
    return 'failed';
  }
}
