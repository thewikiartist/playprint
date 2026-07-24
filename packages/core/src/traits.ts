/**
 * Trait Derivation
 *
 * Maps PlayprintData (raw extraction output) to a TraitProfile of
 * 6 normalized (0–1) canonical trait dimensions used by the generative archetype system.
 *
 * Games can override any trait via DeriveTraitsOptions.overrides.
 */

import type { PlayprintData, TraitProfile, DeriveTraitsOptions } from './types';

// ── Profile model version ────────────────────────────────────────

/**
 * v3: `urgent` derives from match-length-invariant `riskFrontloading`
 * (falling back to the v2 tempo formula for older profiles), and
 * profiles carry `riskFrontloading` + `confidence`. Trait *shapes* are
 * unchanged (same 6 canonical keys), so no new trait-compat mapping is
 * required — v2 profiles remain fully readable.
 */
export const PROFILE_MODEL_VERSION = 3;

// ── Canonical trait keys (v2) ────────────────────────────────────

export const CANONICAL_TRAIT_KEYS = [
  'aggressive',
  'bold',
  'deceptive',
  'chaotic',
  'urgent',
  'expansive',
] as const;

// ── Legacy trait keys (v1, preserved for compat) ─────────────────

export const LEGACY_TRAIT_KEYS = [
  'aggression',
  'riskTolerance',
  'tempo',
  'exploration',
  'patience',
  'targetLeaderBias',
  'commitment',
  'variance',
  'tiltSensitivity',
] as const;

/** @deprecated Use CANONICAL_TRAIT_KEYS instead. */
export const STANDARD_TRAIT_KEYS = CANONICAL_TRAIT_KEYS;

// ── Default derivation map ───────────────────────────────────────

type TraitDeriveFn = (profile: PlayprintData<any>) => number;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

const CANONICAL_DERIVATIONS: Record<string, TraitDeriveFn> = {
  aggressive: (p) => p.aggression,

  bold: (p) => p.riskWhenLosing,

  deceptive: (p) => clamp01((p.bluffRate + p.patternBreakRate) / 2),

  chaotic: (p) => clamp01(p.aggressionStdDev * 2.5),

  // Match-length invariant when riskFrontloading is available (v3 profiles);
  // falls back to the v2 tempo-phase formula for older profiles.
  urgent: (p) => p.riskFrontloading ?? p.tempoEarly * 1.0 + p.tempoMid * 0.5,

  expansive: (p) => p.decisionTypeDiversity ?? 0.5,
};

// ── Awareness (hidden supplementary dimension) ───────────────────

/**
 * Derive the hidden `awareness` dimension from a profile.
 * Stored alongside traits when available, but not shown on the radar chart.
 */
export function deriveAwareness(profile: PlayprintData<any>): number {
  return clamp01(profile.informationPreference);
}

// ── Main API ─────────────────────────────────────────────────────

/**
 * Derive a TraitProfile from raw PlayprintData.
 *
 * All 6 canonical traits are computed using default formulas unless
 * overridden. Any extra keys in `options.overrides` that aren't
 * canonical traits are also included (custom game-specific traits).
 *
 * All values are clamped to [0, 1].
 */
export function deriveTraits(
  profile: PlayprintData<any>,
  options?: DeriveTraitsOptions,
): TraitProfile {
  const overrides = options?.overrides ?? {};
  const result: TraitProfile = {};

  // Compute canonical traits
  for (const key of CANONICAL_TRAIT_KEYS) {
    const fn = overrides[key] ?? CANONICAL_DERIVATIONS[key];
    result[key] = clamp01(fn(profile));
  }

  // Pass through any custom trait keys from overrides
  for (const key of Object.keys(overrides)) {
    if (!(key in result)) {
      result[key] = clamp01(overrides[key]!(profile));
    }
  }

  return result;
}
