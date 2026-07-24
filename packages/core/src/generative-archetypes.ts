/**
 * Generative Archetype System
 *
 * Produces rich, composable personality descriptions from a trait profile.
 * Five layers build on each other:
 *   1. Core Archetype  — dominant trait signal (1 of 12)
 *   2. Style Modifier   — second-strongest signal as adjective (1 of 12)
 *   3. Tempo Tag        — rhythm descriptor (when urgent isn't used above)
 *   4. Contextual Behaviors — multi-trait combo phrases (0–3)
 *   5. Tagline          — template-driven summary sentence
 *
 * Pure functions, deterministic, no external dependencies.
 */

import type { TraitProfile, GenerativeArchetypeResult } from './types';

// ---------------------------------------------------------------------------
// Vocabulary Tables
// ---------------------------------------------------------------------------

interface PolarLabel {
  high: string;
  low: string;
}

export const CORE_ARCHETYPES: Record<string, PolarLabel> = {
  aggressive: { high: 'Berserker',    low: 'Ghost' },
  bold:       { high: 'Daredevil',    low: 'Sentinel' },
  deceptive:  { high: 'Phantom',      low: 'Purist' },
  chaotic:    { high: 'Wildcard',     low: 'Metronome' },
  urgent:     { high: 'Blitz',        low: 'Glacier' },
  expansive:  { high: 'Cartographer', low: 'Specialist' },
};

export const STYLE_MODIFIERS: Record<string, PolarLabel> = {
  aggressive: { high: 'Fierce',      low: 'Subtle' },
  bold:       { high: 'Bold',        low: 'Cautious' },
  deceptive:  { high: 'Cunning',     low: 'Direct' },
  chaotic:    { high: 'Chaotic',     low: 'Precise' },
  urgent:     { high: 'Relentless',  low: 'Measured' },
  expansive:  { high: 'Inventive',   low: 'Methodical' },
};

export const HANDLE_LABELS: Record<string, PolarLabel> = {
  aggressive: { high: 'Fierce',      low: 'Defensive' },
  bold:       { high: 'Daring',      low: 'Cautious' },
  deceptive:  { high: 'Cunning',     low: 'Direct' },
  chaotic:    { high: 'Chaotic',     low: 'Precise' },
  urgent:     { high: 'Relentless',  low: 'Patient' },
  expansive:  { high: 'Adaptive',    low: 'Focused' },
};

const HANDLE_MIN = 3;
const HANDLE_MAX = 4;
const FOURTH_WORD_THRESHOLD = 0.15;

// ---------------------------------------------------------------------------
// Tempo Tags (Layer 3)
// ---------------------------------------------------------------------------

interface TempoTagBucket {
  min: number;
  max: number;
  label: string;
}

export const TEMPO_TAGS: TempoTagBucket[] = [
  { min: 0.00, max: 0.125, label: 'Marathon grinder' },
  { min: 0.125, max: 0.25, label: 'Slow burn' },
  { min: 0.25, max: 0.375, label: 'Steady escalator' },
  { min: 0.375, max: 0.50, label: 'Late-game closer' },
  { min: 0.50, max: 0.625, label: 'Rhythm switcher' },
  { min: 0.625, max: 0.75, label: 'Burst player' },
  { min: 0.75, max: 0.875, label: 'Explosive opener' },
  { min: 0.875, max: 1.01, label: 'All-in sprinter' },
];

// ---------------------------------------------------------------------------
// Behavior Rules (Layer 4)
// ---------------------------------------------------------------------------

interface BehaviorRule {
  condition: (p: TraitProfile) => boolean;
  strength: (p: TraitProfile) => number;
  phrase: string;
}

const BEHAVIOR_RULES: BehaviorRule[] = [
  {
    condition: (p) => (p.aggressive ?? 0.5) > 0.7 && (p.urgent ?? 0.5) < 0.3,
    strength: (p) => (p.aggressive ?? 0.5) + (1 - (p.urgent ?? 0.5)),
    phrase: 'Waits, then strikes without mercy',
  },
  {
    condition: (p) => (p.bold ?? 0.5) > 0.7 && (p.chaotic ?? 0.5) < 0.3,
    strength: (p) => (p.bold ?? 0.5) + (1 - (p.chaotic ?? 0.5)),
    phrase: 'Goes all-in and never looks back',
  },
  {
    condition: (p) => (p.chaotic ?? 0.5) > 0.7 && (p.deceptive ?? 0.5) > 0.7,
    strength: (p) => (p.chaotic ?? 0.5) + (p.deceptive ?? 0.5),
    phrase: 'Never plays the same way twice',
  },
  {
    condition: (p) => (p.aggressive ?? 0.5) < 0.3 && (p.deceptive ?? 0.5) > 0.7,
    strength: (p) => (1 - (p.aggressive ?? 0.5)) + (p.deceptive ?? 0.5),
    phrase: 'Invisible until the final move',
  },
  {
    condition: (p) => (p.bold ?? 0.5) > 0.7 && (p.aggressive ?? 0.5) > 0.6,
    strength: (p) => (p.bold ?? 0.5) + (p.aggressive ?? 0.5),
    phrase: 'Dangerous when cornered',
  },
  {
    condition: (p) => (p.bold ?? 0.5) < 0.3 && (p.urgent ?? 0.5) < 0.3,
    strength: (p) => (1 - (p.bold ?? 0.5)) + (1 - (p.urgent ?? 0.5)),
    phrase: 'Fortress builder \u2014 breaks your will',
  },
  {
    condition: (p) => (p.expansive ?? 0.5) > 0.6 && (p.bold ?? 0.5) > 0.6,
    strength: (p) => (p.expansive ?? 0.5) + (p.bold ?? 0.5),
    phrase: 'Hunts the leader at any cost',
  },
  {
    condition: (p) => (p.deceptive ?? 0.5) > 0.8 && (p.chaotic ?? 0.5) > 0.6,
    strength: (p) => (p.deceptive ?? 0.5) + (p.chaotic ?? 0.5),
    phrase: 'Expects the unexpected',
  },
  {
    condition: (p) => (p.chaotic ?? 0.5) < 0.35 && (p.bold ?? 0.5) > 0.7,
    strength: (p) => (1 - (p.chaotic ?? 0.5)) + (p.bold ?? 0.5),
    phrase: 'Unbreakable focus',
  },
  {
    condition: (p) => (p.urgent ?? 0.5) > 0.7 && (p.aggressive ?? 0.5) > 0.7,
    strength: (p) => (p.urgent ?? 0.5) + (p.aggressive ?? 0.5),
    phrase: 'Blitzes before you can breathe',
  },
  {
    condition: (p) => (p.aggressive ?? 0.5) > 0.8 && (p.bold ?? 0.5) > 0.8,
    strength: (p) => (p.aggressive ?? 0.5) + (p.bold ?? 0.5),
    phrase: 'Lives on the edge and thrives there',
  },
  {
    condition: (p) => (p.aggressive ?? 0.5) < 0.3 && (p.chaotic ?? 0.5) < 0.3,
    strength: (p) => (1 - (p.aggressive ?? 0.5)) + (1 - (p.chaotic ?? 0.5)),
    phrase: 'Outlasts you through sheer persistence',
  },
  {
    condition: (p) => (p.chaotic ?? 0.5) > 0.6 && (p.bold ?? 0.5) > 0.55,
    strength: (p) => (p.chaotic ?? 0.5) + (p.bold ?? 0.5),
    phrase: 'Thrives in disorder \u2014 the wilder it gets, the better',
  },
  {
    condition: (p) => (p.chaotic ?? 0.5) > 0.6 && (p.aggressive ?? 0.5) < 0.35,
    strength: (p) => (p.chaotic ?? 0.5) + (1 - (p.aggressive ?? 0.5)),
    phrase: 'Uses chaos as a shield, not a sword',
  },
  {
    condition: (p) => (p.bold ?? 0.5) > 0.6 && (p.urgent ?? 0.5) < 0.35,
    strength: (p) => (p.bold ?? 0.5) + (1 - (p.urgent ?? 0.5)),
    phrase: 'Takes enormous risks, but never in a hurry',
  },
  {
    condition: (p) => (p.aggressive ?? 0.5) < 0.35 && (p.deceptive ?? 0.5) < 0.35,
    strength: (p) => (1 - (p.aggressive ?? 0.5)) + (1 - (p.deceptive ?? 0.5)),
    phrase: 'Plays honest defence \u2014 and makes it work',
  },
];

const MAX_BEHAVIORS = 3;

// ---------------------------------------------------------------------------
// Tagline Templates (Layer 5)
// ---------------------------------------------------------------------------

const TAGLINE_TEMPLATES: Record<string, string[]> = {
  Berserker: [
    'Charges in hard and trusts instinct over strategy.',
    'Overwhelms you with pressure before you find your footing.',
    'Plays like there\u2019s nothing to lose \u2014 because there isn\u2019t.',
    'The best defense is a relentless offense.',
  ],
  Ghost: [
    'You won\u2019t see them coming until it\u2019s too late.',
    'Operates in the shadows, striking only when certain.',
    'Barely registers on the radar \u2014 until the final blow.',
    'Quiet, patient, and absolutely lethal.',
  ],
  Daredevil: [
    'Takes risks others wouldn\u2019t dream of \u2014 and makes them pay off.',
    'Thrives in chaos and turns danger into opportunity.',
    'Bets big, wins big, and never plays it safe.',
    'Plays every hand like it\u2019s the last one that matters.',
    'Where others see danger, they see a shortcut to victory.',
  ],
  Sentinel: [
    'Builds walls and waits for you to break against them.',
    'Never takes a risk that isn\u2019t calculated down to the last detail.',
    'The safest hands in the game.',
    'Turns every match into a war of attrition \u2014 and always wins it.',
    'The kind of player who makes you beat yourself.',
  ],
  Phantom: [
    'Misdirection is the weapon \u2014 you never see the real play.',
    'Layers bluffs so deep you question everything.',
    'The truth is whatever they want you to believe.',
    'Wins the game in your head before the first move is played.',
    'Every tell is a trap \u2014 every trap is a tell.',
  ],
  Purist: [
    'No tricks, no bluffs \u2014 just clean, honest play.',
    'Wins on skill alone and dares you to do the same.',
    'What you see is what you get \u2014 and it\u2019s enough.',
    'Doesn\u2019t need mind games when the fundamentals are this sharp.',
    'Proves that honesty really is the best policy \u2014 in combat.',
  ],
  Blitz: [
    'Wins before most players have warmed up.',
    'Speed is the weapon \u2014 everything else is a distraction.',
    'If you blink, you\u2019ve already lost.',
    'Sets a pace that breaks opponents before they can adapt.',
    'The first three moves decide the match \u2014 and they know it.',
  ],
  Glacier: [
    'Moves slowly, but every step is inevitable.',
    'Grinds you down with patience you can\u2019t outlast.',
    'The longer the game goes, the stronger they get.',
    'Plays like time is always on their side \u2014 because it is.',
    'Slow and steady doesn\u2019t just win the race \u2014 it wins the war.',
  ],
  Cartographer: [
    'Always looking for the path no one else has found.',
    'Turns every game into an experiment.',
    'Maps the unknown and profits from what they discover.',
    'Sees possibilities where others see dead ends.',
    'The wider the option space, the more dangerous they become.',
  ],
  Specialist: [
    'Masters one approach and executes it flawlessly.',
    'Depth over breadth \u2014 knows their lane perfectly.',
    'You know what\u2019s coming, but you still can\u2019t stop it.',
    'Finds one path to victory and walks it every single time.',
    'Narrow focus, lethal precision \u2014 a scalpel, not a sledgehammer.',
  ],
  Wildcard: [
    'Unpredictable by nature \u2014 even to themselves.',
    'Turns randomness into a legitimate strategy.',
    'The only pattern is that there is no pattern.',
    'Keeps opponents guessing because they\u2019re always guessing too.',
    'Chaos isn\u2019t a flaw \u2014 it\u2019s the whole game plan.',
  ],
  Metronome: [
    'Consistent, reliable, and devastatingly steady.',
    'Plays the same clean game every single time.',
    'You know what\u2019s coming \u2014 but the consistency is crushing.',
    'Turns repetition into a weapon \u2014 daring you to find a crack.',
    'The rhythm never changes, and that\u2019s exactly what makes it deadly.',
  ],
  Enigma: [
    'Defies categorization \u2014 a true balanced player.',
    'No dominant instinct, just pure adaptability.',
    'The hardest player to read because there\u2019s nothing to read.',
    'Balanced in all things \u2014 and dangerous because of it.',
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Signal strength: how far a value is from neutral (0.5). Range: 0..1 */
export function signalStrength(value: number): number {
  return Math.abs(value - 0.5) * 2;
}

/**
 * Deterministic hash of profile values → integer.
 * Used to pick tagline variant without randomness.
 */
export function profileHash(profile: TraitProfile): number {
  const knownKeys = [
    'aggressive', 'bold', 'deceptive', 'chaotic', 'urgent', 'expansive',
  ];

  let hash = 0;
  for (const key of knownKeys) {
    const v = profile[key] ?? 0.5;
    hash = ((hash * 31) + Math.round(v * 1000)) | 0;
  }
  return Math.abs(hash);
}

/** Threshold below which all signals are considered "flat" */
const FLAT_THRESHOLD = 0.1;

export function getTempoTag(tempoValue: number): string {
  const clamped = Math.max(0, Math.min(1, tempoValue));
  for (const bucket of TEMPO_TAGS) {
    if (clamped >= bucket.min && clamped < bucket.max) {
      return bucket.label;
    }
  }
  return TEMPO_TAGS[TEMPO_TAGS.length - 1].label;
}

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

/**
 * Generate a rich archetype description from a trait profile.
 *
 * Pure function — deterministic. Same profile always produces the same result.
 */
export function generateArchetype(profile: TraitProfile): GenerativeArchetypeResult {
  const knownTraits = Object.keys(CORE_ARCHETYPES);

  // Rank traits by signal strength (distance from 0.5)
  const ranked = knownTraits
    .filter((key) => key in profile)
    .map((key) => ({
      key,
      value: profile[key],
      signal: signalStrength(profile[key]),
    }))
    .sort((a, b) => b.signal - a.signal || a.key.localeCompare(b.key));

  // --- Special case: flat profile (no strong signals) ---
  const hasStrongSignal = ranked.length > 0 && ranked[0].signal > FLAT_THRESHOLD;

  if (!hasStrongSignal) {
    const hash = profileHash(profile);
    const templates = TAGLINE_TEMPLATES['Enigma'];
    return {
      coreArchetype: 'Enigma',
      styleModifier: 'Balanced',
      displayName: 'Enigma',
      handleWords: ['Enigma'],
      tempoTag: getTempoTag(profile.urgent ?? 0.5),
      behaviors: [],
      tagline: templates[hash % templates.length],
    };
  }

  // --- Layer 1: Core Archetype ---
  const primary = ranked[0];
  const archetypeLabels = CORE_ARCHETYPES[primary.key];
  const coreArchetype = primary.value > 0.5 ? archetypeLabels.high : archetypeLabels.low;

  // --- Layer 2: Style Modifier ---
  const secondary = ranked.length > 1 ? ranked[1] : ranked[0];
  const modifierLabels = STYLE_MODIFIERS[secondary.key];
  const styleModifier = secondary.value > 0.5 ? modifierLabels.high : modifierLabels.low;

  // --- Handle: 3-4 word display name from top traits ---
  const handleCount = ranked.length >= HANDLE_MAX && ranked[HANDLE_MIN].signal > FOURTH_WORD_THRESHOLD
    ? HANDLE_MAX
    : Math.min(HANDLE_MIN, ranked.length);
  const handleWords = ranked.slice(0, handleCount).map((r) => {
    const labels = HANDLE_LABELS[r.key];
    return r.value > 0.5 ? labels.high : labels.low;
  });
  const displayName = `${styleModifier} ${coreArchetype}`;

  // --- Layer 3: Tempo Tag ---
  const tempoUsed = primary.key === 'urgent' || secondary.key === 'urgent';
  const tempoTag = tempoUsed ? null : getTempoTag(profile.urgent ?? 0.5);

  // --- Layer 4: Contextual Behaviors ---
  const behaviors = BEHAVIOR_RULES
    .filter((rule) => rule.condition(profile))
    .sort((a, b) => b.strength(profile) - a.strength(profile))
    .slice(0, MAX_BEHAVIORS)
    .map((rule) => rule.phrase);

  // --- Layer 5: Tagline ---
  const hash = profileHash(profile);
  const templates = TAGLINE_TEMPLATES[coreArchetype];
  if (!templates) {
    throw new Error(`Missing tagline templates for archetype: ${coreArchetype}`);
  }
  const tagline = templates[hash % templates.length];

  return {
    coreArchetype,
    styleModifier,
    displayName,
    handleWords,
    tempoTag,
    behaviors,
    tagline,
  };
}
