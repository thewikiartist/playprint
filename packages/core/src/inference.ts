/** Default label → risk mapping. Unknown labels default to 0.5. */
export const DEFAULT_RISK_MAP: Record<string, number> = {
  attack: 0.7,
  aggressive: 0.75,
  rush: 0.8,
  gamble: 0.9,
  bluff: 0.85,
  defend: 0.2,
  block: 0.25,
  shield: 0.2,
  heal: 0.15,
  wait: 0.1,
  build: 0.4,
  setup: 0.35,
  position: 0.4,
  counter: 0.5,
  trade: 0.5,
  neutral: 0.5,
  retreat: 0.15,
  flee: 0.1,
  surrender: 0.05,
};

/**
 * Infer a risk value from a decision label.
 * Checks the custom map first, then DEFAULT_RISK_MAP, then returns 0.5.
 * Return value is always clamped to [0, 1].
 */
export function inferRisk(label: string, customMap?: Record<string, number>): number {
  const key = label.toLowerCase();
  if (customMap && key in customMap) {
    const v = customMap[key];
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5;
  }
  if (key in DEFAULT_RISK_MAP) return DEFAULT_RISK_MAP[key];
  return 0.5;
}

/**
 * Infer intent tags from a decision label.
 * Returns tags based on keyword matching against the label.
 */
export function inferTags(label: string): string[] {
  const key = label.toLowerCase();
  const tags: string[] = [];

  const aggressive = ['attack', 'aggressive', 'rush', 'gamble', 'bluff'];
  const defensive = ['defend', 'block', 'shield', 'heal', 'wait', 'retreat', 'flee', 'surrender'];
  const building = ['build', 'setup', 'position'];

  if (aggressive.some((w) => key.includes(w))) tags.push('aggressive');
  if (defensive.some((w) => key.includes(w))) tags.push('defensive');
  if (building.some((w) => key.includes(w))) tags.push('building');
  if (key.includes('bluff')) tags.push('heavy_bluff');
  if (key.includes('counter')) tags.push('disruption');

  return tags;
}

/**
 * Default tempo computation from sequence number.
 * 1-5 = early, 6-15 = mid, 16+ = late.
 */
export function defaultComputeTempo(sequence: number): 'early' | 'mid' | 'late' {
  if (sequence <= 5) return 'early';
  if (sequence <= 15) return 'mid';
  return 'late';
}

// ── Decision classification ───────────────────────────────────

import type { DecisionCategory } from './types';

/**
 * Classify a decision type using a category map, falling back to keyword inference.
 *
 * Lookup order:
 * 1. Exact match in `categories` (e.g. `"Shield"`)
 * 2. Lowercase match in `categories` (e.g. `"shield"`)
 * 3. Keyword-based inference via `inferTags()` and `inferRisk()`
 *
 * Returns `{ tags, risk, information }` or `null` if no classification is possible.
 */
export function classifyDecision(
  decisionType: string,
  categories?: Record<string, DecisionCategory>,
): { tags: string[]; risk?: number; information?: number } {
  if (categories) {
    // Exact match
    const exact = categories[decisionType];
    if (exact) {
      return {
        tags: exact.tags,
        risk: exact.risk,
        information: exact.information,
      };
    }

    // Case-insensitive match
    const lower = decisionType.toLowerCase();
    for (const [key, cat] of Object.entries(categories)) {
      if (key.toLowerCase() === lower) {
        return {
          tags: cat.tags,
          risk: cat.risk,
          information: cat.information,
        };
      }
    }
  }

  // Fallback to keyword inference
  const tags = inferTags(decisionType);
  const risk = inferRisk(decisionType);
  return { tags, risk: risk !== 0.5 ? risk : undefined };
}
