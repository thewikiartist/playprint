import { describe, it, expect, beforeEach } from 'vitest';
import {
  composeModifiers,
  conditionalModifier,
  resolveStateAction,
  buildFallbackKeys,
  deriveCommunicationBiases,
  classifyCommunicationStyle,
  buildGhostProfileFromModule,
  createTracker,
  classifyDecision,
  compareVersions,
  registerGameModule,
  getGameModule,
  getAllGameModules,
  hasGameModule,
  clearGameModuleRegistry,
} from '../src/index';
import type {
  PlayprintData,
  GhostModifier,
  StateActionTable,
  CommunicationBiases,
  GameModule,
  DecisionCategory,
  MatchRecord,
} from '../src/types';

// ── Helpers ──────────────────────────────────────────────────────

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
    counterplayRate: 0.4,
    totalDecisions: 100,
    totalMatches: 10,
    ...overrides,
  };
}

interface TestExt {
  throwDistribution: { ROCK: number; PAPER: number; SCISSORS: number };
  cardPlayRate: number;
}

function makeTestModule(): GameModule<TestExt> {
  return {
    gameId: 'test_game',
    displayName: 'Test Game',
    schemaVersion: '1.0',
    bluffTag: 'heavy_bluff',
    patternBreakTag: 'pattern_break',
    extensionExtractors: {
      throwDistribution: () => ({ ROCK: 0.33, PAPER: 0.33, SCISSORS: 0.34 }),
      cardPlayRate: () => 0.5,
    },
    decisionCategories: {
      Shield: { tags: ['defensive'], risk: 0.2 },
      'Strike True': { tags: ['offensive'], risk: 0.8 },
      Bandage: { tags: ['defensive', 'healing'], risk: 0.15, information: 0.3 },
    },
  };
}

// ── composeModifiers ─────────────────────────────────────────────

describe('composeModifiers', () => {
  interface Params { aggression: number; bluffRate: number }
  interface State { health: number; opponentHealth: number }

  it('applies modifiers left-to-right', () => {
    const double: GhostModifier<Params, State> = (p) => ({
      ...p,
      aggression: p.aggression * 2,
    });
    const addBluff: GhostModifier<Params, State> = (p) => ({
      ...p,
      bluffRate: p.bluffRate + 0.1,
    });

    const pipeline = composeModifiers(double, addBluff);
    const result = pipeline(
      { aggression: 0.3, bluffRate: 0.1 },
      { health: 12, opponentHealth: 12 },
    );

    expect(result.aggression).toBeCloseTo(0.6); // doubled
    expect(result.bluffRate).toBeCloseTo(0.2); // +0.1
  });

  it('does not mutate the input params', () => {
    const mod: GhostModifier<Params, State> = (p) => ({
      ...p,
      aggression: 0.99,
    });

    const pipeline = composeModifiers(mod);
    const original = { aggression: 0.3, bluffRate: 0.1 };
    const state = { health: 12, opponentHealth: 12 };

    pipeline(original, state);
    expect(original.aggression).toBe(0.3); // unchanged
  });

  it('composes zero modifiers (identity)', () => {
    const pipeline = composeModifiers<Params, State>();
    const input = { aggression: 0.5, bluffRate: 0.2 };
    const result = pipeline(input, { health: 12, opponentHealth: 12 });
    expect(result).toEqual(input);
  });

  it('composes a single modifier', () => {
    const mod: GhostModifier<Params, State> = (p) => ({
      ...p,
      aggression: 1,
    });
    const pipeline = composeModifiers(mod);
    const result = pipeline(
      { aggression: 0, bluffRate: 0 },
      { health: 12, opponentHealth: 12 },
    );
    expect(result.aggression).toBe(1);
  });
});

describe('conditionalModifier', () => {
  interface Params { aggression: number }
  interface State { health: number }

  it('applies modifier when predicate is true', () => {
    const mod = conditionalModifier<Params, State>(
      (s) => s.health < 4,
      (p) => ({ ...p, aggression: p.aggression * 2 }),
    );

    const result = mod({ aggression: 0.3 }, { health: 3 });
    expect(result.aggression).toBeCloseTo(0.6);
  });

  it('skips modifier when predicate is false', () => {
    const mod = conditionalModifier<Params, State>(
      (s) => s.health < 4,
      (p) => ({ ...p, aggression: p.aggression * 2 }),
    );

    const result = mod({ aggression: 0.3 }, { health: 12 });
    expect(result.aggression).toBe(0.3);
  });
});

// ── resolveStateAction ───────────────────────────────────────────

describe('resolveStateAction', () => {
  type Dist = { ROCK: number; PAPER: number; SCISSORS: number };

  const table: StateActionTable<Dist> = {
    'dominant:early:after_win': {
      distribution: { ROCK: 0.5, PAPER: 0.3, SCISSORS: 0.2 },
      sampleCount: 20,
    },
    'dominant:early': {
      distribution: { ROCK: 0.4, PAPER: 0.35, SCISSORS: 0.25 },
      sampleCount: 50,
    },
    dominant: {
      distribution: { ROCK: 0.35, PAPER: 0.35, SCISSORS: 0.3 },
      sampleCount: 100,
    },
    global: {
      distribution: { ROCK: 0.33, PAPER: 0.33, SCISSORS: 0.34 },
      sampleCount: 200,
    },
  };

  it('returns the first matching key', () => {
    const keys = ['dominant:early:after_win', 'dominant:early', 'dominant', 'global'];
    const result = resolveStateAction(keys, table);
    expect(result).toBe(table['dominant:early:after_win']);
  });

  it('falls back when first key is missing', () => {
    const keys = ['missing:key', 'dominant:early', 'dominant', 'global'];
    const result = resolveStateAction(keys, table);
    expect(result).toBe(table['dominant:early']);
  });

  it('respects minSamples threshold', () => {
    const keys = ['dominant:early:after_win', 'dominant:early', 'dominant', 'global'];
    const result = resolveStateAction(keys, table, 30);
    // First key has 20 samples < 30 threshold, so falls back
    expect(result).toBe(table['dominant:early']);
  });

  it('returns null when no key matches', () => {
    const keys = ['missing1', 'missing2'];
    const result = resolveStateAction(keys, table);
    expect(result).toBeNull();
  });

  it('returns null on empty keys array', () => {
    const result = resolveStateAction([], table);
    expect(result).toBeNull();
  });
});

// ── buildFallbackKeys ────────────────────────────────────────────

describe('buildFallbackKeys', () => {
  it('builds keys for 3 axes', () => {
    const keys = buildFallbackKeys('dominant', 'early', 'after_win');
    expect(keys).toEqual([
      'dominant:early:after_win',
      'dominant:early',
      'dominant',
      'global',
    ]);
  });

  it('builds keys for 2 axes', () => {
    const keys = buildFallbackKeys('losing', 'late');
    expect(keys).toEqual(['losing:late', 'losing', 'global']);
  });

  it('builds keys for 1 axis', () => {
    const keys = buildFallbackKeys('neutral');
    expect(keys).toEqual(['neutral', 'global']);
  });

  it('builds just global for 0 axes', () => {
    const keys = buildFallbackKeys();
    expect(keys).toEqual(['global']);
  });
});

// ── deriveCommunicationBiases ────────────────────────────────────

describe('deriveCommunicationBiases', () => {
  it('returns null when no comm data present', () => {
    expect(deriveCommunicationBiases(undefined)).toBeNull();
    expect(deriveCommunicationBiases({})).toBeNull();
    expect(deriveCommunicationBiases({ unrelated: 'data' })).toBeNull();
  });

  it('reads camelCase fields', () => {
    const result = deriveCommunicationBiases({
      commFrequency: 0.7,
      commHostility: 0.3,
      commContextSensitivity: 0.5,
      commVariety: 0.6,
    });
    expect(result).toEqual({
      frequency: 0.7,
      hostility: 0.3,
      contextSensitivity: 0.5,
      variety: 0.6,
    });
  });

  it('reads snake_case fields', () => {
    const result = deriveCommunicationBiases({
      comm_frequency: 0.8,
      comm_hostility: 0.2,
      comm_context_sensitivity: 0.4,
      comm_variety: 0.5,
    });
    expect(result).toEqual({
      frequency: 0.8,
      hostility: 0.2,
      contextSensitivity: 0.4,
      variety: 0.5,
    });
  });

  it('defaults missing fields to 0', () => {
    const result = deriveCommunicationBiases({ commFrequency: 0.5 });
    expect(result).toEqual({
      frequency: 0.5,
      hostility: 0,
      contextSensitivity: 0,
      variety: 0,
    });
  });

  it('clamps out-of-range values', () => {
    const result = deriveCommunicationBiases({
      commFrequency: 1.5,
      commHostility: -0.3,
    });
    expect(result!.frequency).toBe(1);
    expect(result!.hostility).toBe(0);
  });
});

// ── classifyCommunicationStyle ───────────────────────────────────

describe('classifyCommunicationStyle', () => {
  it('returns Silent for low frequency', () => {
    const biases: CommunicationBiases = {
      frequency: 0.1,
      hostility: 0.5,
      contextSensitivity: 0.5,
      variety: 0.5,
    };
    expect(classifyCommunicationStyle(biases)).toBe('Silent');
  });

  it('returns Trash Talker for high frequency + high hostility', () => {
    const biases: CommunicationBiases = {
      frequency: 0.6,
      hostility: 0.7,
      contextSensitivity: 0.5,
      variety: 0.5,
    };
    expect(classifyCommunicationStyle(biases)).toBe('Trash Talker');
  });

  it('returns Expressive for high frequency + low hostility', () => {
    const biases: CommunicationBiases = {
      frequency: 0.6,
      hostility: 0.1,
      contextSensitivity: 0.5,
      variety: 0.5,
    };
    expect(classifyCommunicationStyle(biases)).toBe('Expressive');
  });

  it('returns Respectful for moderate frequency + low hostility', () => {
    const biases: CommunicationBiases = {
      frequency: 0.35,
      hostility: 0.1,
      contextSensitivity: 0.5,
      variety: 0.5,
    };
    expect(classifyCommunicationStyle(biases)).toBe('Respectful');
  });

  it('returns undefined when totalMatches < 5', () => {
    const biases: CommunicationBiases = {
      frequency: 0.8,
      hostility: 0.8,
      contextSensitivity: 0.5,
      variety: 0.5,
    };
    expect(classifyCommunicationStyle(biases, 3)).toBeUndefined();
  });

  it('returns undefined for edge-case biases', () => {
    const biases: CommunicationBiases = {
      frequency: 0.25,
      hostility: 0.4,
      contextSensitivity: 0.5,
      variety: 0.5,
    };
    expect(classifyCommunicationStyle(biases)).toBeUndefined();
  });
});

// ── classifyDecision ─────────────────────────────────────────────

describe('classifyDecision', () => {
  const categories: Record<string, DecisionCategory> = {
    Shield: { tags: ['defensive'], risk: 0.2 },
    'Strike True': { tags: ['offensive'], risk: 0.8 },
    Bandage: { tags: ['defensive', 'healing'], risk: 0.15, information: 0.3 },
  };

  it('exact match from category map', () => {
    const result = classifyDecision('Shield', categories);
    expect(result.tags).toEqual(['defensive']);
    expect(result.risk).toBe(0.2);
  });

  it('case-insensitive match from category map', () => {
    const result = classifyDecision('shield', categories);
    expect(result.tags).toEqual(['defensive']);
    expect(result.risk).toBe(0.2);
  });

  it('returns full category with information', () => {
    const result = classifyDecision('Bandage', categories);
    expect(result.tags).toEqual(['defensive', 'healing']);
    expect(result.risk).toBe(0.15);
    expect(result.information).toBe(0.3);
  });

  it('falls back to keyword inference when not in categories', () => {
    const result = classifyDecision('attack', categories);
    expect(result.tags).toContain('aggressive');
    expect(result.risk).toBe(0.7);
  });

  it('falls back when no categories provided', () => {
    const result = classifyDecision('defend');
    expect(result.tags).toContain('defensive');
    expect(result.risk).toBe(0.2);
  });

  it('returns empty tags and no risk for unknown label', () => {
    const result = classifyDecision('unknown_action');
    expect(result.tags).toEqual([]);
    expect(result.risk).toBeUndefined();
  });
});

// ── compareVersions ──────────────────────────────────────────────

describe('compareVersions', () => {
  it('equal versions return 0', () => {
    expect(compareVersions('1.0', '1.0')).toBe(0);
    expect(compareVersions('2.1.3', '2.1.3')).toBe(0);
  });

  it('greater version returns positive', () => {
    expect(compareVersions('1.1', '1.0')).toBeGreaterThan(0);
    expect(compareVersions('2.0', '1.9')).toBeGreaterThan(0);
  });

  it('lesser version returns negative', () => {
    expect(compareVersions('1.0', '1.1')).toBeLessThan(0);
    expect(compareVersions('0.9', '1.0')).toBeLessThan(0);
  });

  it('handles different segment counts', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0', '1.0.1')).toBeLessThan(0);
    expect(compareVersions('1.0.1', '1.0')).toBeGreaterThan(0);
  });

  it('handles multi-digit segments', () => {
    expect(compareVersions('1.10', '1.9')).toBeGreaterThan(0);
  });
});

// ── createTracker ────────────────────────────────────────────────

describe('createTracker', () => {
  it('creates a tracker from a game module', () => {
    const module = makeTestModule();
    const tracker = createTracker(module);
    expect(tracker.isActive()).toBe(false);
  });

  it('passes through additional options', () => {
    const module = makeTestModule();
    const tracker = createTracker(module, { accountId: 'user-123' });

    // Verify the tracker works with the configured options
    const matchId = tracker.startMatch();
    expect(matchId).toBeTruthy();
    expect(tracker.isActive()).toBe(true);
    tracker.discardMatch();
  });

  it('records decisions using module riskMap', () => {
    const module: GameModule = {
      ...makeTestModule(),
      riskMap: { 'special_move': 0.9 },
    };
    const tracker = createTracker(module);
    tracker.startMatch();
    tracker.decision({ label: 'special_move' });
    const events = tracker.getEvents();
    const decision = events.find(e => e.event_name === 'decision');
    expect(decision?.decision?.risk).toBe(0.9);
    tracker.discardMatch();
  });
});

// ── buildGhostProfileFromModule ──────────────────────────────────

describe('buildGhostProfileFromModule', () => {
  it('builds a GhostProfileData with biases and module params', () => {
    const module: GameModule<TestExt> = {
      ...makeTestModule(),
      buildGhostProfile: (_profile, name, username) => ({
        label: `Ghost of ${name}`,
        description: `AI mimicking ${username}`,
      }),
    };

    const profile = makeProfile({
      extensions: {
        throwDistribution: { ROCK: 0.5, PAPER: 0.3, SCISSORS: 0.2 },
        cardPlayRate: 0.8,
      },
    }) as PlayprintData<TestExt>;

    const ghost = buildGhostProfileFromModule(module, profile, 'Alice', 'alice123');

    expect(ghost.biases.aggression).toBeCloseTo(0.5);
    expect(ghost.owner.name).toBe('Alice');
    expect(ghost.owner.username).toBe('alice123');
    expect(ghost.schemaVersion).toBe('1.0');
    expect(ghost.createdAt).toBeTruthy();
    expect((ghost.params as any).label).toBe('Ghost of Alice');
  });

  it('returns empty params when module has no buildGhostProfile', () => {
    const module = makeTestModule();
    const profile = makeProfile();

    const ghost = buildGhostProfileFromModule(module, profile, 'Bob', 'bob');
    expect(ghost.params).toEqual({});
  });
});

// ── Game Module Registry ─────────────────────────────────────────

describe('Game Module Registry', () => {
  beforeEach(() => {
    clearGameModuleRegistry();
  });

  it('registers and retrieves a module', () => {
    const module = makeTestModule();
    registerGameModule(module);
    expect(getGameModule('test_game')).toBe(module);
  });

  it('returns undefined for unregistered modules', () => {
    expect(getGameModule('nonexistent')).toBeUndefined();
  });

  it('hasGameModule returns correct boolean', () => {
    const module = makeTestModule();
    expect(hasGameModule('test_game')).toBe(false);
    registerGameModule(module);
    expect(hasGameModule('test_game')).toBe(true);
  });

  it('getAllGameModules returns all registered modules', () => {
    const mod1 = { ...makeTestModule(), gameId: 'game_1' };
    const mod2 = { ...makeTestModule(), gameId: 'game_2' };
    registerGameModule(mod1);
    registerGameModule(mod2);
    const all = getAllGameModules();
    expect(all).toHaveLength(2);
    expect(all.map(m => m.gameId)).toContain('game_1');
    expect(all.map(m => m.gameId)).toContain('game_2');
  });

  it('clearGameModuleRegistry removes all modules', () => {
    registerGameModule(makeTestModule());
    expect(getAllGameModules()).toHaveLength(1);
    clearGameModuleRegistry();
    expect(getAllGameModules()).toHaveLength(0);
  });

  it('replaces existing module with same gameId', () => {
    const mod1 = makeTestModule();
    const mod2 = { ...makeTestModule(), displayName: 'Updated' };
    registerGameModule(mod1);
    registerGameModule(mod2);
    expect(getGameModule('test_game')!.displayName).toBe('Updated');
    expect(getAllGameModules()).toHaveLength(1);
  });
});

// ── Typed Extensions (compile-time) ──────────────────────────────

describe('Typed Extensions', () => {
  it('PlayprintData generic narrows extensions type', () => {
    // This test verifies compile-time behavior — if it compiles, it passes
    const profile: PlayprintData<TestExt> = {
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
      counterplayRate: 0.4,
      totalDecisions: 100,
      totalMatches: 10,
      extensions: {
        throwDistribution: { ROCK: 0.5, PAPER: 0.3, SCISSORS: 0.2 },
        cardPlayRate: 0.8,
      },
    };

    // Type-safe access to extension fields
    expect(profile.extensions!.throwDistribution.ROCK).toBe(0.5);
    expect(profile.extensions!.cardPlayRate).toBe(0.8);
  });

  it('PlayprintData without generic works as before', () => {
    const profile: PlayprintData = makeProfile({
      extensions: { anyKey: 'anyValue' },
    });
    expect(profile.extensions).toBeDefined();
  });
});
