/**
 * Population Calibration
 *
 * Raw trait values are game-relative: what a game's heuristics can measure.
 * In practice they occupy a narrow band of [0, 1] (e.g. every Shadow Hands
 * player lands between 0.2 and 0.35 raw aggression), which collapses
 * archetypes and saturates ghost biases toward the middle.
 *
 * A GameCalibration is a small, serializable, per-game statistical summary
 * of the trait values observed across that game's player population.
 * `calibrateTraits()` re-expresses a raw trait profile as *population-relative*
 * values: 0.5 = typical for this game, 0.05 = bottom few percent,
 * 0.95 = top few percent. Calibrated traits span the full [0, 1] range and
 * are what the archetype and ghost layers should consume.
 *
 * Everything here is pure and game-agnostic:
 * - `createCalibration()` — empty (or prior-seeded) calibration
 * - `updateCalibration()` — fold one observed profile in (returns a new object)
 * - `calibrationFromTraitProfiles()` — batch build
 * - `calibrateTraits()` — raw traits → population-relative traits
 *
 * The calibration object is plain JSON so a hosted platform can persist it
 * server-side and ship it to clients. A GameModule may optionally provide a
 * `calibrationPrior` (per-game data — the *mechanism* stays generic) so new
 * games aren't stuck with the identity mapping until enough profiles exist.
 */

import type { TraitProfile } from './types';
import { clamp } from './utils';

// ── Types ────────────────────────────────────────────────────────

/** Running statistics for one trait across a game's population. */
export interface TraitCalibrationStats {
  /** Number of profiles folded into this trait's statistics. */
  count: number;
  /** Running mean of observed raw values. */
  mean: number;
  /** Running sum of squared deviations (Welford's M2). */
  m2: number;
  /** Minimum raw value observed. */
  min: number;
  /** Maximum raw value observed. */
  max: number;
}

/**
 * Serializable per-game population calibration.
 * Maintain one per game (server-side for hosted platforms).
 */
export interface GameCalibration {
  /** Calibration format version. */
  calibrationVersion: 1;
  /** Game this calibration belongs to (informational). */
  gameId?: string;
  /** Number of profiles folded in via `updateCalibration()`. */
  profileCount: number;
  /** Per-trait running statistics. */
  traits: Record<string, TraitCalibrationStats>;
}

/** Optional per-trait prior a game may ship (e.g. from playtesting). */
export type CalibrationPrior = Record<
  string,
  { mean: number; std: number; count?: number }
>;

/** Options for `calibrateTraits()`. */
export interface CalibrateOptions {
  /**
   * Profiles needed before the calibrated mapping is fully trusted.
   * Below this, output blends linearly from the raw value (identity)
   * toward the population-relative value. Default: 10.
   */
  coldStartSamples?: number;
  /**
   * Floor on the population standard deviation, preventing trivial
   * population differences from being amplified to extremes. Default: 0.01.
   */
  minStd?: number;
  /**
   * Evidence confidence for the profile being calibrated, in [0, 1]
   * (e.g. `PlayprintData.confidence`). Output is shrunk toward the
   * neutral 0.5 by this factor, so low-evidence profiles read as
   * "not yet distinctive" rather than extreme. Default: 1 (no shrink).
   */
  confidence?: number;
}

const DEFAULT_COLD_START_SAMPLES = 10;
const DEFAULT_MIN_STD = 0.01;

// ── Normal CDF (Abramowitz & Stegun 7.1.26 — deterministic) ─────

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/** Standard normal CDF. Exposed for testing/analysis. */
export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

// ── Construction ─────────────────────────────────────────────────

/**
 * Create a fresh calibration, optionally seeded with a per-game prior.
 * With no prior, `calibrateTraits()` starts as (approximately) the
 * identity mapping and sharpens as profiles are folded in.
 */
export function createCalibration(
  gameId?: string,
  prior?: CalibrationPrior,
): GameCalibration {
  const traits: Record<string, TraitCalibrationStats> = {};
  let seeded = 0;
  if (prior) {
    for (const [key, p] of Object.entries(prior)) {
      const count = Math.max(2, Math.round(p.count ?? 20));
      traits[key] = {
        count,
        mean: p.mean,
        m2: p.std * p.std * count,
        min: p.mean - 2 * p.std,
        max: p.mean + 2 * p.std,
      };
      seeded = Math.max(seeded, count);
    }
  }
  return {
    calibrationVersion: 1,
    ...(gameId ? { gameId } : {}),
    profileCount: seeded,
    traits,
  };
}

/**
 * Fold one observed raw trait profile into a calibration.
 * Pure — returns a new calibration object (Welford update per trait).
 */
export function updateCalibration(
  calibration: GameCalibration,
  rawTraits: TraitProfile,
): GameCalibration {
  const traits: Record<string, TraitCalibrationStats> = { ...calibration.traits };
  for (const [key, value] of Object.entries(rawTraits)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const prev = traits[key];
    if (!prev) {
      traits[key] = { count: 1, mean: value, m2: 0, min: value, max: value };
    } else {
      const count = prev.count + 1;
      const delta = value - prev.mean;
      const mean = prev.mean + delta / count;
      const m2 = prev.m2 + delta * (value - mean);
      traits[key] = {
        count,
        mean,
        m2,
        min: Math.min(prev.min, value),
        max: Math.max(prev.max, value),
      };
    }
  }
  return {
    ...calibration,
    profileCount: calibration.profileCount + 1,
    traits,
  };
}

/** Build a calibration from a batch of observed raw trait profiles. */
export function calibrationFromTraitProfiles(
  profiles: TraitProfile[],
  gameId?: string,
): GameCalibration {
  let cal = createCalibration(gameId);
  for (const p of profiles) cal = updateCalibration(cal, p);
  return cal;
}

// ── Calibration ──────────────────────────────────────────────────

/**
 * Re-express raw traits as population-relative traits spanning [0, 1].
 *
 * For each trait with sufficient population statistics, the raw value is
 * z-scored against the population and mapped through the normal CDF:
 * an average player lands at 0.5, an unusually high one near 1.
 *
 * Cold start: with no calibration (or too few samples) the mapping blends
 * toward identity, so the function is always safe to call.
 *
 * Trait keys absent from the calibration pass through unchanged.
 */
export function calibrateTraits(
  rawTraits: TraitProfile,
  calibration?: GameCalibration | null,
  options?: CalibrateOptions,
): TraitProfile {
  const coldStart = options?.coldStartSamples ?? DEFAULT_COLD_START_SAMPLES;
  const minStd = options?.minStd ?? DEFAULT_MIN_STD;
  const confidence = clamp(options?.confidence ?? 1, 0, 1);

  const out: TraitProfile = {};
  for (const [key, raw] of Object.entries(rawTraits)) {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const stats = calibration?.traits[key];
    let value = raw;
    if (stats && stats.count >= 2) {
      const variance = stats.m2 / stats.count;
      const std = Math.max(Math.sqrt(Math.max(0, variance)), minStd);
      const z = (raw - stats.mean) / std;
      const relative = normalCdf(z);
      const weight = Math.min(1, stats.count / coldStart);
      value = weight * relative + (1 - weight) * raw;
    }
    // Low-evidence profiles read as neutral rather than extreme.
    value = 0.5 + (value - 0.5) * confidence;
    out[key] = clamp(value, 0, 1);
  }
  return out;
}
