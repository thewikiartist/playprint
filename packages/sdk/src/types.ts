import type { StorageAdapter } from '@playprint/core';

// ── Client configuration ───────────────────────────────────────

/** Deployment environment, as documented on playprint.ai. */
export type PlayprintEnvironment = 'dev' | 'staging' | 'production';

/** Environment value as sent on the wire to the ingest API. */
export type WireEnvironment = 'dev' | 'staging' | 'prod';

/** Opponent types accepted by the hosted ingest API. */
export type OpponentType = 'human' | 'ai' | 'legend';

/**
 * How player identities are scoped.
 *
 * - `'game'` (default): identities are derived per-game and are
 *   cryptographically unlinkable across titles — the COPPA-safe,
 *   data-minimizing posture. Identified players are hashed via
 *   `deriveGameScopedId(rawId, gameId)`; generated anonymous IDs are
 *   persisted under a per-game storage key.
 * - `'network'`: cross-game ("network Legend") identity. Caller-provided
 *   raw IDs are hashed without game scoping and the generated anonymous ID
 *   is persisted under a key shared by all games on the device. Explicit
 *   opt-in only — requires appropriate consent/age-gating.
 */
export type IdentityScope = 'game' | 'network';

/**
 * Minimal structural fetch signature so the SDK works in browsers, Node 18+,
 * and tests without depending on DOM or Node type libraries.
 */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    keepalive?: boolean;
  },
) => Promise<FetchResponseLike>;

/** Minimal structural response shape used by the client. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text?(): Promise<string>;
}

/** Configuration for `PlayprintClient`. */
export interface PlayprintClientOptions {
  /** Per-game API key issued by playprint.ai (sent via `X-PLAYPRINT-KEY`). */
  apiKey: string;
  /** Your game's identifier as registered on playprint.ai. */
  gameId: string;
  /** Deployment environment. Defaults to `'production'`. */
  environment?: PlayprintEnvironment;
  /** Base URL of the hosted platform. Defaults to `'https://playprint.ai'`. */
  endpoint?: string;
  /** Storage backend for local profiling (passed to `@playprint/core`). */
  storage?: StorageAdapter;
  /** Custom fetch implementation (testing, polyfills). Defaults to the global `fetch`. */
  fetchFn?: FetchLike;
  /** When set (> 0), the client flushes the event queue on this interval. */
  flushIntervalMs?: number;
  /** Maximum queued ingest events. Oldest events are dropped beyond this cap. Default 1000. */
  maxQueueSize?: number;
  /**
   * When true, `endMatch()` emits the legacy aggregated
   * `(decision_type, count)` batch instead of the ordered per-decision
   * sequence. Default false (sequence mode) — aggregation loses the
   * per-decision ordering and context needed for training.
   */
  aggregate?: boolean;
  /**
   * Maximum ordered decisions retained per match in sequence mode. The
   * OLDEST entries are dropped beyond this cap and surfaced via
   * `match_context.dropped_count`. Default 500.
   */
  maxDecisionsPerMatch?: number;
  /**
   * Identity scoping mode. Defaults to `'game'` — per-game, unlinkable
   * identities (the COPPA-safe posture). Set `'network'` to opt in to
   * cross-game identity; see {@link IdentityScope}.
   */
  identityScope?: IdentityScope;
  /**
   * Persist the generated anonymous ID in `localStorage` so the same player
   * keeps one identity across sessions. Default true (a no-op outside the
   * browser — SSR/Node clients fall back to a per-instance ID). The storage
   * key is per-game in `'game'` scope (`playprint_anon_${gameId}`) and
   * shared in `'network'` scope (`playprint_anon_network`). Set false for a
   * fresh identity per client instance.
   */
  persistAnonymousId?: boolean;
}

// ── Ingest wire format ─────────────────────────────────────────

/**
 * A single event in the shape expected by `POST /api/telemetry/ingest`
 * on playprint.ai. All fields are `snake_case` per platform convention.
 */
export interface IngestEvent {
  event_name: string;
  schema_version: string;
  timestamp_client: string;
  game_id: string;
  environment: WireEnvironment;
  anonymous_user_id: string;
  session_id: string;
  match_id?: string;
  legend_id?: string;
  opponent_type?: OpponentType;
  payload?: Record<string, unknown>;
}

// ── Decision batches ───────────────────────────────────────────

/** A single aggregated decision entry for a `decision.batch` event. */
export interface BatchDecision {
  /** Decision type from your gameplay mapping (e.g. `'attack_style'`). */
  decision_type: string;
  /** Observed value (enum string, count, or 0-1 scalar per your mapping). */
  value?: unknown;
  /** How many times this decision occurred (for count-type decisions). */
  count?: number;
}

/**
 * One ordered entry in the per-decision sequence recorded by
 * `trackDecision()` and shipped inside `decision.batch` events at
 * `endMatch()`. `value`/`count` are fixed at 1 so each entry also satisfies
 * consumers of the aggregated (count-based) shape.
 */
export interface DecisionSequenceEntry {
  /** 0-based position in the match's decision stream (global across chunks). */
  seq: number;
  /** Milliseconds since `startMatch()`, captured when the decision was recorded. */
  t_offset_ms: number;
  /** Decision type from your gameplay mapping (e.g. `'pick_zone'`). */
  decision_type: string;
  /** Always 1 — one entry per decision (aggregated-shape compatibility). */
  value: 1;
  /** Always 1 — one entry per decision (aggregated-shape compatibility). */
  count: 1;
  /** Caller-supplied context (functions stripped, serialized size capped). */
  payload?: Record<string, unknown>;
}

/**
 * Match context for `trackDecisionBatch`. `match_id` and `mapping_version`
 * are lifted into the envelope/payload; all other keys are forwarded under
 * `payload.match_context`.
 */
export interface MatchContext {
  /** Match this batch belongs to. Defaults to the currently active match. */
  match_id?: string;
  /** Version of the gameplay mapping used. Defaults to `'1.0.0'`. */
  mapping_version?: string;
  /** Additional context (e.g. `total_rounds`, `mode_id`, `opponent_type`). */
  [key: string]: unknown;
}

// ── Flush results ──────────────────────────────────────────────

/** Result summary returned by `PlayprintClient.flush()`. */
export interface FlushResult {
  /** Events accepted by the ingest endpoint. */
  sent: number;
  /** Events put back on the queue after retries were exhausted. */
  requeued: number;
  /** Events dropped (rejected as invalid, or evicted by the queue cap). */
  dropped: number;
}
