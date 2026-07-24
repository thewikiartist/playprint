import { describe, it, expect } from 'vitest';
import {
  mapV1toV2,
  mapV2toV1,
  TRAIT_ALIASES,
  REVERSE_ALIASES,
  detectProfileVersion,
} from '../src/trait-compat';
import { CANONICAL_TRAIT_KEYS, LEGACY_TRAIT_KEYS } from '../src/traits';

describe('TRAIT_ALIASES', () => {
  it('maps all 6 legacy keys to canonical keys', () => {
    expect(TRAIT_ALIASES.aggression).toBe('aggressive');
    expect(TRAIT_ALIASES.riskTolerance).toBe('bold');
    expect(TRAIT_ALIASES.exploration).toBe('deceptive');
    expect(TRAIT_ALIASES.variance).toBe('chaotic');
    expect(TRAIT_ALIASES.tempo).toBe('urgent');
    expect(TRAIT_ALIASES.targetLeaderBias).toBe('expansive');
  });

  it('has 6 entries', () => {
    expect(Object.keys(TRAIT_ALIASES)).toHaveLength(6);
  });
});

describe('REVERSE_ALIASES', () => {
  it('maps all 6 canonical keys back to legacy keys', () => {
    expect(REVERSE_ALIASES.aggressive).toBe('aggression');
    expect(REVERSE_ALIASES.bold).toBe('riskTolerance');
    expect(REVERSE_ALIASES.deceptive).toBe('exploration');
    expect(REVERSE_ALIASES.chaotic).toBe('variance');
    expect(REVERSE_ALIASES.urgent).toBe('tempo');
    expect(REVERSE_ALIASES.expansive).toBe('targetLeaderBias');
  });
});

describe('detectProfileVersion', () => {
  it('returns 2 for profiles with canonical keys', () => {
    expect(detectProfileVersion({ aggressive: 0.5, bold: 0.5 })).toBe(2);
  });

  it('returns 1 for profiles with only legacy keys', () => {
    expect(detectProfileVersion({
      aggression: 0.5,
      riskTolerance: 0.5,
      tempo: 0.5,
    })).toBe(1);
  });

  it('returns 2 when even one canonical key is present', () => {
    expect(detectProfileVersion({ aggression: 0.5, aggressive: 0.5 })).toBe(2);
  });

  it('returns 1 for empty profiles', () => {
    expect(detectProfileVersion({})).toBe(1);
  });
});

describe('mapV1toV2', () => {
  it('maps all 6 direct trait aliases', () => {
    const v1 = {
      aggression: 0.8,
      riskTolerance: 0.7,
      exploration: 0.6,
      variance: 0.4,
      tempo: 0.3,
      targetLeaderBias: 0.5,
      patience: 0.9,
      commitment: 0.2,
      tiltSensitivity: 0.1,
    };
    const v2 = mapV1toV2(v1);

    expect(v2.aggressive).toBe(0.8);
    expect(v2.bold).toBe(0.7);
    expect(v2.deceptive).toBe(0.6);
    expect(v2.chaotic).toBe(0.4);
    expect(v2.urgent).toBe(0.3);
    expect(v2.expansive).toBe(0.5);
  });

  it('defaults missing values to 0.5', () => {
    const v2 = mapV1toV2({});
    for (const key of CANONICAL_TRAIT_KEYS) {
      expect(v2[key]).toBe(0.5);
    }
  });

  it('clamps values to [0, 1]', () => {
    const v2 = mapV1toV2({ aggression: 1.5, riskTolerance: -0.3 });
    expect(v2.aggressive).toBe(1);
    expect(v2.bold).toBe(0);
  });

  it('produces exactly 6 keys', () => {
    const v2 = mapV1toV2({ aggression: 0.5 });
    expect(Object.keys(v2)).toHaveLength(6);
  });
});

describe('mapV2toV1', () => {
  it('maps all 6 canonical keys to legacy keys', () => {
    const v2 = {
      aggressive: 0.8,
      bold: 0.7,
      deceptive: 0.6,
      chaotic: 0.4,
      urgent: 0.3,
      expansive: 0.5,
    };
    const v1 = mapV2toV1(v2);

    expect(v1.aggression).toBe(0.8);
    expect(v1.riskTolerance).toBe(0.7);
    expect(v1.exploration).toBe(0.6);
    expect(v1.variance).toBe(0.4);
    expect(v1.tempo).toBe(0.3);
    expect(v1.targetLeaderBias).toBe(0.5);
  });

  it('reconstructs dropped traits from canonical values', () => {
    const v2 = {
      aggressive: 0.8,
      bold: 0.7,
      deceptive: 0.6,
      chaotic: 0.4,
      urgent: 0.3,
      expansive: 0.5,
    };
    const v1 = mapV2toV1(v2);

    // patience = 1 - aggressive = 0.2
    expect(v1.patience).toBeCloseTo(0.2);
    // commitment = 1 - chaotic = 0.6
    expect(v1.commitment).toBeCloseTo(0.6);
    // tiltSensitivity = 0.5 (neutral default)
    expect(v1.tiltSensitivity).toBe(0.5);
  });

  it('produces all 9 legacy keys', () => {
    const v2 = {
      aggressive: 0.5,
      bold: 0.5,
      deceptive: 0.5,
      chaotic: 0.5,
      urgent: 0.5,
      expansive: 0.5,
    };
    const v1 = mapV2toV1(v2);
    for (const key of LEGACY_TRAIT_KEYS) {
      expect(v1).toHaveProperty(key);
    }
  });
});

describe('round-trip', () => {
  it('V1 → V2 → V1 preserves direct-mapped values', () => {
    const original = {
      aggression: 0.8,
      riskTolerance: 0.7,
      exploration: 0.6,
      variance: 0.4,
      tempo: 0.3,
      targetLeaderBias: 0.5,
      patience: 0.9,
      commitment: 0.2,
      tiltSensitivity: 0.1,
    };
    const v2 = mapV1toV2(original);
    const roundTripped = mapV2toV1(v2);

    // Direct-mapped traits should survive round-trip
    expect(roundTripped.aggression).toBe(original.aggression);
    expect(roundTripped.riskTolerance).toBe(original.riskTolerance);
    expect(roundTripped.exploration).toBe(original.exploration);
    expect(roundTripped.variance).toBe(original.variance);
    expect(roundTripped.tempo).toBe(original.tempo);
    expect(roundTripped.targetLeaderBias).toBe(original.targetLeaderBias);

    // Reconstructed traits are lossy (won't match originals)
    // patience = 1 - aggressive, not the original patience value
    expect(roundTripped.patience).toBeCloseTo(1 - original.aggression);
  });
});
