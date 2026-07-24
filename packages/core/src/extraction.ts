import type {
  MatchRecord,
  PlayprintData,
  TelemetryEvent,
  ExtractionOptions,
} from './types';
import { mean, stddev, clamp, now } from './utils';
import { PROFILE_MODEL_VERSION } from './traits';

/**
 * Extract a PlayprintData profile from a set of match records.
 * Returns zero-valued profile if no decision events exist.
 */
export function extractProfile(
  matches: MatchRecord[],
  options?: ExtractionOptions,
): PlayprintData {
  const bluffTag = options?.bluffTag ?? 'heavy_bluff';
  const patternBreakTag = options?.patternBreakTag ?? 'pattern_break';

  // Window: use only the most recent N matches
  const windowed = options?.maxMatches
    ? matches.slice(-options.maxMatches)
    : matches;

  const allEvents: TelemetryEvent[] = windowed.flatMap((m) => m.events);

  // Schema version validation
  if (options?.expectedSchemaVersion && options.onVersionMismatch) {
    const expected = options.expectedSchemaVersion;
    const cb = options.onVersionMismatch;
    for (const event of allEvents) {
      if (event.schema_version !== expected) {
        cb(event.schema_version, expected);
        break; // Call once per extraction, not per event
      }
    }
  }

  const decisions = allEvents.filter(
    (e) => e.event_name === 'decision' && e.decision,
  );

  if (decisions.length === 0) {
    return emptyProfile(windowed.length);
  }

  // Decision type diversity (Shannon entropy, normalized).
  //
  // When the game declares its decision-type vocabulary, entropy is
  // Laplace-smoothed over that *fixed* vocabulary, so the normalization
  // denominator no longer depends on which types happened to be observed
  // (a single rare event type used to flip the value dramatically).
  // Without a declared vocabulary, the legacy observed-types formula is kept.
  const typeCounts = new Map<string, number>();
  for (const e of decisions) {
    const dt = e.decision!.decision_type;
    typeCounts.set(dt, (typeCounts.get(dt) ?? 0) + 1);
  }
  let decisionTypeDiversity = 0;
  if (options?.decisionTypeVocabulary && options.decisionTypeVocabulary.length > 0) {
    const vocab = new Set<string>(options.decisionTypeVocabulary);
    for (const t of typeCounts.keys()) vocab.add(t); // union, defensively
    const V = vocab.size;
    if (V >= 2) {
      const alpha = 0.5; // Laplace smoothing
      const total = decisions.length + alpha * V;
      let entropy = 0;
      for (const t of vocab) {
        const p = ((typeCounts.get(t) ?? 0) + alpha) / total;
        entropy -= p * Math.log2(p);
      }
      decisionTypeDiversity = entropy / Math.log2(V);
    }
  } else if (typeCounts.size >= 2) {
    const total = decisions.length;
    let entropy = 0;
    for (const count of typeCounts.values()) {
      const p = count / total;
      entropy -= p * Math.log2(p);
    }
    decisionTypeDiversity = entropy / Math.log2(typeCounts.size);
  }

  // Risk stats
  const risks = decisions.map((e) => e.decision!.risk);
  const aggression = mean(risks);
  const aggressionStdDev = stddev(risks);

  // Information preference
  const infos = decisions.map((e) => e.decision!.information);
  const informationPreference = mean(infos);

  // Tempo distribution
  const tempos = decisions.map((e) => e.decision!.tempo);
  const tempoEarly =
    tempos.filter((t) => t === 'early').length / tempos.length;
  const tempoMid = tempos.filter((t) => t === 'mid').length / tempos.length;
  const tempoLate = tempos.filter((t) => t === 'late').length / tempos.length;

  // Bluff & pattern break rates (across all decisions with tags)
  const allTags = decisions.map((e) => e.decision!.intent_tags ?? []);
  const bluffCount = allTags.filter((tags) => tags.includes(bluffTag)).length;
  const patternBreakCount = allTags.filter((tags) =>
    tags.includes(patternBreakTag),
  ).length;
  const bluffRate = bluffCount / decisions.length;
  const patternBreakRate = patternBreakCount / decisions.length;

  // Situational risk — based on prior outcome deltas within the same match
  const riskWhenWinning = computeSituationalRisk(windowed, 'winning');
  const riskWhenLosing = computeSituationalRisk(windowed, 'losing');

  // Comeback rate
  const comebackRate = computeComebackRate(windowed);

  // Counterplay rate: immediate recovery after losing a round
  const counterplayRate = computeCounterplayRate(windowed);

  // Risk front-loading — match-length invariant urgency signal
  const riskFrontloading = computeRiskFrontloading(windowed);

  // Evidence confidence: grows with observed decisions, asymptotes to 1
  const confidence = decisions.length / (decisions.length + 30);

  // Compute game-specific extensions
  let extensions: Record<string, unknown> | undefined;
  if (options?.extensionExtractors) {
    extensions = {};
    for (const [key, extractor] of Object.entries(options.extensionExtractors)) {
      extensions[key] = extractor(windowed);
    }
  }

  return {
    aggression: clamp(aggression, 0, 1),
    aggressionStdDev: clamp(aggressionStdDev, 0, 1),
    informationPreference: clamp(informationPreference, 0, 1),
    tempoEarly: clamp(tempoEarly, 0, 1),
    tempoMid: clamp(tempoMid, 0, 1),
    tempoLate: clamp(tempoLate, 0, 1),
    bluffRate: clamp(bluffRate, 0, 1),
    patternBreakRate: clamp(patternBreakRate, 0, 1),
    riskWhenWinning: clamp(riskWhenWinning ?? aggression, 0, 1),
    riskWhenLosing: clamp(riskWhenLosing ?? aggression, 0, 1),
    comebackRate: clamp(comebackRate, 0, 1),
    counterplayRate: clamp(counterplayRate, 0, 1),
    decisionTypeDiversity: clamp(decisionTypeDiversity, 0, 1),
    ...(riskFrontloading !== null
      ? { riskFrontloading: clamp(riskFrontloading, 0, 1) }
      : {}),
    confidence: clamp(confidence, 0, 1),
    totalDecisions: decisions.length,
    totalMatches: windowed.length,
    profileModelVersion: PROFILE_MODEL_VERSION,
    generatedAt: now(),
    ...(extensions ? { extensions } : {}),
  };
}

function emptyProfile(totalMatches: number): PlayprintData {
  return {
    aggression: 0,
    aggressionStdDev: 0,
    informationPreference: 0,
    tempoEarly: 0,
    tempoMid: 0,
    tempoLate: 0,
    bluffRate: 0,
    patternBreakRate: 0,
    riskWhenWinning: 0,
    riskWhenLosing: 0,
    comebackRate: 0,
    counterplayRate: 0,
    decisionTypeDiversity: 0,
    confidence: 0,
    totalDecisions: 0,
    totalMatches,
    profileModelVersion: PROFILE_MODEL_VERSION,
    generatedAt: now(),
  };
}

/**
 * Compute mean risk for decisions that follow a positive or negative outcome.
 * Returns null if no qualifying decisions exist.
 */
function computeSituationalRisk(
  matches: MatchRecord[],
  situation: 'winning' | 'losing',
): number | null {
  const qualifyingRisks: number[] = [];

  for (const match of matches) {
    let lastOutcomeDelta: number | null = null;

    for (const event of match.events) {
      if (event.event_name === 'outcome' && event.outcome) {
        lastOutcomeDelta = event.outcome.delta;
      } else if (event.event_name === 'decision' && event.decision && lastOutcomeDelta !== null) {
        if (situation === 'winning' && lastOutcomeDelta > 0) {
          qualifyingRisks.push(event.decision.risk);
        } else if (situation === 'losing' && lastOutcomeDelta < 0) {
          qualifyingRisks.push(event.decision.risk);
        }
      }
    }
  }

  return qualifyingRisks.length > 0 ? mean(qualifyingRisks) : null;
}

/**
 * Risk front-loading: within each match, compare mean decision risk in the
 * first half of the player's decisions against the second half (by order).
 * Because it uses *relative* position, the measure is invariant to match
 * length — unlike absolute-phase tempo counts, which made `urgent` track
 * how long matches happened to run.
 *
 * Returns [0, 1] centered at 0.5 (evenly spread risk), or null when no
 * match has enough decisions to compare.
 */
function computeRiskFrontloading(matches: MatchRecord[]): number | null {
  const deltas: number[] = [];
  for (const match of matches) {
    const risks = match.events
      .filter((e) => e.event_name === 'decision' && e.decision)
      .map((e) => e.decision!.risk);
    if (risks.length < 4) continue;
    const half = Math.floor(risks.length / 2);
    const early = mean(risks.slice(0, half));
    const late = mean(risks.slice(half));
    deltas.push(early - late);
  }
  if (deltas.length === 0) return null;
  // Gain of 2 so typical deltas (±0.25) reach the ends of the range.
  return clamp(0.5 + mean(deltas) * 2, 0, 1);
}

/**
 * Comeback rate: fraction of won matches where the player was losing at the midpoint.
 * "Losing at midpoint" = the cumulative outcome delta is negative halfway through the events.
 */
function computeComebackRate(matches: MatchRecord[]): number {
  const wins = matches.filter((m) => m.result === 'win');
  if (wins.length === 0) return 0;

  let comebacks = 0;
  for (const match of wins) {
    const outcomes = match.events.filter(
      (e) => e.event_name === 'outcome' && e.outcome,
    );
    if (outcomes.length < 2) continue;

    const midpoint = Math.floor(outcomes.length / 2);
    let cumulativeDelta = 0;
    for (let i = 0; i < midpoint; i++) {
      cumulativeDelta += outcomes[i].outcome!.delta;
    }
    if (cumulativeDelta < 0) comebacks++;
  }

  return comebacks / wins.length;
}

/**
 * Counterplay rate: fraction of negative outcomes that are immediately followed
 * by a positive outcome. Measures turn-to-turn adaptability — how often the
 * player bounces back right after losing a round.
 *
 * Only considers consecutive outcome pairs within the same match.
 * Returns 0 if there are no negative outcomes to respond to.
 */
function computeCounterplayRate(matches: MatchRecord[]): number {
  let opportunities = 0;
  let successes = 0;

  for (const match of matches) {
    const outcomes = match.events.filter(
      (e) => e.event_name === 'outcome' && e.outcome,
    );

    for (let i = 0; i < outcomes.length - 1; i++) {
      const current = outcomes[i].outcome!;
      const next = outcomes[i + 1].outcome!;

      // Opportunity: the player just lost a round (negative delta)
      if (current.delta < 0) {
        opportunities++;
        // Success: the player wins the very next round (positive delta)
        if (next.delta > 0) {
          successes++;
        }
      }
    }
  }

  return opportunities > 0 ? successes / opportunities : 0;
}
