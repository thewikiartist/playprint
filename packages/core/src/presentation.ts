/**
 * Legend Presentation Layer
 *
 * Maps internal trait keys to player-facing names, descriptions, and UI
 * metadata. Pure presentation — does NOT modify bias computations.
 */

import type {
  TraitProfile,
  TraitDefinition,
  TraitPresentation,
  SkillPresentation,
  LegendPresentationResult,
  PresentationOverrides,
  PresentationOptions,
} from './types';
import { generateArchetype } from './generative-archetypes';

// ---------------------------------------------------------------------------
// Default Trait Definitions (game-agnostic)
// ---------------------------------------------------------------------------

export const DEFAULT_TRAITS: Record<string, TraitDefinition> = {
  aggressive: {
    name: 'Aggressive',
    description: 'How often your Legend pushes the attack.',
    tip: 'Play more aggressively to raise this trait.',
    iconKey: 'aggressive',
    lowMeaning: 'Defensive',
    highMeaning: 'Presses conflict',
  },
  bold: {
    name: 'Bold',
    description: 'How willing your Legend is to take big risks.',
    tip: 'Go for bold plays to boost your daring.',
    iconKey: 'bold',
    lowMeaning: 'Cautious',
    highMeaning: 'Risk tolerant',
  },
  deceptive: {
    name: 'Deceptive',
    description: 'How much your Legend uses bluffs and misdirection.',
    tip: 'Mix in bluffs and pattern breaks to raise Deceptive.',
    iconKey: 'deceptive',
    lowMeaning: 'Direct',
    highMeaning: 'Bluffing / Misdirection',
  },
  chaotic: {
    name: 'Chaotic',
    description: 'How swingy and unpredictable your Legend is.',
    tip: 'Mix up your playstyle to increase Chaotic.',
    iconKey: 'chaotic',
    lowMeaning: 'Controlled',
    highMeaning: 'Unpredictable',
  },
  urgent: {
    name: 'Urgent',
    description: 'How fast your Legend goes for a win.',
    tip: 'Push the pace to build urgency.',
    iconKey: 'urgent',
    lowMeaning: 'Patient',
    highMeaning: 'Fast-paced',
  },
  expansive: {
    name: 'Expansive',
    description: 'How broadly your Legend exerts influence.',
    tip: 'Explore different strategies to grow Expansive.',
    iconKey: 'expansive',
    lowMeaning: 'Focused',
    highMeaning: 'Broad influence',
  },
};

// ---------------------------------------------------------------------------
// Default Skill Definitions (game-agnostic)
// ---------------------------------------------------------------------------

export const DEFAULT_SKILLS: Record<string, TraitDefinition> = {
  precision: {
    name: 'Precision',
    description: 'How accurately your Legend executes risky moves.',
    tip: 'Make fewer mistakes to sharpen Precision.',
    iconKey: 'precision',
  },
  efficiency: {
    name: 'Efficiency',
    description: 'How effectively your Legend converts actions into results.',
    tip: 'Maximize the impact of each decision to boost Efficiency.',
    iconKey: 'efficiency',
  },
};

// ---------------------------------------------------------------------------
// Copy constants
// ---------------------------------------------------------------------------

const DEFAULT_SAFETY_NOTE =
  'Based on gameplay and in-game communication choices only. No voice, personal chat, or personal info.';

const DEFAULT_TRAINING_NOTE =
  'Your Legend grows as you play. These traits update based on your decisions.';

// ---------------------------------------------------------------------------
// Title generation (delegates to generative archetype handle)
// ---------------------------------------------------------------------------

const TRAIT_DISPLAY_ORDER = [
  'aggressive',
  'bold',
  'deceptive',
  'chaotic',
  'urgent',
  'expansive',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function titleCase(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function resolveDefinition(
  key: string,
  defaults: Record<string, TraitDefinition>,
  overrides?: PresentationOverrides,
): TraitDefinition {
  const base = defaults[key];
  const override = overrides?.[key];

  if (base && override) {
    return { ...base, ...override };
  }
  if (base) return base;
  if (override) {
    return {
      name: override.name || titleCase(key),
      description: override.description || '',
      tip: override.tip,
      iconKey: override.iconKey,
    };
  }

  return {
    name: titleCase(key),
    description: '',
  };
}

function sortTraits(keys: string[]): string[] {
  const orderMap = new Map(TRAIT_DISPLAY_ORDER.map((k, i) => [k, i]));
  return [...keys].sort((a, b) => {
    const ai = orderMap.get(a) ?? 999;
    const bi = orderMap.get(b) ?? 999;
    if (ai !== bi) return ai - bi;
    return a.localeCompare(b);
  });
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

/**
 * Transform a trait profile into a player-facing presentation.
 *
 * @param profile - Record of trait keys → normalized values (0..1)
 * @param skills  - Optional record of skill keys → normalized values (0..1)
 * @param opts    - Optional overrides, extra skills, and custom copy
 */
export function getLegendPresentation(
  profile: TraitProfile,
  skills?: TraitProfile | null,
  opts?: PresentationOptions,
): LegendPresentationResult {
  const overrides = opts?.overrides;

  // -- Traits --
  const traitKeys = sortTraits(Object.keys(profile));
  const traits: TraitPresentation[] = traitKeys.map((key) => {
    const def = resolveDefinition(key, DEFAULT_TRAITS, overrides);
    return {
      key,
      name: def.name,
      value: clamp(profile[key]),
      description: def.description,
      tip: def.tip,
      iconKey: def.iconKey,
    };
  });

  // -- Skills --
  let presentedSkills: SkillPresentation[] | undefined;
  if (skills && Object.keys(skills).length > 0) {
    const skillDefs = { ...DEFAULT_SKILLS, ...(opts?.extraSkills || {}) };
    presentedSkills = Object.keys(skills).map((key) => {
      const def = resolveDefinition(key, skillDefs, overrides);
      return {
        key,
        name: def.name,
        value: clamp(skills[key]),
        description: def.description,
        tip: def.tip,
        iconKey: def.iconKey,
      };
    });
  }

  const includeArchetype = opts?.includeArchetype !== false;
  const archetype = generateArchetype(profile);

  return {
    title: archetype.displayName,
    traits,
    skills: presentedSkills,
    archetype: includeArchetype ? archetype : undefined,
    safetyNote: opts?.safetyNote || DEFAULT_SAFETY_NOTE,
    trainingNote: opts?.trainingNote || DEFAULT_TRAINING_NOTE,
  };
}
