import { describe, it, expect } from 'vitest';
import { getArchetype } from '../src/archetypes';
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
    totalDecisions: 100,
    totalMatches: 10,
    ...overrides,
  };
}

describe('getArchetype', () => {
  it('classifies Reckless (aggression >= 0.65)', () => {
    const arch = getArchetype(makeProfile({ aggression: 0.75 }));
    expect(arch.name).toBe('Reckless');
    expect(arch.modifier).toBeUndefined();
  });

  it('classifies Calculated (0.45 <= aggression < 0.65)', () => {
    const arch = getArchetype(makeProfile({ aggression: 0.50 }));
    expect(arch.name).toBe('Calculated');
  });

  it('classifies Patient (0.30 <= aggression < 0.45)', () => {
    const arch = getArchetype(makeProfile({ aggression: 0.35 }));
    expect(arch.name).toBe('Patient');
  });

  it('classifies Cautious (aggression < 0.30)', () => {
    const arch = getArchetype(makeProfile({ aggression: 0.15 }));
    expect(arch.name).toBe('Cautious');
  });

  it('adds Deceiver modifier when deception >= 0.20', () => {
    const arch = getArchetype(
      makeProfile({ aggression: 0.5, bluffRate: 0.12, patternBreakRate: 0.10 }),
    );
    expect(arch.name).toBe('Calculated');
    expect(arch.modifier).toBe('Deceiver');
  });

  it('no Deceiver modifier when deception < 0.20', () => {
    const arch = getArchetype(
      makeProfile({ bluffRate: 0.05, patternBreakRate: 0.05 }),
    );
    expect(arch.modifier).toBeUndefined();
  });

  it('handles boundary at 0.65', () => {
    const arch = getArchetype(makeProfile({ aggression: 0.65 }));
    expect(arch.name).toBe('Reckless');
  });

  it('handles boundary at 0.45', () => {
    const arch = getArchetype(makeProfile({ aggression: 0.45 }));
    expect(arch.name).toBe('Calculated');
  });

  it('handles boundary at 0.30', () => {
    const arch = getArchetype(makeProfile({ aggression: 0.30 }));
    expect(arch.name).toBe('Patient');
  });

  it('handles boundary at deception = 0.20', () => {
    const arch = getArchetype(
      makeProfile({ bluffRate: 0.10, patternBreakRate: 0.10 }),
    );
    expect(arch.modifier).toBe('Deceiver');
  });
});
