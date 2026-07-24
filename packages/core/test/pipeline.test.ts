/**
 * End-to-end pipeline integration tests:
 * PlayprintData → deriveTraits → generateArchetype → getLegendPresentation
 *
 * Key insight: the default makeProfile() must produce traits near 0.5
 * in trait-space, NOT just in PlayprintData-space. The derivation formulas
 * can amplify small deviations. This baseline is calibrated so all 6 traits
 * land at 0.5.
 */
import { describe, it, expect } from 'vitest';
import { deriveTraits } from '../src/traits';
import { generateArchetype } from '../src/generative-archetypes';
import { getLegendPresentation } from '../src/presentation';
import type { PlayprintData } from '../src/types';

/**
 * Balanced baseline: all 6 derived traits come out at 0.5.
 *
 *  aggressive = 0.5            (from aggression: 0.5)
 *  bold = 0.5                  (from riskWhenLosing: 0.5)
 *  deceptive = 0.5             (from (bluffRate+patternBreakRate)/2 = (0.5+0.5)/2)
 *  chaotic = 0.5               (from aggressionStdDev*2.5 = 0.2*2.5)
 *  urgent = 0.5                (from tempoEarly*1 + tempoMid*0.5 = 0.33+0.17)
 *  expansive = 0.5             (constant)
 */
function makeProfile(overrides: Partial<PlayprintData> = {}): PlayprintData {
  return {
    aggression: 0.5,
    aggressionStdDev: 0.2,
    informationPreference: 0.5,
    tempoEarly: 0.33,
    tempoMid: 0.34,
    tempoLate: 0.33,
    bluffRate: 0.5,
    patternBreakRate: 0.5,
    riskWhenWinning: 0.75,
    riskWhenLosing: 0.5,
    comebackRate: 0.3,
    counterplayRate: 0.0,
    totalDecisions: 100,
    totalMatches: 10,
    ...overrides,
  };
}

describe('full pipeline: PlayprintData → traits → archetype → presentation', () => {
  it('balanced PlayprintData produces Enigma', () => {
    const profile = makeProfile();
    const traits = deriveTraits(profile);
    const archetype = generateArchetype(traits);

    // All traits should be at or very near 0.5
    for (const key of Object.keys(traits)) {
      expect(traits[key]).toBeCloseTo(0.5, 1);
    }

    expect(archetype.coreArchetype).toBe('Enigma');
    expect(archetype.displayName).toBe('Enigma');
    expect(archetype.handleWords).toEqual(['Enigma']);
  });

  it('produces a complete presentation from aggressive PlayprintData', () => {
    const profile = makeProfile({ aggression: 0.85 });
    const traits = deriveTraits(profile);
    const archetype = generateArchetype(traits);
    const presentation = getLegendPresentation(traits);

    // Aggressive is the dominant trait
    expect(traits.aggressive).toBe(0.85);
    expect(archetype.coreArchetype).toBe('Berserker');
    // displayName is now a handle (e.g. 'Fierce Cautious Precise'), not 'X Berserker'
    expect(archetype.displayName.length).toBeGreaterThan(0);
    expect(archetype.handleWords.length).toBeGreaterThanOrEqual(3);
    expect(archetype.tagline.length).toBeGreaterThan(0);

    // Presentation wraps everything
    expect(presentation.title.length).toBeGreaterThan(0);
    expect(presentation.traits.length).toBe(6);
    expect(presentation.archetype).toBeDefined();
    expect(presentation.archetype!.coreArchetype).toBe('Berserker');
    expect(presentation.safetyNote).toBeTruthy();
    expect(presentation.trainingNote).toBeTruthy();
  });

  it('low-risk player gets Sentinel', () => {
    // riskWhenLosing: 0.05 → bold = 0.05, signal = 0.9
    const profile = makeProfile({ riskWhenLosing: 0.05, riskWhenWinning: 0.3 });
    const traits = deriveTraits(profile);
    const archetype = generateArchetype(traits);

    expect(traits.bold).toBe(0.05);
    expect(archetype.coreArchetype).toBe('Sentinel');
  });

  it('high deception player gets Phantom', () => {
    // bluffRate + patternBreakRate both high → deceptive near 1.0
    const profile = makeProfile({ bluffRate: 0.9, patternBreakRate: 0.9 });
    const traits = deriveTraits(profile);
    const archetype = generateArchetype(traits);

    expect(traits.deceptive).toBeCloseTo(0.9);
    expect(archetype.coreArchetype).toBe('Phantom');
  });

  it('pipeline is deterministic across multiple runs', () => {
    const profile = makeProfile({ aggression: 0.75 });

    const run = () => {
      const traits = deriveTraits(profile);
      const archetype = generateArchetype(traits);
      const presentation = getLegendPresentation(traits);
      return { traits, archetype, presentation };
    };

    const a = run();
    const b = run();

    expect(a.traits).toEqual(b.traits);
    expect(a.archetype).toEqual(b.archetype);
    expect(a.presentation.title).toBe(b.presentation.title);
    expect(a.presentation.archetype).toEqual(b.presentation.archetype);
  });

  it('pipeline works with trait overrides', () => {
    const profile = makeProfile();
    const traits = deriveTraits(profile, {
      overrides: {
        expansive: () => 0.95,
      },
    });
    const archetype = generateArchetype(traits);

    // expansive has signal 0.9, strongest → Cartographer
    expect(archetype.coreArchetype).toBe('Cartographer');
  });

  it('presentation archetype matches standalone archetype call', () => {
    const profile = makeProfile({ aggression: 0.9 });
    const traits = deriveTraits(profile);
    const standalone = generateArchetype(traits);
    const presentation = getLegendPresentation(traits);

    expect(presentation.archetype).toEqual(standalone);
  });
});
