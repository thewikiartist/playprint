import { describe, it, expect } from 'vitest';
import { createGhost, mapGhostBiases } from '../src/ghost';
import type { PlayprintData } from '../src/types';

function makeProfile(overrides: Partial<PlayprintData> = {}): PlayprintData {
  return {
    aggression: 0.5,
    aggressionStdDev: 0.1,
    informationPreference: 0.5,
    tempoEarly: 0.33,
    tempoMid: 0.34,
    tempoLate: 0.33,
    bluffRate: 0.1,
    patternBreakRate: 0.05,
    riskWhenWinning: 0.4,
    riskWhenLosing: 0.6,
    comebackRate: 0.3,
    totalDecisions: 100,
    totalMatches: 10,
    ...overrides,
  };
}

describe('createGhost', () => {
  it('maps a known profile to expected biases', () => {
    const profile = makeProfile({
      aggression: 0.7,
      aggressionStdDev: 0.2,
      bluffRate: 0.15,
      patternBreakRate: 0.1,
      riskWhenWinning: 0.6,
      riskWhenLosing: 0.8,
    });

    const ghost = createGhost(profile);

    expect(ghost.aggression).toBeCloseTo(0.7);
    expect(ghost.patience).toBeCloseTo(0.3);
    expect(ghost.riskTolerance).toBeCloseTo(0.7); // (0.6 + 0.8) / 2
    expect(ghost.consistency).toBeCloseTo(0.8); // 1 - 0.2
    expect(ghost.deception).toBeCloseTo(0.125); // (0.15 + 0.1) / 2
  });

  it('handles an all-zero profile', () => {
    const profile = makeProfile({
      aggression: 0,
      aggressionStdDev: 0,
      bluffRate: 0,
      patternBreakRate: 0,
      riskWhenWinning: 0,
      riskWhenLosing: 0,
    });

    const ghost = createGhost(profile);

    expect(ghost.aggression).toBe(0);
    expect(ghost.patience).toBe(1);
    expect(ghost.riskTolerance).toBe(0);
    expect(ghost.consistency).toBe(1);
    expect(ghost.deception).toBe(0);
  });

  it('handles extreme aggressive profile', () => {
    const profile = makeProfile({
      aggression: 1,
      aggressionStdDev: 0,
      bluffRate: 0.5,
      patternBreakRate: 0.5,
      riskWhenWinning: 1,
      riskWhenLosing: 1,
    });

    const ghost = createGhost(profile);

    expect(ghost.aggression).toBe(1);
    expect(ghost.patience).toBe(0);
    expect(ghost.riskTolerance).toBe(1);
    expect(ghost.consistency).toBe(1);
    expect(ghost.deception).toBe(0.5);
  });

  it('clamps values to [0, 1]', () => {
    const profile = makeProfile({
      aggression: 1.5,
      aggressionStdDev: 1.5,
      bluffRate: 0.8,
      patternBreakRate: 0.8,
      riskWhenWinning: 1.2,
      riskWhenLosing: 1.3,
    });

    const ghost = createGhost(profile);

    expect(ghost.aggression).toBe(1);
    expect(ghost.patience).toBe(0);
    expect(ghost.consistency).toBe(0);
    expect(ghost.deception).toBeLessThanOrEqual(1);
    expect(ghost.riskTolerance).toBeLessThanOrEqual(1);
  });
});

describe('mapGhostBiases', () => {
  it('linearly interpolates bias values to parameter ranges', () => {
    const ghost = createGhost(makeProfile({ aggression: 0.8, bluffRate: 0.3, patternBreakRate: 0.1 }));

    const params = mapGhostBiases(ghost, {
      attackFrequency: { bias: 'aggression', range: [0.1, 0.9] },
      bluffChance: { bias: 'deception', range: [0, 0.3] },
    });

    // aggression = 0.8 → 0.1 + 0.8 * 0.8 = 0.74
    expect(params.attackFrequency).toBeCloseTo(0.1 + 0.8 * 0.8);
    // deception = (0.3 + 0.1) / 2 = 0.2 → 0 + 0.2 * 0.3 = 0.06
    expect(params.bluffChance).toBeCloseTo(0 + 0.2 * 0.3);
  });

  it('maps bias 0 to low end, bias 1 to high end', () => {
    const zeroGhost = createGhost(makeProfile({ aggression: 0, aggressionStdDev: 0 }));
    const maxGhost = createGhost(makeProfile({ aggression: 1, aggressionStdDev: 0 }));

    const mapping = { speed: { bias: 'aggression' as const, range: [10, 100] as [number, number] } };

    expect(mapGhostBiases(zeroGhost, mapping).speed).toBeCloseTo(10);
    expect(mapGhostBiases(maxGhost, mapping).speed).toBeCloseTo(100);
  });
});
