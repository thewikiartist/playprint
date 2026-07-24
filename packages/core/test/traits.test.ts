import { describe, it, expect } from 'vitest';
import { deriveTraits, deriveAwareness, STANDARD_TRAIT_KEYS, CANONICAL_TRAIT_KEYS, LEGACY_TRAIT_KEYS } from '../src/traits';
import type { PlayprintData } from '../src/types';

function makeProfile(overrides: Partial<PlayprintData> = {}): PlayprintData {
  return {
    aggression: 0.5,
    aggressionStdDev: 0.1,
    informationPreference: 0.5,
    tempoEarly: 0.33,
    tempoMid: 0.34,
    tempoLate: 0.33,
    bluffRate: 0,
    patternBreakRate: 0,
    riskWhenWinning: 0.5,
    riskWhenLosing: 0.5,
    comebackRate: 0.3,
    counterplayRate: 0.0,
    totalDecisions: 100,
    totalMatches: 10,
    ...overrides,
  };
}

describe('deriveTraits', () => {
  it('produces all 6 canonical trait keys', () => {
    const traits = deriveTraits(makeProfile());
    for (const key of CANONICAL_TRAIT_KEYS) {
      expect(traits).toHaveProperty(key);
      expect(typeof traits[key]).toBe('number');
    }
  });

  it('maps aggressive from aggression', () => {
    const traits = deriveTraits(makeProfile({ aggression: 0.8 }));
    expect(traits.aggressive).toBe(0.8);
  });

  it('maps bold from riskWhenLosing', () => {
    const traits = deriveTraits(makeProfile({ riskWhenLosing: 0.7 }));
    expect(traits.bold).toBe(0.7);
  });

  it('maps deceptive from (bluffRate + patternBreakRate) / 2', () => {
    const traits = deriveTraits(makeProfile({ bluffRate: 0.4, patternBreakRate: 0.6 }));
    // (0.4 + 0.6) / 2 = 0.5
    expect(traits.deceptive).toBeCloseTo(0.5);
  });

  it('clamps deceptive to [0, 1]', () => {
    const traits = deriveTraits(makeProfile({ bluffRate: 1, patternBreakRate: 1 }));
    expect(traits.deceptive).toBe(1);
  });

  it('maps chaotic from aggressionStdDev * 2.5', () => {
    const traits = deriveTraits(makeProfile({ aggressionStdDev: 0.2 }));
    expect(traits.chaotic).toBeCloseTo(0.5);
  });

  it('maps urgent from tempoEarly and tempoMid', () => {
    const traits = deriveTraits(makeProfile({ tempoEarly: 0.4, tempoMid: 0.6 }));
    // 0.4 * 1.0 + 0.6 * 0.5 = 0.7
    expect(traits.urgent).toBeCloseTo(0.7);
  });

  it('sets expansive to 0.5 by default', () => {
    const traits = deriveTraits(makeProfile());
    expect(traits.expansive).toBe(0.5);
  });

  it('clamps all values to [0, 1]', () => {
    // Force a very high urgent computation: tempoEarly=1, tempoMid=1 → 1*1 + 1*0.5 = 1.5
    const traits = deriveTraits(makeProfile({ tempoEarly: 1, tempoMid: 1 }));
    expect(traits.urgent).toBe(1);

    // All traits should be in range
    for (const value of Object.values(traits)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('applies per-trait overrides', () => {
    const traits = deriveTraits(makeProfile(), {
      overrides: {
        expansive: () => 0.9,
      },
    });
    expect(traits.expansive).toBe(0.9);
  });

  it('passes through custom trait keys from overrides', () => {
    const traits = deriveTraits(makeProfile({ aggression: 0.6 }), {
      overrides: {
        customTrait: (p) => p.aggression * 0.5,
      },
    });
    expect(traits.customTrait).toBeCloseTo(0.3);
  });

  it('clamps override values to [0, 1]', () => {
    const traits = deriveTraits(makeProfile(), {
      overrides: {
        aggressive: () => 1.5,
        customNeg: () => -0.3,
      },
    });
    expect(traits.aggressive).toBe(1);
    expect(traits.customNeg).toBe(0);
  });
});

describe('deriveAwareness', () => {
  it('returns informationPreference clamped to [0, 1]', () => {
    expect(deriveAwareness(makeProfile({ informationPreference: 0.8 }))).toBe(0.8);
    expect(deriveAwareness(makeProfile({ informationPreference: 0 }))).toBe(0);
    expect(deriveAwareness(makeProfile({ informationPreference: 1 }))).toBe(1);
  });
});

describe('CANONICAL_TRAIT_KEYS', () => {
  it('has 6 entries', () => {
    expect(CANONICAL_TRAIT_KEYS).toHaveLength(6);
  });
});

describe('STANDARD_TRAIT_KEYS', () => {
  it('is an alias for CANONICAL_TRAIT_KEYS', () => {
    expect(STANDARD_TRAIT_KEYS).toEqual(CANONICAL_TRAIT_KEYS);
  });
});

describe('LEGACY_TRAIT_KEYS', () => {
  it('has 9 entries', () => {
    expect(LEGACY_TRAIT_KEYS).toHaveLength(9);
  });
});
