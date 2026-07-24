/**
 * Trait Compatibility Layer
 *
 * Maps between the legacy 9-trait (v1) and canonical 6-trait (v2) models.
 * Used for migrating stored profiles and maintaining backward compatibility.
 */

import type { CanonicalTrait, TraitProfile } from './types';
import { CANONICAL_TRAIT_KEYS } from './traits';

// ── Alias Maps ───────────────────────────────────────────────────

/** Maps legacy v1 trait keys to their canonical v2 equivalents. */
export const TRAIT_ALIASES: Record<string, CanonicalTrait> = {
  aggression: 'aggressive',
  riskTolerance: 'bold',
  exploration: 'deceptive',
  variance: 'chaotic',
  tempo: 'urgent',
  targetLeaderBias: 'expansive',
};

/** Maps canonical v2 trait keys back to their legacy v1 equivalents. */
export const REVERSE_ALIASES: Record<CanonicalTrait, string> = {
  aggressive: 'aggression',
  bold: 'riskTolerance',
  deceptive: 'exploration',
  chaotic: 'variance',
  urgent: 'tempo',
  expansive: 'targetLeaderBias',
};

// ── Version Detection ────────────────────────────────────────────

/**
 * Detect whether a trait profile uses v1 (9-trait) or v2 (6-trait) keys.
 * Returns 2 if any canonical v2 key is present, 1 otherwise.
 */
export function detectProfileVersion(profile: TraitProfile): 1 | 2 {
  for (const key of CANONICAL_TRAIT_KEYS) {
    if (key in profile) return 2;
  }
  return 1;
}

// ── Mapping Functions ────────────────────────────────────────────

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Convert a v1 (9-trait) profile to v2 (6-trait canonical) profile.
 *
 * Direct mappings:
 * - aggressive = aggression
 * - bold = riskTolerance
 * - deceptive = exploration (old exploration measured deception signals)
 * - chaotic = variance
 * - urgent = tempo
 * - expansive = targetLeaderBias
 */
export function mapV1toV2(v1: TraitProfile): Record<CanonicalTrait, number> {
  return {
    aggressive: clamp01(v1.aggression ?? 0.5),
    bold: clamp01(v1.riskTolerance ?? 0.5),
    deceptive: clamp01(v1.exploration ?? 0.5),
    chaotic: clamp01(v1.variance ?? 0.5),
    urgent: clamp01(v1.tempo ?? 0.5),
    expansive: clamp01(v1.targetLeaderBias ?? 0.5),
  };
}

/**
 * Convert a v2 (6-trait canonical) profile back to v1 (9-trait) profile.
 *
 * This is lossy — dropped traits are reconstructed from canonical values:
 * - patience = 1 - aggressive
 * - commitment = 1 - chaotic
 * - tiltSensitivity = 0.5 (no equivalent, neutral default)
 */
export function mapV2toV1(v2: Record<CanonicalTrait, number>): TraitProfile {
  return {
    aggression: clamp01(v2.aggressive),
    riskTolerance: clamp01(v2.bold),
    tempo: clamp01(v2.urgent),
    exploration: clamp01(v2.deceptive),
    patience: clamp01(1 - v2.aggressive),
    targetLeaderBias: clamp01(v2.expansive),
    commitment: clamp01(1 - v2.chaotic),
    variance: clamp01(v2.chaotic),
    tiltSensitivity: 0.5,
  };
}
