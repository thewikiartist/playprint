import type {
  PlayprintData,
  GhostBiases,
  GhostProfileData,
  GhostModifier,
  StateActionEntry,
  StateActionTable,
  CommunicationBiases,
  GameModule,
  TraitProfile,
} from './types';
import { clamp, now } from './utils';
import { deriveTraits } from './traits';
import { calibrateTraits } from './calibration';
import type { GameCalibration } from './calibration';

/**
 * Derive ghost bias weights from a (typically population-calibrated)
 * canonical trait profile. This is the full-range mapping: a trait of 0
 * produces a bias of 0 and a trait of 1 produces a bias of 1 — no
 * re-centering, no saturation toward the middle.
 *
 * Missing trait keys default to the neutral 0.5.
 */
export function ghostBiasesFromTraits(traits: TraitProfile): GhostBiases {
  const t = (key: string) => clamp(traits[key] ?? 0.5, 0, 1);
  return {
    aggression: t('aggressive'),
    patience: clamp(1 - t('aggressive'), 0, 1),
    riskTolerance: t('bold'),
    consistency: clamp(1 - t('chaotic'), 0, 1),
    deception: t('deceptive'),
  };
}

/**
 * Create ghost AI bias weights from a player's profile.
 * All values are normalized to [0, 1].
 *
 * When a `GameCalibration` is provided, biases are derived from
 * population-calibrated traits and span the full [0, 1] range
 * ("plays more aggressively than 90% of this game's players" → 0.9).
 * Without one, the legacy raw-value mapping is used — raw profile
 * values typically occupy a narrow band, so calibrated biases are
 * strongly recommended for believable ghosts.
 */
export function createGhost(
  profile: PlayprintData<any>,
  calibration?: GameCalibration | null,
): GhostBiases {
  if (calibration) {
    const calibrated = calibrateTraits(deriveTraits(profile), calibration, {
      confidence: profile.confidence,
    });
    return ghostBiasesFromTraits(calibrated);
  }
  return {
    aggression: clamp(profile.aggression, 0, 1),
    patience: clamp(1 - profile.aggression, 0, 1),
    riskTolerance: clamp(
      (profile.riskWhenWinning + profile.riskWhenLosing) / 2,
      0,
      1,
    ),
    consistency: clamp(1 - profile.aggressionStdDev, 0, 1),
    deception: clamp(
      (profile.bluffRate + profile.patternBreakRate) / 2,
      0,
      1,
    ),
  };
}

/**
 * Map ghost biases to game-specific AI parameters using linear interpolation.
 *
 * Each key in the mapping defines how a bias weight (0-1) maps to an AI parameter
 * via a [lowValue, highValue] range. A bias of 0 produces lowValue, 1 produces highValue.
 *
 * @deprecated Use `GameModule.buildGhostProfile()` with `buildGhostProfileFromModule()`
 * instead. This function will be removed in a future version.
 *
 * Example:
 * ```ts
 * const aiParams = mapGhostBiases(ghost, {
 *   attackFrequency:  { bias: 'aggression', range: [0.1, 0.9] },
 *   retreatThreshold: { bias: 'patience', range: [0.2, 0.8] },
 *   bluffChance:      { bias: 'deception', range: [0, 0.3] },
 * });
 * // aiParams.attackFrequency = 0.1 + ghost.aggression * 0.8
 * ```
 */
export function mapGhostBiases<T extends Record<string, { bias: keyof GhostBiases; range: [number, number] }>>(
  ghost: GhostBiases,
  mapping: T,
): { [K in keyof T]: number } {
  const result = {} as { [K in keyof T]: number };
  for (const key in mapping) {
    const { bias, range } = mapping[key];
    const [low, high] = range;
    result[key] = low + ghost[bias] * (high - low);
  }
  return result;
}

/**
 * Sample an action from a probability distribution using a random value.
 *
 * Normalizes the distribution so values don't need to sum to exactly 1.0.
 * This is the generic sampling utility for `GhostDecisionEngine` implementations.
 *
 * @param distribution - Map of action → weight (non-negative)
 * @param roll - Random value in [0, 1) (from SeededRNG.next() or Math.random())
 * @returns The sampled action key, or the first key as fallback
 *
 * Example:
 * ```ts
 * const action = sampleFromDistribution(
 *   { ROCK: 0.5, PAPER: 0.3, SCISSORS: 0.2 },
 *   rng.next(),
 * ); // → 'ROCK' with 50% probability
 * ```
 */
export function sampleFromDistribution<TAction extends string>(
  distribution: Record<TAction, number>,
  roll: number,
): TAction {
  const entries = Object.entries(distribution) as [TAction, number][];
  if (entries.length === 0) {
    throw new Error('Cannot sample from empty distribution');
  }

  const total = entries.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
  if (total <= 0) return entries[0][0];

  let cumulative = 0;
  const target = roll * total;
  for (const [action, weight] of entries) {
    cumulative += Math.max(0, weight);
    if (target < cumulative) return action;
  }

  // Floating-point edge case — return last action
  return entries[entries.length - 1][0];
}

// ── Ghost Profile Builder ──────────────────────────────────────

/**
 * Build a standard `GhostProfileData` from a player profile using a game module.
 *
 * Computes SDK-level `GhostBiases` via `createGhost()`, then delegates to
 * `module.buildGhostProfile()` for game-specific parameters.
 */
export function buildGhostProfileFromModule<TExt, TParams>(
  module: GameModule<TExt>,
  profile: PlayprintData<TExt>,
  ownerName: string,
  ownerUsername: string,
  calibration?: GameCalibration | null,
): GhostProfileData<TParams> {
  const biases = createGhost(profile, calibration);
  const params = (module.buildGhostProfile
    ? module.buildGhostProfile(profile, ownerName, ownerUsername)
    : {}) as TParams;

  return {
    biases,
    params,
    owner: { name: ownerName, username: ownerUsername },
    schemaVersion: module.schemaVersion,
    createdAt: now(),
  };
}

// ── Modifier Pipeline ──────────────────────────────────────────

/**
 * Compose multiple ghost modifiers into a single modifier.
 * Modifiers are applied left-to-right. Each modifier receives the output
 * of the previous one (immutable — modifiers must return new objects).
 *
 * Example:
 * ```ts
 * const pipeline = composeModifiers(tempoMod, tiltMod, stateActionMod);
 * const adjusted = pipeline(baseParams, gameState);
 * ```
 */
export function composeModifiers<TParams, TState>(
  ...modifiers: GhostModifier<TParams, TState>[]
): GhostModifier<TParams, TState> {
  return (params: Readonly<TParams>, state: Readonly<TState>): TParams => {
    let current = params as TParams;
    for (const modifier of modifiers) {
      current = modifier(current, state);
    }
    return current;
  };
}

/**
 * Create a modifier that only applies when a predicate is true.
 *
 * Example:
 * ```ts
 * const lowHpMod = conditionalModifier(
 *   (state) => state.health < 4,
 *   (params) => ({ ...params, aggression: params.aggression * 1.5 }),
 * );
 * ```
 */
export function conditionalModifier<TParams, TState>(
  predicate: (state: Readonly<TState>) => boolean,
  modifier: GhostModifier<TParams, TState>,
): GhostModifier<TParams, TState> {
  return (params: Readonly<TParams>, state: Readonly<TState>): TParams => {
    if (predicate(state)) {
      return modifier(params, state);
    }
    return params as TParams;
  };
}

// ── State-Action Tables ────────────────────────────────────────

/**
 * Resolve a state-action entry from a table using hierarchical fallback keys.
 *
 * Tries each key in order, returning the first entry that exists and meets
 * the minimum sample count. Returns `null` if no key matches.
 *
 * @param keys - Fallback keys in priority order (most specific first).
 * @param table - The state-action table to look up.
 * @param minSamples - Minimum sample count required. Defaults to `1`.
 */
export function resolveStateAction<TDist>(
  keys: string[],
  table: StateActionTable<TDist>,
  minSamples = 1,
): StateActionEntry<TDist> | null {
  for (const key of keys) {
    const entry = table[key];
    if (entry && entry.sampleCount >= minSamples) {
      return entry;
    }
  }
  return null;
}

/**
 * Build hierarchical fallback keys from axis values.
 *
 * Given axes `["dominant", "early", "after_win"]`, produces:
 * ```
 * ["dominant:early:after_win", "dominant:early", "dominant", "global"]
 * ```
 *
 * The `"global"` key is always appended as the final fallback.
 */
export function buildFallbackKeys(...axes: string[]): string[] {
  const keys: string[] = [];
  for (let i = axes.length; i > 0; i--) {
    keys.push(axes.slice(0, i).join(':'));
  }
  keys.push('global');
  return keys;
}

// ── Communication Biases ───────────────────────────────────────

/**
 * Derive communication biases from extension data.
 *
 * Reads standard communication fields from `extensions`:
 * - `commFrequency` or `comm_frequency` — messages per match (normalized)
 * - `commHostility` or `comm_hostility` — hostility score
 * - `commContextSensitivity` or `comm_context_sensitivity` — context sensitivity
 * - `commVariety` or `comm_variety` — vocabulary variety
 *
 * Returns `null` if no communication data is found.
 */
export function deriveCommunicationBiases(
  extensions?: Record<string, unknown>,
): CommunicationBiases | null {
  if (!extensions) return null;

  const freq = readNum(extensions, 'commFrequency', 'comm_frequency');
  const host = readNum(extensions, 'commHostility', 'comm_hostility');
  const ctx = readNum(extensions, 'commContextSensitivity', 'comm_context_sensitivity');
  const variety = readNum(extensions, 'commVariety', 'comm_variety');

  if (freq === null && host === null && ctx === null && variety === null) {
    return null;
  }

  return {
    frequency: clamp(freq ?? 0, 0, 1),
    hostility: clamp(host ?? 0, 0, 1),
    contextSensitivity: clamp(ctx ?? 0, 0, 1),
    variety: clamp(variety ?? 0, 0, 1),
  };
}

/**
 * Classify a player's communication style from their biases.
 *
 * Returns one of:
 * - `'Trash Talker'` — high frequency + high hostility
 * - `'Respectful'` — moderate+ frequency + low hostility
 * - `'Expressive'` — high frequency + low hostility
 * - `'Silent'` — low frequency
 * - `undefined` — not enough data to classify
 *
 * @param biases - Communication biases to classify.
 * @param totalMatches - Total matches played. If < 5, returns `undefined`.
 */
export function classifyCommunicationStyle(
  biases: CommunicationBiases,
  totalMatches?: number,
): 'Trash Talker' | 'Respectful' | 'Expressive' | 'Silent' | undefined {
  if (totalMatches !== undefined && totalMatches < 5) return undefined;

  if (biases.frequency < 0.2) return 'Silent';
  if (biases.hostility >= 0.5 && biases.frequency >= 0.4) return 'Trash Talker';
  if (biases.frequency >= 0.5 && biases.hostility < 0.3) return 'Expressive';
  if (biases.frequency >= 0.3 && biases.hostility < 0.3) return 'Respectful';

  return undefined;
}

// ── Private helpers ────────────────────────────────────────────

function readNum(
  ext: Record<string, unknown>,
  camelKey: string,
  snakeKey: string,
): number | null {
  const v = ext[camelKey] ?? ext[snakeKey];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
