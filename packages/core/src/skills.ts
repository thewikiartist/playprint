/**
 * Core Skill Extraction
 *
 * Two universal skills computed from decision-outcome pairing:
 * - **precision**: fraction of high-risk decisions followed by positive outcomes
 * - **efficiency**: normalized mean outcome delta
 *
 * Game-specific skills (e.g. Shadow Hands' 8-skill Bayesian system) are
 * separate and registered via GameModule.skills.
 */

import type { MatchRecord, TelemetryEvent } from './types';

/** Core skill scores computed from decision-outcome pairing. */
export interface CoreSkillScores {
  /** Fraction of high-risk decisions (risk > 0.5) followed by positive outcomes. Bayesian-shrunk toward 0.5. */
  precision: number;
  /** Normalized mean outcome delta. 0 = all negative, 0.5 = neutral, 1 = all positive. */
  efficiency: number;
}

interface DecisionOutcomePair {
  risk: number;
  delta: number;
}

/**
 * Walk events chronologically within a match and pair each decision
 * with the next outcome event in the same match.
 */
export function pairDecisionsWithOutcomes(
  events: TelemetryEvent[],
): DecisionOutcomePair[] {
  const pairs: DecisionOutcomePair[] = [];
  let pendingDecision: { risk: number } | null = null;

  for (const event of events) {
    if (event.event_name === 'decision' && event.decision) {
      pendingDecision = { risk: event.decision.risk };
    } else if (event.event_name === 'outcome' && event.outcome && pendingDecision) {
      pairs.push({
        risk: pendingDecision.risk,
        delta: event.outcome.delta,
      });
      pendingDecision = null;
    }
  }

  return pairs;
}

/**
 * Extract core skills from match history.
 *
 * Returns default scores (0.5/0.5) when below `minPairs` threshold.
 *
 * @param matches - Completed match records with telemetry events.
 * @param minPairs - Minimum decision-outcome pairs required. Default: 10.
 */
export function extractCoreSkills(
  matches: MatchRecord[],
  minPairs = 10,
): CoreSkillScores {
  const allPairs: DecisionOutcomePair[] = [];
  for (const match of matches) {
    allPairs.push(...pairDecisionsWithOutcomes(match.events));
  }

  if (allPairs.length < minPairs) {
    return { precision: 0.5, efficiency: 0.5 };
  }

  // Precision: fraction of high-risk decisions (risk > 0.5) with positive outcome
  const highRiskPairs = allPairs.filter((p) => p.risk > 0.5);
  let precision = 0.5;
  if (highRiskPairs.length > 0) {
    const successes = highRiskPairs.filter((p) => p.delta > 0).length;
    // Bayesian shrinkage toward 0.5 with prior strength 5
    const priorStrength = 5;
    precision =
      (successes + priorStrength * 0.5) /
      (highRiskPairs.length + priorStrength);
  }

  // Efficiency: (mean(delta) + 1) / 2, mapping [-1, 1] to [0, 1]
  const meanDelta =
    allPairs.reduce((sum, p) => sum + p.delta, 0) / allPairs.length;
  const efficiency = Math.max(0, Math.min(1, (meanDelta + 1) / 2));

  return { precision, efficiency };
}
