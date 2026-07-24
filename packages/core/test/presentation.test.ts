import { describe, it, expect } from 'vitest';
import { getLegendPresentation, DEFAULT_TRAITS, DEFAULT_SKILLS } from '../src/presentation';
import type { TraitProfile } from '../src/types';

function makeTraits(overrides: Partial<TraitProfile> = {}): TraitProfile {
  return {
    aggressive: 0.8,
    bold: 0.6,
    deceptive: 0.3,
    chaotic: 0.2,
    urgent: 0.4,
    expansive: 0.5,
    ...overrides,
  };
}

describe('getLegendPresentation', () => {
  it('produces a title matching generateArchetype().displayName', () => {
    const result = getLegendPresentation({
      aggressive: 0.95,   // signal = 0.9 (strongest)
      bold: 0.85,          // signal = 0.7 (second)
      urgent: 0.5,         // signal = 0.0 (third by alphabetical tiebreak)
    });
    expect(typeof result.title).toBe('string');
    expect(result.title.length).toBeGreaterThan(0);
    // displayName is now 2-word compound: style modifier + core archetype
    expect(result.title).toBe('Bold Berserker');
  });

  it('generates title from single trait', () => {
    const result = getLegendPresentation({ aggressive: 0.9 });
    expect(result.title).toBe('Fierce Berserker');
  });

  it('generates deterministic title when traits are tied', () => {
    // aggressive and bold both 0.8 → tiebreak by signal then key
    const a = getLegendPresentation({ aggressive: 0.8, bold: 0.8 });
    const b = getLegendPresentation({ aggressive: 0.8, bold: 0.8 });
    expect(a.title).toBe(b.title);
  });

  it('uses player-facing names for traits', () => {
    const result = getLegendPresentation(makeTraits());
    const aggrTrait = result.traits.find((t) => t.key === 'aggressive');
    expect(aggrTrait).toBeDefined();
    expect(aggrTrait!.name).toBe('Aggressive');
  });

  it('orders traits in display order', () => {
    const result = getLegendPresentation(makeTraits());
    const keys = result.traits.map((t) => t.key);
    expect(keys[0]).toBe('aggressive');
    expect(keys[1]).toBe('bold');
    expect(keys[2]).toBe('deceptive');
  });

  it('sorts custom traits after standard traits alphabetically', () => {
    const result = getLegendPresentation({
      aggressive: 0.5,
      zebra: 0.5,
      alpha: 0.5,
    });
    const keys = result.traits.map((t) => t.key);
    expect(keys[0]).toBe('aggressive');
    expect(keys[1]).toBe('alpha');
    expect(keys[2]).toBe('zebra');
  });

  it('clamps trait values to [0, 1]', () => {
    const result = getLegendPresentation({ aggressive: 1.5, bold: -0.2 });
    const aggr = result.traits.find((t) => t.key === 'aggressive');
    const boldT = result.traits.find((t) => t.key === 'bold');
    expect(aggr!.value).toBe(1);
    expect(boldT!.value).toBe(0);
  });

  it('includes archetype by default', () => {
    const result = getLegendPresentation(makeTraits());
    expect(result.archetype).toBeDefined();
    expect(result.archetype!.coreArchetype).toBeTruthy();
  });

  it('excludes archetype when includeArchetype is false', () => {
    const result = getLegendPresentation(makeTraits(), null, { includeArchetype: false });
    expect(result.archetype).toBeUndefined();
  });

  it('returns default safety and training notes', () => {
    const result = getLegendPresentation(makeTraits());
    expect(result.safetyNote).toContain('gameplay and in-game communication');
    expect(result.trainingNote).toContain('grows as you play');
  });

  it('allows custom safety and training notes', () => {
    const result = getLegendPresentation(makeTraits(), null, {
      safetyNote: 'Custom safety',
      trainingNote: 'Custom training',
    });
    expect(result.safetyNote).toBe('Custom safety');
    expect(result.trainingNote).toBe('Custom training');
  });

  it('accepts and presents skills', () => {
    const result = getLegendPresentation(makeTraits(), { precision: 0.7 });
    expect(result.skills).toBeDefined();
    expect(result.skills!.length).toBe(1);
    expect(result.skills![0].name).toBe('Precision');
    expect(result.skills![0].value).toBe(0.7);
  });

  it('omits skills when not provided', () => {
    const result = getLegendPresentation(makeTraits());
    expect(result.skills).toBeUndefined();
  });

  it('omits skills when empty object', () => {
    const result = getLegendPresentation(makeTraits(), {});
    expect(result.skills).toBeUndefined();
  });

  it('applies trait overrides', () => {
    const result = getLegendPresentation(makeTraits(), null, {
      overrides: {
        aggressive: { name: 'Power', description: 'Raw power.' },
      },
    });
    const aggr = result.traits.find((t) => t.key === 'aggressive');
    expect(aggr!.name).toBe('Power');
    expect(aggr!.description).toBe('Raw power.');
    // Tip should be preserved from defaults via merge
    expect(aggr!.tip).toBe('Play more aggressively to raise this trait.');
  });

  it('preserves iconKey through overrides', () => {
    const result = getLegendPresentation(makeTraits(), null, {
      overrides: {
        aggressive: { name: 'Power' },
      },
    });
    const aggr = result.traits.find((t) => t.key === 'aggressive');
    expect(aggr!.iconKey).toBe('aggressive');
  });

  it('supports extra skills from opts', () => {
    const result = getLegendPresentation(
      makeTraits(),
      { timing: 0.8 },
      {
        extraSkills: {
          timing: { name: 'Timing', description: 'Play the moment.' },
        },
      },
    );
    expect(result.skills).toBeDefined();
    const timing = result.skills!.find((s) => s.key === 'timing');
    expect(timing).toBeDefined();
    expect(timing!.name).toBe('Timing');
  });

  it('returns Enigma as title for empty profile', () => {
    const result = getLegendPresentation({});
    expect(result.title).toBe('Enigma');
  });

  it('handles unknown trait keys gracefully', () => {
    const result = getLegendPresentation({ customTrait: 0.7 });
    const custom = result.traits.find((t) => t.key === 'customTrait');
    expect(custom).toBeDefined();
    expect(custom!.name).toBe('Custom Trait');
  });
});

describe('DEFAULT_TRAITS', () => {
  it('has 6 trait definitions', () => {
    expect(Object.keys(DEFAULT_TRAITS)).toHaveLength(6);
  });

  it('each trait has name, description, lowMeaning, and highMeaning', () => {
    for (const def of Object.values(DEFAULT_TRAITS)) {
      expect(typeof def.name).toBe('string');
      expect(typeof def.description).toBe('string');
      expect(typeof def.lowMeaning).toBe('string');
      expect(typeof def.highMeaning).toBe('string');
    }
  });
});

describe('DEFAULT_SKILLS', () => {
  it('has 2 skill definitions', () => {
    expect(Object.keys(DEFAULT_SKILLS)).toHaveLength(2);
  });
});
