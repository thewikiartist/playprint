import { describe, it, expect } from 'vitest';
import {
  generateArchetype,
  signalStrength,
  profileHash,
  getTempoTag,
  CORE_ARCHETYPES,
  HANDLE_LABELS,
} from '../src/generative-archetypes';
import { STANDARD_TRAIT_KEYS } from '../src/traits';
import type { TraitProfile } from '../src/types';

function makeTraits(overrides: Partial<TraitProfile> = {}): TraitProfile {
  return {
    aggressive: 0.5,
    bold: 0.5,
    deceptive: 0.5,
    chaotic: 0.5,
    urgent: 0.5,
    expansive: 0.5,
    ...overrides,
  };
}

describe('generateArchetype', () => {
  it('returns Enigma for flat profiles (all at 0.5)', () => {
    const result = generateArchetype(makeTraits());
    expect(result.coreArchetype).toBe('Enigma');
    expect(result.styleModifier).toBe('Balanced');
    expect(result.displayName).toBe('Enigma');
    expect(result.handleWords).toEqual(['Enigma']);
    expect(result.behaviors).toEqual([]);
  });

  it('returns Enigma for nearly-flat profiles', () => {
    const result = generateArchetype(makeTraits({
      aggressive: 0.52,
      bold: 0.48,
    }));
    expect(result.coreArchetype).toBe('Enigma');
  });

  it('returns Enigma just below FLAT_THRESHOLD', () => {
    // signal = |0.54 - 0.5| * 2 = 0.08 → not > 0.1, so Enigma
    const result = generateArchetype(makeTraits({ aggressive: 0.54 }));
    expect(result.coreArchetype).toBe('Enigma');
  });

  it('crosses FLAT_THRESHOLD just above boundary', () => {
    // signal = |0.56 - 0.5| * 2 = 0.12 → > 0.1, no longer Enigma
    const result = generateArchetype(makeTraits({ aggressive: 0.56 }));
    expect(result.coreArchetype).toBe('Berserker');
  });

  it('picks Berserker for high aggressive', () => {
    const result = generateArchetype(makeTraits({ aggressive: 0.9 }));
    expect(result.coreArchetype).toBe('Berserker');
  });

  it('picks Ghost for low aggressive', () => {
    const result = generateArchetype(makeTraits({ aggressive: 0.1 }));
    expect(result.coreArchetype).toBe('Ghost');
  });

  it('picks correct core archetype for each trait pair', () => {
    const cases: [string, string, string][] = [
      ['aggressive', 'Berserker', 'Ghost'],
      ['bold', 'Daredevil', 'Sentinel'],
      ['deceptive', 'Phantom', 'Purist'],
      ['chaotic', 'Wildcard', 'Metronome'],
      ['urgent', 'Blitz', 'Glacier'],
      ['expansive', 'Cartographer', 'Specialist'],
    ];

    for (const [trait, high, low] of cases) {
      const highResult = generateArchetype(makeTraits({ [trait]: 0.95 }));
      expect(highResult.coreArchetype).toBe(high);

      const lowResult = generateArchetype(makeTraits({ [trait]: 0.05 }));
      expect(lowResult.coreArchetype).toBe(low);
    }
  });

  it('uses second-strongest signal for style modifier', () => {
    const result = generateArchetype(makeTraits({
      aggressive: 0.9,
      bold: 0.85,
    }));
    expect(result.coreArchetype).toBe('Berserker');
    expect(result.styleModifier).toBe('Bold');
  });

  it('builds 3-word handle from top traits by signal strength', () => {
    const result = generateArchetype(makeTraits({
      aggressive: 0.9,   // signal 0.8
      bold: 0.85,         // signal 0.7
      chaotic: 0.8,       // signal 0.6
    }));
    expect(result.handleWords).toEqual(['Fierce', 'Daring', 'Chaotic']);
    expect(result.displayName).toBe('Bold Berserker');
  });

  it('includes 4th word when its signal exceeds threshold', () => {
    const result = generateArchetype(makeTraits({
      aggressive: 0.9,   // signal 0.8
      bold: 0.85,         // signal 0.7
      chaotic: 0.8,       // signal 0.6
      deceptive: 0.7,     // signal 0.4 > 0.15
    }));
    expect(result.handleWords).toHaveLength(4);
    // displayName is always 2 words (modifier + archetype)
    expect(result.displayName.split(' ')).toHaveLength(2);
  });

  it('stops at 3 words when 4th signal is weak', () => {
    const result = generateArchetype(makeTraits({
      aggressive: 0.9,   // signal 0.8
      bold: 0.85,         // signal 0.7
      chaotic: 0.8,       // signal 0.6
      deceptive: 0.54,    // signal 0.08 < 0.15
    }));
    expect(result.handleWords).toHaveLength(3);
    // displayName is always 2 words (modifier + archetype)
    expect(result.displayName.split(' ')).toHaveLength(2);
  });

  it('uses low labels for traits below 0.5', () => {
    const result = generateArchetype(makeTraits({
      aggressive: 0.1,   // signal 0.8, low
      chaotic: 0.15,      // signal 0.7, low
      urgent: 0.1,        // signal 0.8, low
    }));
    // aggressive and urgent tied at 0.8, alphabetical tiebreak: aggressive first
    expect(result.handleWords[0]).toBe('Defensive');
    expect(result.handleWords).toContain('Precise');
    expect(result.handleWords).toContain('Patient');
  });

  it('suppresses tempo tag when urgent is used in layer 1 or 2', () => {
    const result = generateArchetype(makeTraits({ urgent: 0.95 }));
    expect(result.coreArchetype).toBe('Blitz');
    expect(result.tempoTag).toBeNull();
  });

  it('includes tempo tag when urgent is not in top 2 signals', () => {
    const result = generateArchetype(makeTraits({
      aggressive: 0.9,
      bold: 0.85,
      urgent: 0.3,
    }));
    expect(result.tempoTag).not.toBeNull();
    expect(typeof result.tempoTag).toBe('string');
  });

  it('generates behaviors for matching multi-trait combos', () => {
    const result = generateArchetype(makeTraits({
      aggressive: 0.9,
      bold: 0.9,
    }));
    expect(result.behaviors.length).toBeGreaterThan(0);
    expect(result.behaviors).toContain('Lives on the edge and thrives there');
  });

  it('limits behaviors to at most 3', () => {
    const result = generateArchetype(makeTraits({
      aggressive: 0.9,
      bold: 0.9,
      urgent: 0.9,
      chaotic: 0.9,
      deceptive: 0.9,
      expansive: 0.9,
    }));
    expect(result.behaviors.length).toBeLessThanOrEqual(3);
  });

  it('is deterministic — same input always gives same output', () => {
    const profile = makeTraits({ aggressive: 0.8, deceptive: 0.7 });
    const a = generateArchetype(profile);
    const b = generateArchetype(profile);
    expect(a).toEqual(b);
  });

  it('is deterministic even with near-tied signal strengths', () => {
    // aggressive=0.7 and bold=0.3 have near-equal signals (~0.4)
    // alphabetical tiebreaker ensures consistent result across runs
    const profile = makeTraits({ aggressive: 0.7, bold: 0.3 });
    const a = generateArchetype(profile);
    const b = generateArchetype(profile);
    expect(a).toEqual(b);
  });

  it('always includes a tagline string', () => {
    const result = generateArchetype(makeTraits({ aggressive: 0.9 }));
    expect(typeof result.tagline).toBe('string');
    expect(result.tagline.length).toBeGreaterThan(0);
  });

  it('handles partial profiles (only some traits)', () => {
    const result = generateArchetype({ aggressive: 0.9 });
    expect(result.coreArchetype).toBe('Berserker');
    expect(typeof result.tagline).toBe('string');
    // Only 1 trait → handle has 1 word (less than HANDLE_MIN but limited by available traits)
    expect(result.handleWords).toEqual(['Fierce']);
    expect(result.displayName).toBe('Fierce Berserker');
  });

  it('handles empty profile as Enigma', () => {
    const result = generateArchetype({});
    expect(result.coreArchetype).toBe('Enigma');
    expect(result.handleWords).toEqual(['Enigma']);
    expect(result.displayName).toBe('Enigma');
  });
});

// ---------------------------------------------------------------------------
// Behavior Rules — test each of the 12 rules individually
// ---------------------------------------------------------------------------

describe('behavior rules', () => {
  const cases: [string, TraitProfile][] = [
    [
      'Waits, then strikes without mercy',
      makeTraits({ aggressive: 0.8, urgent: 0.2 }),
    ],
    [
      'Goes all-in and never looks back',
      makeTraits({ bold: 0.8, chaotic: 0.2 }),
    ],
    [
      'Never plays the same way twice',
      makeTraits({ chaotic: 0.8, deceptive: 0.8 }),
    ],
    [
      'Invisible until the final move',
      makeTraits({ aggressive: 0.2, deceptive: 0.8 }),
    ],
    [
      'Dangerous when cornered',
      makeTraits({ bold: 0.8, aggressive: 0.7 }),
    ],
    [
      'Fortress builder \u2014 breaks your will',
      makeTraits({ bold: 0.2, urgent: 0.2 }),
    ],
    [
      'Hunts the leader at any cost',
      makeTraits({ expansive: 0.8, bold: 0.7 }),
    ],
    [
      'Expects the unexpected',
      makeTraits({ deceptive: 0.9, chaotic: 0.7 }),
    ],
    [
      'Unbreakable focus',
      makeTraits({ chaotic: 0.2, bold: 0.8 }),
    ],
    [
      'Blitzes before you can breathe',
      makeTraits({ urgent: 0.8, aggressive: 0.8 }),
    ],
    [
      'Lives on the edge and thrives there',
      makeTraits({ aggressive: 0.9, bold: 0.9 }),
    ],
    [
      'Outlasts you through sheer persistence',
      makeTraits({ aggressive: 0.2, chaotic: 0.2 }),
    ],
    [
      'Thrives in disorder \u2014 the wilder it gets, the better',
      makeTraits({ chaotic: 0.7, bold: 0.65 }),
    ],
    [
      'Uses chaos as a shield, not a sword',
      makeTraits({ chaotic: 0.7, aggressive: 0.25 }),
    ],
    [
      'Takes enormous risks, but never in a hurry',
      makeTraits({ bold: 0.7, urgent: 0.25 }),
    ],
    [
      'Plays honest defence \u2014 and makes it work',
      makeTraits({ aggressive: 0.25, deceptive: 0.25 }),
    ],
  ];

  it.each(cases)('triggers: "%s"', (phrase, profile) => {
    const result = generateArchetype(profile);
    expect(result.behaviors).toContain(phrase);
  });

  it('does not trigger any behavior for a flat profile', () => {
    const result = generateArchetype(makeTraits());
    expect(result.behaviors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Vocabulary sync — CORE_ARCHETYPES keys must match STANDARD_TRAIT_KEYS
// ---------------------------------------------------------------------------

describe('vocabulary sync', () => {
  it('CORE_ARCHETYPES keys match STANDARD_TRAIT_KEYS', () => {
    const archetypeKeys = Object.keys(CORE_ARCHETYPES).sort();
    const traitKeys = [...STANDARD_TRAIT_KEYS].sort();
    expect(archetypeKeys).toEqual(traitKeys);
  });

  it('HANDLE_LABELS keys match STANDARD_TRAIT_KEYS', () => {
    const handleKeys = Object.keys(HANDLE_LABELS).sort();
    const traitKeys = [...STANDARD_TRAIT_KEYS].sort();
    expect(handleKeys).toEqual(traitKeys);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe('signalStrength', () => {
  it('returns 0 for neutral value (0.5)', () => {
    expect(signalStrength(0.5)).toBe(0);
  });

  it('returns 1 for extreme value (0 or 1)', () => {
    expect(signalStrength(0)).toBe(1);
    expect(signalStrength(1)).toBe(1);
  });

  it('returns 0.4 for value 0.3', () => {
    expect(signalStrength(0.3)).toBeCloseTo(0.4);
  });
});

describe('profileHash', () => {
  it('returns a non-negative integer', () => {
    const hash = profileHash(makeTraits());
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(hash)).toBe(true);
  });

  it('is deterministic', () => {
    const profile = makeTraits({ aggressive: 0.7 });
    expect(profileHash(profile)).toBe(profileHash(profile));
  });

  it('differs for different profiles', () => {
    const a = profileHash(makeTraits({ aggressive: 0.9 }));
    const b = profileHash(makeTraits({ aggressive: 0.1 }));
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Integration test — real user profile
// ---------------------------------------------------------------------------

describe('integration: real profile', () => {
  it('produces "Subtle Wildcard" with behaviors for chaotic=0.76, aggressive=0.29, bold=0.64', () => {
    const result = generateArchetype({
      aggressive: 0.29,
      bold: 0.64,
      deceptive: 0.29,
      chaotic: 0.76,
      urgent: 0.32,
      expansive: 0.51,
    });
    expect(result.coreArchetype).toBe('Wildcard');
    expect(result.styleModifier).toBe('Subtle');
    expect(result.displayName).toBe('Subtle Wildcard');
    expect(result.behaviors.length).toBeGreaterThan(0);
  });
});

describe('getTempoTag', () => {
  it('returns Marathon grinder for 0', () => {
    expect(getTempoTag(0)).toBe('Marathon grinder');
  });

  it('returns All-in sprinter for 1.0', () => {
    expect(getTempoTag(1.0)).toBe('All-in sprinter');
  });

  it('returns Late-game closer for 0.4', () => {
    expect(getTempoTag(0.4)).toBe('Late-game closer');
  });

  it('returns correct label at each bucket boundary', () => {
    expect(getTempoTag(0.0)).toBe('Marathon grinder');
    expect(getTempoTag(0.125)).toBe('Slow burn');
    expect(getTempoTag(0.25)).toBe('Steady escalator');
    expect(getTempoTag(0.375)).toBe('Late-game closer');
    expect(getTempoTag(0.50)).toBe('Rhythm switcher');
    expect(getTempoTag(0.625)).toBe('Burst player');
    expect(getTempoTag(0.75)).toBe('Explosive opener');
    expect(getTempoTag(0.875)).toBe('All-in sprinter');
  });

  it('returns one of the 8 bucket labels for any value', () => {
    const validLabels = [
      'Marathon grinder', 'Slow burn', 'Steady escalator', 'Late-game closer',
      'Rhythm switcher', 'Burst player', 'Explosive opener', 'All-in sprinter',
    ];
    for (let v = 0; v <= 1; v += 0.1) {
      expect(validLabels).toContain(getTempoTag(v));
    }
  });
});
