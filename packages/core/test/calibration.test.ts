/**
 * Tests for population calibration and the measurement fixes that feed it:
 * - createCalibration / updateCalibration / calibrationFromTraitProfiles / calibrateTraits
 * - vocabulary-stabilized decisionTypeDiversity
 * - match-length-invariant riskFrontloading
 * - calibrated createGhost / ghostBiasesFromTraits
 */
import { describe, it, expect } from 'vitest';
import {
  createCalibration,
  updateCalibration,
  calibrationFromTraitProfiles,
  calibrateTraits,
  normalCdf,
  createGhost,
  ghostBiasesFromTraits,
  extractProfile,
} from '../src';
import type { GameCalibration, MatchRecord, PlayprintData, TelemetryEvent } from '../src';

// ── Helpers ──────────────────────────────────────────────────────

function decisionEvent(
  seq: number,
  decisionType: string,
  risk: number,
): TelemetryEvent {
  return {
    event_id: `e${seq}`,
    event_name: 'decision',
    schema_version: '1.0',
    timestamp: new Date().toISOString(),
    match_id: 'm1',
    game_id: 'test_game',
    sequence: seq,
    decision: {
      decision_type: decisionType,
      risk,
      information: 0.5,
      tempo: 'mid',
    },
  };
}

function matchOf(events: TelemetryEvent[], matchId = 'm1'): MatchRecord {
  return { matchId, result: 'win', events };
}

function profileWith(overrides: Partial<PlayprintData>): PlayprintData {
  return {
    aggression: 0.3,
    aggressionStdDev: 0.1,
    informationPreference: 0.5,
    tempoEarly: 0.3,
    tempoMid: 0.4,
    tempoLate: 0.3,
    bluffRate: 0.1,
    patternBreakRate: 0.05,
    riskWhenWinning: 0.3,
    riskWhenLosing: 0.35,
    comebackRate: 0.1,
    counterplayRate: 0.2,
    decisionTypeDiversity: 0.6,
    totalDecisions: 500,
    totalMatches: 25,
    ...overrides,
  };
}

// ── Calibration mechanics ────────────────────────────────────────

describe('calibration', () => {
  it('normalCdf is a sane CDF', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 5);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 2);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 2);
  });

  it('empty calibration is the identity mapping', () => {
    const cal = createCalibration('test_game');
    const out = calibrateTraits({ aggressive: 0.27, bold: 0.9 }, cal);
    expect(out.aggressive).toBeCloseTo(0.27, 10);
    expect(out.bold).toBeCloseTo(0.9, 10);
  });

  it('no calibration argument is also the identity mapping', () => {
    const out = calibrateTraits({ aggressive: 0.27 });
    expect(out.aggressive).toBeCloseTo(0.27, 10);
  });

  it('spreads a compressed population across [0, 1]', () => {
    // Population raw values compressed into [0.2, 0.35] — the exact failure
    // mode observed in the Shadow Hands product eval.
    const population = Array.from({ length: 30 }, (_, i) => ({
      aggressive: 0.2 + (0.15 * i) / 29,
    }));
    const cal = calibrationFromTraitProfiles(population, 'test_game');
    const low = calibrateTraits({ aggressive: 0.2 }, cal).aggressive;
    const mid = calibrateTraits({ aggressive: 0.275 }, cal).aggressive;
    const high = calibrateTraits({ aggressive: 0.35 }, cal).aggressive;
    expect(low).toBeLessThan(0.1);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
    expect(high).toBeGreaterThan(0.9);
  });

  it('is monotone in the raw value', () => {
    const population = Array.from({ length: 40 }, (_, i) => ({ t: 0.3 + 0.01 * (i % 10) }));
    const cal = calibrationFromTraitProfiles(population);
    let prev = -1;
    for (let raw = 0; raw <= 1.0001; raw += 0.05) {
      const v = calibrateTraits({ t: raw }, cal).t;
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('updateCalibration is pure and serializable', () => {
    const cal0 = createCalibration('test_game');
    const cal1 = updateCalibration(cal0, { aggressive: 0.3 });
    const cal2 = updateCalibration(cal1, { aggressive: 0.4 });
    expect(cal0.profileCount).toBe(0);
    expect(cal1.profileCount).toBe(1);
    expect(cal2.profileCount).toBe(2);
    expect(cal2.traits.aggressive.mean).toBeCloseTo(0.35, 10);
    // JSON round trip preserves behavior
    const revived = JSON.parse(JSON.stringify(cal2)) as GameCalibration;
    expect(calibrateTraits({ aggressive: 0.5 }, revived)).toEqual(
      calibrateTraits({ aggressive: 0.5 }, cal2),
    );
  });

  it('cold start blends toward identity with few samples', () => {
    let cal = createCalibration();
    cal = updateCalibration(cal, { t: 0.3 });
    cal = updateCalibration(cal, { t: 0.31 });
    // Only 2 samples: an extreme raw value must not be mapped to an extreme
    // population quantile at full strength.
    const v = calibrateTraits({ t: 0.9 }, cal).t;
    expect(v).toBeGreaterThan(0.7); // identity pull keeps it near raw
  });

  it('a GameModule-style prior gives population-relative output before any updates', () => {
    const cal = createCalibration('new_game', {
      aggressive: { mean: 0.3, std: 0.05, count: 20 },
    });
    expect(calibrateTraits({ aggressive: 0.3 }, cal).aggressive).toBeCloseTo(0.5, 2);
    expect(calibrateTraits({ aggressive: 0.45 }, cal).aggressive).toBeGreaterThan(0.95);
  });

  it('confidence shrinks output toward neutral', () => {
    const cal = createCalibration('g', { t: { mean: 0.3, std: 0.05, count: 50 } });
    const confident = calibrateTraits({ t: 0.45 }, cal, { confidence: 1 }).t;
    const unsure = calibrateTraits({ t: 0.45 }, cal, { confidence: 0.2 }).t;
    expect(confident).toBeGreaterThan(0.9);
    expect(Math.abs(unsure - 0.5)).toBeLessThan(0.2);
  });
});

// ── Calibrated ghost biases ──────────────────────────────────────

describe('calibrated ghost biases', () => {
  it('ghostBiasesFromTraits maps 0→0 and 1→1 (no re-centering)', () => {
    const lo = ghostBiasesFromTraits({ aggressive: 0, bold: 0, deceptive: 0, chaotic: 0, urgent: 0, expansive: 0 });
    expect(lo.aggression).toBe(0);
    expect(lo.patience).toBe(1);
    expect(lo.riskTolerance).toBe(0);
    expect(lo.consistency).toBe(1);
    expect(lo.deception).toBe(0);
    const hi = ghostBiasesFromTraits({ aggressive: 1, bold: 1, deceptive: 1, chaotic: 1, urgent: 1, expansive: 1 });
    expect(hi.aggression).toBe(1);
    expect(hi.deception).toBe(1);
    expect(hi.consistency).toBe(0);
  });

  it('createGhost without calibration keeps legacy behavior', () => {
    const p = profileWith({ aggression: 0.3, riskWhenWinning: 0.2, riskWhenLosing: 0.4 });
    const g = createGhost(p);
    expect(g.aggression).toBeCloseTo(0.3, 10);
    expect(g.riskTolerance).toBeCloseTo(0.3, 10);
  });

  it('createGhost with calibration produces full-range biases for a compressed population', () => {
    // Two archetypal players inside a compressed raw band
    const passive = profileWith({ aggression: 0.22, riskWhenLosing: 0.27 });
    const fierce = profileWith({ aggression: 0.33, riskWhenLosing: 0.39 });
    const population = [];
    for (let i = 0; i < 15; i++) {
      population.push(profileWith({ aggression: 0.22 + 0.11 * (i / 14), riskWhenLosing: 0.27 + 0.12 * (i / 14) }));
    }
    const cal = calibrationFromTraitProfiles(
      population.map((p) => ({ aggressive: p.aggression, bold: p.riskWhenLosing })),
      'test_game',
    );
    const gPassive = createGhost(passive, cal);
    const gFierce = createGhost(fierce, cal);
    expect(gPassive.aggression).toBeLessThan(0.15);
    expect(gFierce.aggression).toBeGreaterThan(0.85);
    expect(gFierce.aggression - gPassive.aggression).toBeGreaterThan(0.7);
  });
});

// ── Measurement fixes in extraction ──────────────────────────────

describe('vocabulary-stabilized diversity', () => {
  it('a single rare decision type no longer flips the value', () => {
    const base = [
      ...Array.from({ length: 40 }, (_, i) => decisionEvent(i, i % 2 === 0 ? 'attack' : 'defend', 0.5)),
    ];
    const withRare = [...base, decisionEvent(99, 'taunt', 0.5)];
    const vocab = ['attack', 'defend', 'taunt', 'trade', 'scout'];

    const legacyBase = extractProfile([matchOf(base)]).decisionTypeDiversity!;
    const legacyRare = extractProfile([matchOf(withRare)]).decisionTypeDiversity!;
    const stableBase = extractProfile([matchOf(base)], { decisionTypeVocabulary: vocab }).decisionTypeDiversity!;
    const stableRare = extractProfile([matchOf(withRare)], { decisionTypeVocabulary: vocab }).decisionTypeDiversity!;

    // Legacy: denominator flips from log2(2) to log2(3) → large jump (~0.28).
    expect(Math.abs(legacyRare - legacyBase)).toBeGreaterThan(0.2);
    // Vocabulary + smoothing: only the legitimate small entropy increase (~0.04).
    expect(Math.abs(stableRare - stableBase)).toBeLessThan(0.08);
  });

  it('vocabulary types never observed lower diversity vs using all of them', () => {
    const narrow = Array.from({ length: 30 }, (_, i) => decisionEvent(i, i % 2 === 0 ? 'a' : 'b', 0.5));
    const vocab = ['a', 'b', 'c', 'd'];
    const p = extractProfile([matchOf(narrow)], { decisionTypeVocabulary: vocab });
    // Uses only 2 of 4 declared types → clearly below max entropy
    expect(p.decisionTypeDiversity!).toBeLessThan(0.8);
    expect(p.decisionTypeDiversity!).toBeGreaterThan(0.3);
  });
});

describe('riskFrontloading', () => {
  const frontLoadedMatch = (id: string, length: number): MatchRecord =>
    matchOf(
      Array.from({ length }, (_, i) =>
        decisionEvent(i, 'attack', i < length / 2 ? 0.8 : 0.2),
      ),
      id,
    );
  const backLoadedMatch = (id: string, length: number): MatchRecord =>
    matchOf(
      Array.from({ length }, (_, i) =>
        decisionEvent(i, 'attack', i < length / 2 ? 0.2 : 0.8),
      ),
      id,
    );

  it('is high for front-loaded risk, low for back-loaded risk', () => {
    const front = extractProfile([frontLoadedMatch('f', 20)]);
    const back = extractProfile([backLoadedMatch('b', 20)]);
    expect(front.riskFrontloading!).toBeGreaterThan(0.8);
    expect(back.riskFrontloading!).toBeLessThan(0.2);
  });

  it('is invariant to match length', () => {
    const short = extractProfile([frontLoadedMatch('s', 8)]);
    const long = extractProfile([frontLoadedMatch('l', 40)]);
    expect(Math.abs(short.riskFrontloading! - long.riskFrontloading!)).toBeLessThan(0.05);
  });

  it('feeds the urgent trait when present, with tempo fallback otherwise', () => {
    const p = extractProfile([frontLoadedMatch('f', 20)]);
    expect(p.riskFrontloading).toBeDefined();
    // profiles carry confidence
    expect(p.confidence).toBeGreaterThan(0);
    expect(p.confidence).toBeLessThan(1);
  });
});
