import { describe, it, expect } from 'vitest';
import { extractProfile } from '../src/extraction';
import { PROFILE_MODEL_VERSION } from '../src/traits';
import type { MatchRecord, TelemetryEvent } from '../src/types';

function makeEvent(
  overrides: Partial<TelemetryEvent> & { event_name: string },
): TelemetryEvent {
  return {
    event_id: 'e1',
    event_name: overrides.event_name,
    schema_version: '1.0',
    timestamp: new Date().toISOString(),
    match_id: 'm1',
    game_id: 'test',
    sequence: 0,
    ...overrides,
  };
}

function makeDecisionEvent(
  risk: number,
  information: number,
  tempo: 'early' | 'mid' | 'late' = 'mid',
  tags: string[] = [],
  seq = 0,
): TelemetryEvent {
  return makeEvent({
    event_name: 'decision',
    sequence: seq,
    decision: {
      decision_type: 'action',
      risk,
      information,
      tempo,
      intent_tags: tags,
    },
  });
}

function makeOutcomeEvent(delta: number, seq = 0): TelemetryEvent {
  return makeEvent({
    event_name: 'outcome',
    sequence: seq,
    outcome: { outcome_type: 'turn', delta },
  });
}

describe('extractProfile', () => {
  it('returns zeros for empty matches', () => {
    const profile = extractProfile([]);
    expect(profile.totalDecisions).toBe(0);
    expect(profile.totalMatches).toBe(0);
    expect(profile.aggression).toBe(0);
  });

  it('returns zeros for matches with no decisions', () => {
    const match: MatchRecord = {
      matchId: 'm1',
      result: 'win',
      events: [makeEvent({ event_name: 'match.start' })],
    };
    const profile = extractProfile([match]);
    expect(profile.totalDecisions).toBe(0);
    expect(profile.totalMatches).toBe(1);
  });

  it('computes aggression from risk values', () => {
    const match: MatchRecord = {
      matchId: 'm1',
      result: 'win',
      events: [
        makeDecisionEvent(0.8, 0.5),
        makeDecisionEvent(0.6, 0.5),
        makeDecisionEvent(0.4, 0.5),
      ],
    };
    const profile = extractProfile([match]);
    expect(profile.aggression).toBeCloseTo(0.6);
    expect(profile.aggressionStdDev).toBeGreaterThan(0);
  });

  it('computes tempo distribution', () => {
    const match: MatchRecord = {
      matchId: 'm1',
      result: 'win',
      events: [
        makeDecisionEvent(0.5, 0.5, 'early'),
        makeDecisionEvent(0.5, 0.5, 'early'),
        makeDecisionEvent(0.5, 0.5, 'mid'),
        makeDecisionEvent(0.5, 0.5, 'late'),
      ],
    };
    const profile = extractProfile([match]);
    expect(profile.tempoEarly).toBeCloseTo(0.5);
    expect(profile.tempoMid).toBeCloseTo(0.25);
    expect(profile.tempoLate).toBeCloseTo(0.25);
  });

  it('computes bluff and pattern break rates', () => {
    const match: MatchRecord = {
      matchId: 'm1',
      result: 'win',
      events: [
        makeDecisionEvent(0.5, 0.5, 'mid', ['heavy_bluff']),
        makeDecisionEvent(0.5, 0.5, 'mid', ['pattern_break']),
        makeDecisionEvent(0.5, 0.5, 'mid', []),
        makeDecisionEvent(0.5, 0.5, 'mid', []),
      ],
    };
    const profile = extractProfile([match]);
    expect(profile.bluffRate).toBeCloseTo(0.25);
    expect(profile.patternBreakRate).toBeCloseTo(0.25);
  });

  it('computes comeback rate', () => {
    // Win from behind: losing at midpoint but won
    const comebackMatch: MatchRecord = {
      matchId: 'm1',
      result: 'win',
      events: [
        makeOutcomeEvent(-0.5, 0),
        makeOutcomeEvent(-0.3, 1),
        makeOutcomeEvent(0.8, 2),
        makeOutcomeEvent(0.5, 3),
      ],
    };

    // Clean win: winning throughout
    const cleanWin: MatchRecord = {
      matchId: 'm2',
      result: 'win',
      events: [
        makeDecisionEvent(0.5, 0.5),
        makeOutcomeEvent(0.5, 0),
        makeOutcomeEvent(0.3, 1),
      ],
    };

    const profile = extractProfile([comebackMatch, cleanWin]);
    // 1 comeback out of 2 wins = 0.5
    expect(profile.comebackRate).toBeCloseTo(0.5);
  });

  it('computes situational risk from outcome deltas', () => {
    const match: MatchRecord = {
      matchId: 'm1',
      result: 'win',
      events: [
        makeOutcomeEvent(0.5, 0),       // winning context
        makeDecisionEvent(0.3, 0.5, 'mid', [], 1), // decision when winning
        makeOutcomeEvent(-0.5, 2),      // losing context
        makeDecisionEvent(0.9, 0.5, 'mid', [], 3), // decision when losing
      ],
    };
    const profile = extractProfile([match]);
    expect(profile.riskWhenWinning).toBeCloseTo(0.3);
    expect(profile.riskWhenLosing).toBeCloseTo(0.9);
  });

  it('aggregates across multiple matches', () => {
    const m1: MatchRecord = {
      matchId: 'm1',
      result: 'win',
      events: [makeDecisionEvent(0.8, 0.6)],
    };
    const m2: MatchRecord = {
      matchId: 'm2',
      result: 'loss',
      events: [makeDecisionEvent(0.2, 0.4)],
    };
    const profile = extractProfile([m1, m2]);
    expect(profile.totalMatches).toBe(2);
    expect(profile.totalDecisions).toBe(2);
    expect(profile.aggression).toBeCloseTo(0.5);
    expect(profile.informationPreference).toBeCloseTo(0.5);
  });

  it('uses custom tag names', () => {
    const match: MatchRecord = {
      matchId: 'm1',
      result: 'win',
      events: [
        makeDecisionEvent(0.5, 0.5, 'mid', ['my_bluff']),
        makeDecisionEvent(0.5, 0.5, 'mid', []),
      ],
    };
    const profile = extractProfile([match], { bluffTag: 'my_bluff' });
    expect(profile.bluffRate).toBeCloseTo(0.5);
  });

  it('populates extensions from extensionExtractors', () => {
    const match: MatchRecord = {
      matchId: 'm1',
      result: 'win',
      events: [
        makeDecisionEvent(0.5, 0.5, 'mid', []),
        makeDecisionEvent(0.7, 0.5, 'mid', []),
      ],
    };

    const profile = extractProfile([match], {
      extensionExtractors: {
        avgRisk: (matches) => {
          const risks = matches.flatMap((m) =>
            m.events
              .filter((e) => e.decision)
              .map((e) => e.decision!.risk),
          );
          return risks.reduce((s, v) => s + v, 0) / risks.length;
        },
        matchCount: (matches) => matches.length,
      },
    });

    expect(profile.extensions).toBeDefined();
    expect(profile.extensions!.avgRisk).toBeCloseTo(0.6);
    expect(profile.extensions!.matchCount).toBe(1);
  });

  it('omits extensions when no extractors provided', () => {
    const match: MatchRecord = {
      matchId: 'm1',
      result: 'win',
      events: [makeDecisionEvent(0.5, 0.5)],
    };
    const profile = extractProfile([match]);
    expect(profile.extensions).toBeUndefined();
  });

  it('windows to maxMatches most recent matches', () => {
    const old: MatchRecord = {
      matchId: 'm1',
      result: 'win',
      events: [makeDecisionEvent(0.9, 0.5)], // aggressive old match
    };
    const recent1: MatchRecord = {
      matchId: 'm2',
      result: 'win',
      events: [makeDecisionEvent(0.2, 0.5)],
    };
    const recent2: MatchRecord = {
      matchId: 'm3',
      result: 'loss',
      events: [makeDecisionEvent(0.2, 0.5)],
    };

    // Without windowing: mean(0.9, 0.2, 0.2) ≈ 0.433
    const fullProfile = extractProfile([old, recent1, recent2]);
    expect(fullProfile.aggression).toBeCloseTo(0.433, 2);
    expect(fullProfile.totalMatches).toBe(3);

    // With maxMatches=2: only recent matches, mean(0.2, 0.2) = 0.2
    const windowedProfile = extractProfile([old, recent1, recent2], { maxMatches: 2 });
    expect(windowedProfile.aggression).toBeCloseTo(0.2);
    expect(windowedProfile.totalMatches).toBe(2);
  });

  // ── Output clamping safety net ─────────────────────────────

  it('clamps all profile values to [0, 1]', () => {
    const match: MatchRecord = {
      matchId: 'm1',
      result: 'win',
      events: [makeDecisionEvent(0.5, 0.5)],
    };
    const profile = extractProfile([match]);

    const numericFields = [
      'aggression', 'aggressionStdDev', 'informationPreference',
      'tempoEarly', 'tempoMid', 'tempoLate',
      'bluffRate', 'patternBreakRate',
      'riskWhenWinning', 'riskWhenLosing', 'comebackRate',
    ] as const;

    for (const field of numericFields) {
      expect(profile[field]).toBeGreaterThanOrEqual(0);
      expect(profile[field]).toBeLessThanOrEqual(1);
    }
  });

  it('survives NaN in risk values without corrupting profile', () => {
    // Simulate a decision event where risk is NaN (defensive safety net)
    const match: MatchRecord = {
      matchId: 'm1',
      result: 'win',
      events: [
        makeEvent({
          event_name: 'decision',
          decision: {
            decision_type: 'action',
            risk: NaN,
            information: 0.5,
            tempo: 'mid',
            intent_tags: [],
          },
        }),
        makeDecisionEvent(0.6, 0.5),
      ],
    };
    const profile = extractProfile([match]);
    // NaN risk should be filtered by mean(); valid risk should produce 0.6
    expect(profile.aggression).toBeCloseTo(0.6);
    expect(Number.isFinite(profile.aggression)).toBe(true);
  });

  it('stamps profileModelVersion and generatedAt on extracted profiles', () => {
    const match: MatchRecord = {
      matchId: 'm1',
      result: 'win',
      events: [makeDecisionEvent(0.5, 0.5)],
    };
    const profile = extractProfile([match]);
    expect(profile.profileModelVersion).toBe(PROFILE_MODEL_VERSION);
    expect(typeof profile.generatedAt).toBe('string');
    expect(Number.isNaN(Date.parse(profile.generatedAt!))).toBe(false);
  });

  it('stamps versions on empty profiles too', () => {
    const profile = extractProfile([]);
    expect(profile.profileModelVersion).toBe(PROFILE_MODEL_VERSION);
    expect(typeof profile.generatedAt).toBe('string');
  });
});
