# @playprint/core

Game-agnostic playstyle identity SDK. Track player decisions, extract behavioral profiles, generate ghost AI biases, and classify archetypes — for any game.

**Zero runtime dependencies.** Dual ESM/CJS. TypeScript-first with full type exports.

## Which package do I want?

| Package | Use it when |
|---------|-------------|
| **`@playprint/core`** (this one) | You want playstyle profiling that runs entirely inside your game — tracking, profiles, ghost AI biases, archetypes, presentation. Zero dependencies, no network, no account needed. **Start here.** |
| [`@playprint/sdk`](https://www.npmjs.com/package/@playprint/sdk) | You're connecting to the hosted [playprint.ai](https://playprint.ai) platform: telemetry ingest, hosted profiles, cross-game Legends. It wraps this package, so local profiling keeps working offline. |

## Install

```bash
npm install @playprint/core
```

## Quick Start

```ts
import { PlayprintTracker, createGhost, getArchetype } from '@playprint/core';

const tracker = new PlayprintTracker({ gameId: 'my_game' });

tracker.startMatch();
tracker.decision({ label: 'attack' });           // Tier 1: label only
tracker.outcome({ type: 'hit', delta: 0.5 });
tracker.decision({ label: 'bluff', risk: 0.9, information: 0.3 }); // Tier 2
tracker.outcome({ type: 'fooled', delta: 0.6 });

const profile = await tracker.endMatch('win');
const ghost = createGhost(profile);       // { aggression, patience, riskTolerance, consistency, deception }
const archetype = getArchetype(profile);  // { name: 'Reckless', modifier: 'Deceiver' }
```

## Pipeline Overview

Playprint processes player data through a multi-stage pipeline:

```
Telemetry → Profile → Ghost Biases → Game AI Parameters
                   ↓
               Traits → Archetype → Presentation
```

1. **Telemetry** — `PlayprintTracker` records decisions and outcomes per match
2. **Profile** — `extractProfile()` aggregates matches into 14-dimensional `PlayprintData`
3. **Ghost AI** — `createGhost()` converts profile to 5 bias weights; `mapGhostBiases()` maps to game parameters
4. **Traits** — `deriveTraits()` maps profile to 9 normalized trait dimensions
5. **Archetype** — `getArchetype()` for simple classification; `generateArchetype()` for rich 5-layer personalities
6. **Presentation** — `getLegendPresentation()` produces player-facing trait names, descriptions, titles, and icons

## Decision Tiers

| Tier | Input | When to use |
|------|-------|-------------|
| 1 | `{ label }` | Quick integration — risk inferred from label keywords |
| 2 | `{ label, risk, information }` | You compute your own risk/info values |
| 3 | Full `DecisionPayload` | Complete control over all fields |

**Tier 1** uses `inferRisk()` to map labels like `'attack'` (0.7), `'defend'` (0.2), `'gamble'` (0.9) to risk values. You can customize the mapping via `TrackerOptions.riskMap`.

## API Reference

### PlayprintTracker

The main entry point for recording telemetry.

```ts
const tracker = new PlayprintTracker({
  gameId: 'my_game',
  accountId: 'player_42',           // optional — auto-generated if omitted
  storage: new LocalStorageAdapter(), // optional — InMemoryStorage by default
  riskMap: { 'charge': 0.85 },      // extend the default label→risk mapping
  bluffTag: 'heavy_bluff',          // tag that marks bluff decisions
  patternBreakTag: 'pattern_break', // tag that marks pattern-breaking decisions
  maxMatches: 50,                   // max matches to keep for profile extraction
});
```

| Method | Description |
|--------|-------------|
| `startMatch(opts?)` | Begin recording a match |
| `decision(input)` | Record a decision (tiered input) |
| `outcome(input)` | Record an outcome |
| `endMatch(result)` | Save match, extract and return updated profile |
| `getEvents()` | Get current match events |
| `getProfile()` | Compute profile from all stored matches |

### Profile Extraction

```ts
import { extractProfile } from '@playprint/core';

const profile = extractProfile(matches, {
  bluffTag: 'heavy_bluff',
  maxMatches: 50,
  extensionExtractors: {
    favoriteCard: (matches) => computeFavoriteCard(matches),
  },
});
```

Returns a `PlayprintData` object with 14 behavioral dimensions:

| Field | Description |
|-------|-------------|
| `aggression` | Mean aggression (0 = passive, 1 = aggressive) |
| `aggressionStdDev` | Volatility of aggression across matches |
| `informationPreference` | Preference for informed vs blind decisions |
| `tempoEarly/Mid/Late` | Decision distribution across game phases |
| `bluffRate` | Rate of bluff-tagged decisions |
| `patternBreakRate` | Rate of pattern-breaking decisions |
| `riskWhenWinning` | Risk level when ahead |
| `riskWhenLosing` | Risk level when behind |
| `comebackRate` | Win rate from losing positions |
| `totalDecisions` | Total decisions recorded |
| `totalMatches` | Total matches recorded |
| `extensions` | Game-specific data from custom extractors |

### Ghost AI

Convert a profile into 5 abstract bias weights, then map them to your game's AI parameters:

```ts
import { createGhost, mapGhostBiases } from '@playprint/core';

const ghost = createGhost(profile);
// { aggression: 0.72, patience: 0.28, riskTolerance: 0.65, consistency: 0.8, deception: 0.15 }

const aiParams = mapGhostBiases(ghost, {
  attackFrequency:  { bias: 'aggression',    range: [0.1, 0.9] },
  retreatThreshold: { bias: 'patience',      range: [0.2, 0.8] },
  bluffChance:      { bias: 'deception',     range: [0, 0.3] },
  reactionTime:     { bias: 'consistency',   range: [200, 800] },
  riskThreshold:    { bias: 'riskTolerance', range: [0.3, 0.9] },
});
// aiParams.attackFrequency = 0.1 + ghost.aggression * 0.8
```

| Bias | Derived from |
|------|-------------|
| `aggression` | `profile.aggression` |
| `patience` | `1 - profile.aggression` |
| `riskTolerance` | Average of `riskWhenWinning` and `riskWhenLosing` |
| `consistency` | `1 - profile.aggressionStdDev` |
| `deception` | Average of `bluffRate` and `patternBreakRate` |

### Trait Derivation

Maps raw profile data to 9 normalized trait dimensions used by the archetype and presentation systems:

```ts
import { deriveTraits, STANDARD_TRAIT_KEYS } from '@playprint/core';

const traits = deriveTraits(profile, {
  overrides: {
    // Override a standard trait
    patience: (p) => p.informationPreference * 0.8,
    // Add a game-specific trait
    swordSkill: (p) => (p.extensions?.swordAccuracy as number) ?? 0.5,
  },
});
```

**Standard traits**: `aggression`, `riskTolerance`, `tempo`, `exploration`, `patience`, `targetLeaderBias`, `commitment`, `variance`, `tiltSensitivity`

### Simple Archetype

```ts
import { getArchetype } from '@playprint/core';

const arch = getArchetype(profile);
// { name: 'Reckless', modifier: 'Deceiver' }
// name: Reckless (≥0.65) | Calculated (≥0.45) | Patient (≥0.30) | Cautious (<0.30)
// modifier: 'Deceiver' when bluffRate + patternBreakRate ≥ 0.20
```

### Generative Archetype

Rich 5-layer personality descriptions built from the trait profile:

```ts
import { generateArchetype } from '@playprint/core';

const result = generateArchetype(traits);
// {
//   coreArchetype: 'Berserker',       // 1 of 18, from strongest trait signal
//   styleModifier: 'Fierce',          // from second-strongest trait
//   displayName: 'Fierce Berserker',  // combined
//   tempoTag: 'Late-game closer',     // rhythm descriptor (null if tempo used above)
//   behaviors: ['Waits, then strikes without mercy'],  // 0-3 multi-trait combo phrases
//   tagline: 'Charges in hard and trusts instinct over strategy.',
// }
```

**18 core archetypes** (polar pairs per trait): Berserker/Ghost, Daredevil/Sentinel, Blitz/Glacier, Cartographer/Specialist, Architect/Firestarter, Kingslayer/Lone Wolf, Juggernaut/Shapeshifter, Wildcard/Metronome, Volcano/Stoic. Flat profiles produce "Enigma".

### Legend Presentation

Transform internal trait data into player-facing UI content:

```ts
import { deriveTraits, getLegendPresentation } from '@playprint/core';

const traits = deriveTraits(profile);
const legend = getLegendPresentation(traits, null, {
  overrides: {
    aggression: { name: 'Battle Fury', tip: 'Attack more to raise this!' },
  },
  includeArchetype: true,
});

// legend.title → 'Fierce Strategist'
// legend.traits → [{ key: 'aggression', name: 'Battle Fury', value: 0.72, description: '...', tip: '...' }, ...]
// legend.archetype → GenerativeArchetypeResult
// legend.safetyNote → 'Based on gameplay only. No voice, chat, or personal info.'
// legend.trainingNote → 'Your Legend grows as you play. These traits update based on your decisions.'
```

### Inference Utilities

```ts
import { inferRisk, inferTags, defaultComputeTempo, DEFAULT_RISK_MAP } from '@playprint/core';

inferRisk('attack');            // 0.7 (from DEFAULT_RISK_MAP)
inferRisk('charge', { charge: 0.85 }); // 0.85 (custom map)
inferTags('bluff');             // ['aggressive', 'heavy_bluff']
defaultComputeTempo(3);         // 'early' (1-5=early, 6-15=mid, 16+=late)
```

## Storage Adapters

Two built-in adapters:

```ts
import { InMemoryStorage, LocalStorageAdapter } from '@playprint/core';

// In-memory — for testing and single-session use
const memory = new InMemoryStorage();

// Browser localStorage — persists across sessions
const local = new LocalStorageAdapter();
// Data stored under keys: playprint:{accountId}:matches, playprint:{accountId}:profile
// Custom prefix: new LocalStorageAdapter('myapp')
```

Implement `StorageAdapter` for custom persistence (database, IndexedDB, API, etc.):

```ts
interface StorageAdapter {
  saveMatch(accountId: string, match: MatchRecord): Promise<void>;
  loadMatches(accountId: string): Promise<MatchRecord[]>;
  saveProfile(accountId: string, profile: PlayprintData): Promise<void>;
  loadProfile(accountId: string): Promise<PlayprintData | null>;
  clear(accountId: string): Promise<void>;
}
```

## Game-Specific Extensions

Use `extensionExtractors` to compute game-specific data alongside the standard profile:

```ts
const tracker = new PlayprintTracker({
  gameId: 'shadow_hands',
  extensionExtractors: {
    favoriteCharacter: (matches) => {
      // Analyze match events to find most-used character
      return 'samurai';
    },
    throwPatterns: (matches) => {
      // Extract rock/paper/scissors tendencies
      return { rock: 0.4, paper: 0.35, scissors: 0.25 };
    },
  },
});

const profile = await tracker.endMatch('win');
profile.extensions?.favoriteCharacter; // 'samurai'
profile.extensions?.throwPatterns;     // { rock: 0.4, ... }
```

## Zero Dependencies

This package has no runtime dependencies. Only `devDependencies` for build and test tooling.

## License

MIT
