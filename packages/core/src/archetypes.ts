import type { PlayprintData, Archetype } from './types';
import { deriveTraits } from './traits';
import { calibrateTraits } from './calibration';
import type { GameCalibration } from './calibration';

/**
 * Classify a player profile into a simple archetype.
 *
 * Without a calibration, uses raw aggression thresholds (0.65/0.45/0.30)
 * and a raw deception threshold (0.20) — legacy behavior, which collapses
 * when a game's raw values occupy a narrow band.
 *
 * With a `GameCalibration`, classification happens in population-relative
 * space: the thresholds become population quantiles (top quarter of players
 * → 'Reckless', bottom quarter → 'Cautious', unusually deceptive →
 * 'Deceiver'), which keeps the buckets meaningful for any game.
 */
export function getArchetype(
  profile: PlayprintData<any>,
  calibration?: GameCalibration | null,
): Archetype {
  if (calibration) {
    const t = calibrateTraits(deriveTraits(profile), calibration, {
      confidence: profile.confidence,
    });
    const aggressive = t.aggressive ?? 0.5;
    let name: Archetype['name'];
    if (aggressive >= 0.75) name = 'Reckless';
    else if (aggressive >= 0.5) name = 'Calculated';
    else if (aggressive >= 0.25) name = 'Patient';
    else name = 'Cautious';
    const modifier = (t.deceptive ?? 0.5) >= 0.7 ? ('Deceiver' as const) : undefined;
    return { name, modifier };
  }

  const { aggression, bluffRate, patternBreakRate } = profile;

  let name: Archetype['name'];
  if (aggression >= 0.65) {
    name = 'Reckless';
  } else if (aggression >= 0.45) {
    name = 'Calculated';
  } else if (aggression >= 0.30) {
    name = 'Patient';
  } else {
    name = 'Cautious';
  }

  const deception = bluffRate + patternBreakRate;
  const modifier = deception >= 0.20 ? 'Deceiver' as const : undefined;

  return { name, modifier };
}
