// ── Event types ────────────────────────────────────────────────

/** A single telemetry event recorded during a match. */
export interface TelemetryEvent {
  /** Unique identifier for this event. */
  event_id: string;
  /** Event type. Standard events: `'match.start'`, `'decision'`, `'outcome'`, `'match.end'`. */
  event_name: 'match.start' | 'decision' | 'outcome' | 'match.end' | string;
  /** Schema version string (e.g. `'1.0'`). */
  schema_version: string;
  /** ISO 8601 timestamp of when the event was recorded. */
  timestamp: string;
  /** Optional player account identifier. */
  account_id?: string;
  /** Unique identifier for the match this event belongs to. */
  match_id: string;
  /** Identifier for the game (e.g. `'shadow_hands'`). */
  game_id: string;
  /** Zero-based sequence number within the match. */
  sequence: number;
  /** Arbitrary game-specific data attached to this event. */
  game_payload?: Record<string, unknown>;
  /** Optional metadata (e.g. client version, platform). */
  metadata?: Record<string, unknown>;
  /** Decision data, present when `event_name === 'decision'`. */
  decision?: DecisionPayload;
  /** Outcome data, present when `event_name === 'outcome'`. */
  outcome?: OutcomePayload;
}

// ── Decision model ─────────────────────────────────────────────

/** Full decision payload (Tier 3 input). */
export interface DecisionPayload {
  /** Label categorizing the decision (e.g. `'attack'`, `'defend'`, `'bluff'`). */
  decision_type: string;
  /** Risk level of this decision, normalized to `[0, 1]`. `0` = safe, `1` = maximum risk. */
  risk: number;
  /** How much information the player had when deciding. `0` = blind, `1` = full info. */
  information: number;
  /** Game phase when the decision was made. */
  tempo?: 'early' | 'mid' | 'late';
  /** Tags describing the intent behind the decision (e.g. `['aggressive', 'heavy_bluff']`). */
  intent_tags?: string[];
}

// ── Outcome model ──────────────────────────────────────────────

/** Records the result of a decision or turn. */
export interface OutcomePayload {
  /** Label categorizing the outcome (e.g. `'hit'`, `'block'`, `'crit'`). */
  outcome_type: string;
  /** Normalized change in game state. Positive = favorable, negative = unfavorable. */
  delta: number;
  /** What caused the outcome (e.g. a card name, ability, or event). */
  attribution?: string;
}

// ── Tiered decision input ──────────────────────────────────────

/**
 * Input for `tracker.decision()`. Supports three tiers of detail:
 *
 * - **Tier 1**: `{ label }` — risk inferred automatically from label keywords.
 * - **Tier 2**: `{ label, risk, information }` — you compute risk and info values.
 * - **Tier 3**: Full `DecisionPayload` — complete control over all fields.
 */
export type DecisionInput =
  | { label: string; gamePayload?: Record<string, unknown> }
  | { label: string; risk: number; information: number; gamePayload?: Record<string, unknown> }
  | DecisionPayload & { gamePayload?: Record<string, unknown> };

// ── Profile ────────────────────────────────────────────────────

/**
 * Aggregated behavioral profile extracted from match history.
 *
 * All numeric fields are normalized to `[0, 1]` unless noted otherwise.
 * This is the core data structure that feeds into ghost AI, archetypes, and traits.
 *
 * @typeParam TExt - Type of game-specific extension data. Defaults to `Record<string, unknown>`.
 *   Narrow this to get typed access to extensions: `PlayprintData<ShadowHandsExtensions>`.
 */
export interface PlayprintData<TExt = Record<string, unknown>> {
  /** Mean aggression across all decisions. `0` = passive, `1` = aggressive. */
  aggression: number;
  /** Standard deviation of per-match aggression values. Higher = more volatile. */
  aggressionStdDev: number;
  /** How much the player seeks information before acting. `0` = blind, `1` = informed. */
  informationPreference: number;
  /** Fraction of decisions made in the early game phase. */
  tempoEarly: number;
  /** Fraction of decisions made in the mid game phase. */
  tempoMid: number;
  /** Fraction of decisions made in the late game phase. */
  tempoLate: number;
  /** Rate of decisions tagged as bluffs. */
  bluffRate: number;
  /** Rate of decisions that break established patterns. */
  patternBreakRate: number;
  /** Average risk level when the player is winning. */
  riskWhenWinning: number;
  /** Average risk level when the player is losing. */
  riskWhenLosing: number;
  /** Rate of wins in matches where the player was losing at some point. */
  comebackRate: number;
  /** Turn-to-turn counterplay rate: how often the player wins a round immediately after losing one. */
  counterplayRate: number;
  /** Shannon entropy of decision types, normalized to [0, 1]. Measures how broadly the player uses different action types. */
  decisionTypeDiversity?: number;
  /**
   * How front-loaded the player's risk-taking is within a match, in [0, 1].
   * 0.5 = evenly spread; > 0.5 = takes risks early; < 0.5 = escalates late.
   * Computed per-match from relative position (first half vs second half of
   * decisions), so it is invariant to match length. Feeds the `urgent` trait.
   */
  riskFrontloading?: number;
  /**
   * Evidence confidence in [0, 1), growing with `totalDecisions`.
   * Consumers (archetypes, ghosts, calibration) can use this to treat
   * low-evidence profiles as neutral rather than extreme.
   */
  confidence?: number;
  /** Total number of decisions recorded across all matches. */
  totalDecisions: number;
  /** Total number of matches recorded. */
  totalMatches: number;
  /** Version of the profile model that produced this profile (see `PROFILE_MODEL_VERSION`). */
  profileModelVersion?: number;
  /** ISO 8601 timestamp of when this profile was extracted. */
  generatedAt?: string;
  /** Game-specific extension data from custom extractors. */
  extensions?: TExt;
}

// ── Match record ───────────────────────────────────────────────

/** A completed match with its telemetry events. */
export interface MatchRecord {
  /** Unique identifier for this match. */
  matchId: string;
  /** Match result from the player's perspective. */
  result: 'win' | 'loss' | 'draw';
  /** All telemetry events recorded during this match, in order. */
  events: TelemetryEvent[];
}

// ── Ghost biases ───────────────────────────────────────────────

/**
 * Five abstract bias weights that define a ghost AI's personality.
 *
 * All values are normalized to `[0, 1]`. Use `mapGhostBiases()` to convert
 * these into game-specific AI parameters via linear interpolation.
 */
export interface GhostBiases {
  /** How aggressively the ghost plays. `0` = passive, `1` = all-out attack. */
  aggression: number;
  /** How patiently the ghost waits for opportunities. Derived as `1 - aggression`. */
  patience: number;
  /** Willingness to take risks. Average of `riskWhenWinning` and `riskWhenLosing`. */
  riskTolerance: number;
  /** How consistent the ghost's play style is. Derived as `1 - aggressionStdDev`. */
  consistency: number;
  /** How deceptive the ghost is. Average of `bluffRate` and `patternBreakRate`. */
  deception: number;
}

// ── Ghost Decision Engine ────────────────────────────────────────

/**
 * Game-agnostic interface for state-conditioned ghost AI.
 *
 * Games implement this to map their game states to action probability
 * distributions. The SDK provides `sampleFromDistribution()` as a
 * generic sampling utility.
 *
 * @typeParam TState - The game's state representation
 * @typeParam TAction - The game's action type (e.g. string union or enum)
 *
 * Example (Shadow Hands):
 * ```ts
 * const engine: GhostDecisionEngine<AiContext, 'ROCK'|'PAPER'|'SCISSORS'> = {
 *   categorizeState(ctx) {
 *     return `${computeAdvantageBucket(ctx)}:${computeTempo(ctx.round)}`;
 *   },
 *   getActionDistribution(bucket, ghost) {
 *     const table = lookupTable[bucket];
 *     return table ?? { ROCK: 0.33, PAPER: 0.33, SCISSORS: 0.33 };
 *   },
 * };
 * ```
 */
export interface GhostDecisionEngine<TState, TAction extends string> {
  /**
   * Categorize a game state into a bucket key string.
   * The key should be broad enough to generalize but specific enough
   * to capture meaningful behavioral differences.
   */
  categorizeState(state: TState): string;

  /**
   * Return an action probability distribution for a given state bucket.
   * Values should be non-negative and ideally sum to ~1.0
   * (they'll be normalized during sampling regardless).
   */
  getActionDistribution(
    bucket: string,
    ghost: GhostBiases,
  ): Record<TAction, number>;
}

// ── Data portability (GDPR) ─────────────────────────────────────

/**
 * Portable data export for a player account.
 *
 * Contains all stored data in a self-describing format suitable for
 * GDPR Article 20 (right to data portability) compliance.
 */
export interface ExportedPlayerData {
  /** Account identifier for this export. */
  accountId: string;
  /** ISO 8601 timestamp of when this export was generated. */
  exportedAt: string;
  /** Schema version of the export format. */
  schemaVersion: string;
  /** All match records stored for this account. */
  matches: MatchRecord[];
  /** Extracted behavioral profile, or `null` if none exists. */
  profile: PlayprintData | null;
}

/**
 * Result of a data deletion request.
 */
export interface DeletionResult {
  /** Account identifier that was deleted. */
  accountId: string;
  /** ISO 8601 timestamp of when the deletion was performed. */
  deletedAt: string;
  /** Number of match records that were deleted. */
  matchesDeleted: number;
  /** Whether a profile was deleted. */
  profileDeleted: boolean;
}

// ── Archetype ──────────────────────────────────────────────────

/** Simple archetype classification based on aggression and deception thresholds. */
export interface Archetype {
  /** Primary archetype based on aggression level. */
  name: 'Reckless' | 'Calculated' | 'Patient' | 'Cautious';
  /** Optional modifier applied when deception (bluff + pattern break) is high. */
  modifier?: 'Deceiver';
}

// ── Storage adapter ────────────────────────────────────────────

/**
 * Interface for persisting match records and profiles.
 *
 * Implement this to store data in your backend, localStorage, IndexedDB, etc.
 * The SDK ships with `InMemoryStorage` and `LocalStorageAdapter` as reference implementations.
 */
export interface StorageAdapter {
  /** Save a completed match record. */
  saveMatch(accountId: string, match: MatchRecord): Promise<void>;
  /** Load all match records for an account. */
  loadMatches(accountId: string): Promise<MatchRecord[]>;
  /** Save an extracted profile. */
  saveProfile(accountId: string, profile: PlayprintData): Promise<void>;
  /** Load a previously saved profile, or `null` if none exists. */
  loadProfile(accountId: string): Promise<PlayprintData | null>;
  /** Clear all stored data for an account. */
  clear(accountId: string): Promise<void>;
}

// ── Tracker options ────────────────────────────────────────────

/**
 * Event sanitizer function.
 *
 * Called on every telemetry event before it's buffered. Use this to strip
 * PII or other sensitive data from `game_payload` and `metadata` fields.
 * Return the sanitized event, or `null` to drop it entirely.
 */
export type EventSanitizer = (event: TelemetryEvent) => TelemetryEvent | null;

/** Configuration for `PlayprintTracker`. */
export interface TrackerOptions {
  /** Unique identifier for your game (e.g. `'shadow_hands'`). */
  gameId: string;
  /** Player account ID. If omitted, a temporary ID is generated. */
  accountId?: string;
  /** Schema version stamped on telemetry events. Defaults to `'1.0'`. */
  schemaVersion?: string;
  /** Storage backend for persisting matches and profiles. Defaults to `InMemoryStorage`. */
  storage?: StorageAdapter;
  /** Custom label-to-risk mapping for Tier 1 decisions. Merged with `DEFAULT_RISK_MAP`. */
  riskMap?: Record<string, number>;
  /** Custom function to compute tempo phase from sequence number. */
  computeTempo?: (seq: number) => 'early' | 'mid' | 'late';
  /** Intent tag that marks a decision as a bluff (default: `'heavy_bluff'`). */
  bluffTag?: string;
  /** Intent tag that marks a decision as a pattern break (default: `'pattern_break'`). */
  patternBreakTag?: string;
  /** Maximum events to record per match. Older events are dropped. */
  maxEventsPerMatch?: number;
  /** Minimum matches required before `extractProfile()` produces results. */
  minMatchesForProfile?: number;
  /** Maximum matches to consider during profile extraction (most recent). */
  maxMatches?: number;
  /** Custom extractors that produce game-specific extension data from match history. */
  extensionExtractors?: Record<string, (matches: MatchRecord[]) => unknown>;
  /**
   * Event sanitizer — called on every event before it's buffered.
   * Use `stripKnownPii` for a sensible default, or provide your own.
   */
  sanitize?: EventSanitizer;
}

// ── Extraction options ─────────────────────────────────────────

/** Options for standalone `extractProfile()` calls. */
export interface ExtractionOptions {
  /** Intent tag that marks a decision as a bluff. */
  bluffTag?: string;
  /** Intent tag that marks a decision as a pattern break. */
  patternBreakTag?: string;
  /** Maximum matches to consider (most recent). */
  maxMatches?: number;
  /** Custom extractors that produce game-specific extension data. */
  extensionExtractors?: Record<string, (matches: MatchRecord[]) => unknown>;
  /** Expected schema version string. Events with a different version trigger `onVersionMismatch`. */
  expectedSchemaVersion?: string;
  /** Called for each event whose `schema_version` differs from `expectedSchemaVersion`. */
  onVersionMismatch?: (actual: string, expected: string) => void;
  /**
   * The game's declared decision-type vocabulary (e.g. every `decision_type`
   * the game can emit). When provided, `decisionTypeDiversity` is computed
   * with Laplace smoothing over this fixed vocabulary instead of only the
   * observed types — so a single rare event type no longer flips the
   * normalization denominator. Games typically pass
   * `GameModule.decisionTypes` (or `Object.keys(module.decisionCategories)`).
   */
  decisionTypeVocabulary?: string[];
}

// ── Generative archetype types ───────────────────────────────────

/** A trait profile: keys are trait names, values are normalized 0-1. */
export type TraitProfile = Record<string, number>;

/** The 6 canonical trait keys used in the v2 playstyle model. */
export type CanonicalTrait =
  | 'aggressive' | 'bold' | 'deceptive'
  | 'chaotic' | 'urgent' | 'expansive';

/** Rich, composable personality description generated from a trait profile. */
export interface GenerativeArchetypeResult {
  /** Primary archetype label (e.g. `'Berserker'`, `'Ghost'`, `'Architect'`). One of 18 possible values. */
  coreArchetype: string;
  /** Adjective modifier from second-strongest trait (e.g. `'Fierce'`, `'Cautious'`). */
  styleModifier: string;
  /** 2-word compound name: style modifier + core archetype (e.g. `'Fierce Berserker'`). */
  displayName: string;
  /** Individual words that make up the handle (e.g. `['Fierce', 'Daring', 'Chaotic']`). */
  handleWords: string[];
  /** Rhythm descriptor when tempo isn't used as core/modifier. `null` if tempo was already used. */
  tempoTag: string | null;
  /** 0-3 contextual behavior phrases triggered by multi-trait combinations. */
  behaviors: string[];
  /** One-sentence personality summary, deterministically selected from templates. */
  tagline: string;
}

// ── Presentation types ───────────────────────────────────────────

/** Definition for a single trait's player-facing presentation. */
export interface TraitDefinition {
  /** Display name (e.g. `'Aggressive'`). */
  name: string;
  /** Player-facing description of what this trait means. */
  description: string;
  /** Coaching tip shown to help the player grow this trait. */
  tip?: string;
  /** Key for looking up an icon in your UI layer. */
  iconKey?: string;
  /** Label for the low end of this trait (e.g. `'Defensive'`). */
  lowMeaning?: string;
  /** Label for the high end of this trait (e.g. `'Presses conflict'`). */
  highMeaning?: string;
}

/** A single trait ready for UI rendering. */
export interface TraitPresentation {
  /** Internal trait key (e.g. `'aggression'`). */
  key: string;
  /** Display name (e.g. `'Ferocity'`). */
  name: string;
  /** Normalized value, clamped to `[0, 1]`. */
  value: number;
  /** Player-facing description. */
  description: string;
  /** Coaching tip. */
  tip?: string;
  /** Icon key for UI rendering. */
  iconKey?: string;
}

/** A single skill ready for UI rendering. */
export interface SkillPresentation {
  /** Internal skill key (e.g. `'accuracy'`). */
  key: string;
  /** Display name (e.g. `'Precision'`). */
  name: string;
  /** Normalized value, clamped to `[0, 1]`. */
  value: number;
  /** Player-facing description. */
  description: string;
  /** Coaching tip. */
  tip?: string;
  /** Icon key for UI rendering. */
  iconKey?: string;
}

/** Complete Legend presentation ready for UI rendering. */
export interface LegendPresentationResult {
  /** Generated title (e.g. `'Fierce Strategist'`). */
  title: string;
  /** All traits with display metadata, sorted by display order. */
  traits: TraitPresentation[];
  /** Optional skills with display metadata. */
  skills?: SkillPresentation[];
  /** Rich archetype description (included by default). */
  archetype?: GenerativeArchetypeResult;
  /** Privacy/safety note (e.g. "Based on gameplay only"). */
  safetyNote: string;
  /** Note explaining that the Legend evolves with play. */
  trainingNote: string;
}

/** Per-trait overrides for presentation. */
export type PresentationOverrides = Record<string, Partial<TraitDefinition>>;

/** Options for `getLegendPresentation()`. */
export interface PresentationOptions {
  /** Override default trait/skill definitions. */
  overrides?: PresentationOverrides;
  /** Additional game-specific skill definitions. */
  extraSkills?: Record<string, TraitDefinition>;
  /** Custom safety note. */
  safetyNote?: string;
  /** Custom training note. */
  trainingNote?: string;
  /** Whether to include the generative archetype. Default: `true`. */
  includeArchetype?: boolean;
}

/** Options for `deriveTraits()`. */
export interface DeriveTraitsOptions {
  /** Override or add trait derivation functions. Keys are trait names, values compute `[0, 1]` from a profile. */
  overrides?: Partial<Record<string, (profile: PlayprintData<any>) => number>>;
}

// ── Decision Categories ────────────────────────────────────────

/**
 * Metadata for a decision type. Games declare these per-action to replace
 * duplicated OFFENSIVE_LABELS/DEFENSIVE_LABELS sets.
 */
export interface DecisionCategory {
  /** Intent tags associated with this decision type (e.g. `['offensive']`, `['defensive']`). */
  tags: string[];
  /** Default risk value for this decision type. */
  risk?: number;
  /** Default information value for this decision type. */
  information?: number;
}

// ── Game Module ────────────────────────────────────────────────

/**
 * Typed extractor map: each key in `TExt` maps to an extractor that
 * returns the correct type for that extension field.
 */
export type ExtensionExtractorMap<TExt = Record<string, unknown>> = {
  [K in keyof TExt]: (matches: MatchRecord[]) => TExt[K];
};

/**
 * Bundles all game-specific SDK configuration in one place.
 *
 * Games export a `GameModule` to configure telemetry, extraction,
 * ghost generation, and trait derivation. Register modules with
 * `registerGameModule()` for SDK-level discovery.
 *
 * @typeParam TExt - Type of game-specific extension data in `PlayprintData`.
 */
export interface GameModule<TExt = Record<string, unknown>> {
  /** Unique game identifier (e.g. `'shadow_hands'`). */
  gameId: string;
  /** Human-readable display name (e.g. `'Shadow Hands'`). */
  displayName: string;
  /** Schema version for telemetry events produced by this game. */
  schemaVersion: string;
  /** Intent tag marking a decision as a bluff. */
  bluffTag: string;
  /** Intent tag marking a decision as a pattern break. */
  patternBreakTag: string;
  /** Custom label-to-risk mapping for Tier 1 decisions. */
  riskMap?: Record<string, number>;
  /** Custom function to compute tempo from sequence number. */
  computeTempo?: (seq: number) => 'early' | 'mid' | 'late';
  /** Typed extractors for game-specific extension data. */
  extensionExtractors: ExtensionExtractorMap<TExt>;
  /** Trait derivation overrides for this game. */
  traitOverrides?: DeriveTraitsOptions;
  /** Game-specific skill definitions for the presentation layer. */
  skills?: Record<string, TraitDefinition>;
  /** Build game-specific ghost AI parameters from a profile. */
  buildGhostProfile?: (features: PlayprintData<TExt>, ownerName: string, ownerUsername: string) => unknown;
  /** Classification metadata per decision type. Replaces hardcoded label sets. */
  decisionCategories?: Record<string, DecisionCategory>;
  /**
   * The full decision-type vocabulary this game can emit. Used to
   * stabilize entropy-based measurements (see
   * `ExtractionOptions.decisionTypeVocabulary`). If omitted, the keys of
   * `decisionCategories` serve as the vocabulary when present.
   */
  decisionTypes?: string[];
  /**
   * Optional population prior for trait calibration (per-game data;
   * the calibration mechanism itself is generic). Used to seed
   * `createCalibration()` so cold-start players still get
   * population-relative traits.
   */
  calibrationPrior?: Record<string, { mean: number; std: number; count?: number }>;
}

// ── Ghost Profile Data ─────────────────────────────────────────

/**
 * Standard container for a ghost AI profile, wrapping both SDK-level
 * biases and game-specific parameters.
 *
 * @typeParam TParams - Type of game-specific AI parameters (e.g. `DifficultyProfile`).
 */
export interface GhostProfileData<TParams = Record<string, unknown>> {
  /** Abstract cross-game bias weights. */
  biases: GhostBiases;
  /** Game-specific AI parameters. */
  params: TParams;
  /** Owner metadata. */
  owner: { name: string; username: string };
  /** Schema version of this ghost profile. */
  schemaVersion: string;
  /** ISO 8601 timestamp of when this profile was created. */
  createdAt: string;
}

// ── Modifier Pipeline ──────────────────────────────────────────

/**
 * A function that transforms ghost AI parameters based on game state.
 * Used to build composable modifier pipelines.
 *
 * @typeParam TParams - Type of AI parameters being modified.
 * @typeParam TState - Type of game state used to condition modifications.
 */
export type GhostModifier<TParams, TState> = (
  params: Readonly<TParams>,
  state: Readonly<TState>,
) => TParams;

// ── State-Action Tables ────────────────────────────────────────

/**
 * A single entry in a state-action table: a probability distribution
 * and the number of samples it was derived from.
 *
 * @typeParam TDistribution - Shape of the action distribution (e.g. `{ ROCK: number; PAPER: number; SCISSORS: number }`).
 */
export interface StateActionEntry<TDistribution> {
  /** Probability distribution over actions. */
  distribution: TDistribution;
  /** Number of samples this distribution was derived from. */
  sampleCount: number;
}

/**
 * Mapping from state bucket keys to action distribution entries.
 * Keys are composite state descriptions (e.g. `"dominant:early:after_win"`).
 *
 * @typeParam TDistribution - Shape of the action distribution.
 */
export type StateActionTable<TDistribution> = Record<
  string,
  StateActionEntry<TDistribution>
>;

// ── Skill Score ────────────────────────────────────────────────

/**
 * A measured gameplay competency score derived from moment-based analysis.
 *
 * Skills represent *how well* a player executes specific competencies
 * (reading, bluffing, timing, etc.) rather than *what* they prefer to do
 * (which is captured by traits).
 *
 * Scores use Bayesian shrinkage: small sample sizes are pulled toward 50
 * (population mean), and confidence grows with more observed moments.
 */
export interface SkillScore {
  /** Skill identifier (game-specific, e.g. 'reading', 'bluffing'). */
  skillId: string;
  /** Skill score, 0-100. Shrunk toward 50 with low sample sizes. */
  score: number;
  /** Confidence in the score, 0-1. Grows with sample size. */
  confidence: number;
  /** Number of scored moments contributing to this score. */
  sampleSize: number;
  /** ISO 8601 timestamp of last update. */
  lastUpdatedAt: string;
  /** Game that produced this score. */
  sourceGame: string;
  /** Version of the skill scoring model. */
  sourceVersion: string;
  /** Evidence window used for this score. */
  evidenceWindow: {
    /** Number of matches in the scoring window. */
    matches: number;
    /** Number of turns analyzed. */
    turns: number;
  };
}

// ── Communication Biases ───────────────────────────────────────

/**
 * Communication behavior biases derived from telemetry.
 * All values are normalized to `[0, 1]`.
 */
export interface CommunicationBiases {
  /** How frequently the player communicates (messages per match, normalized). */
  frequency: number;
  /** How hostile/aggressive the communication tone is. */
  hostility: number;
  /** How context-sensitive the communication is (varies by game state). */
  contextSensitivity: number;
  /** How varied the communication vocabulary is. */
  variety: number;
}
