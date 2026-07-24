# Playprint

**Ghost AI for any game — turn real players into AI opponents that play like them.**

[![npm: @playprint/core](https://img.shields.io/npm/v/@playprint/core?label=%40playprint%2Fcore)](https://www.npmjs.com/package/@playprint/core)
[![npm: @playprint/sdk](https://img.shields.io/npm/v/@playprint/sdk?label=%40playprint%2Fsdk)](https://www.npmjs.com/package/@playprint/sdk)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](./packages/core/LICENSE)

Playprint is the technology family of Forza's Drivatars and racing-game ghosts, generalised to any genre: capture a player's in-game decisions, extract a behavioural profile, and bias your existing game AI so it plays like that specific person. Asynchronous multiplayer without dedicated servers, netcode, or matchmaking — and safe by construction for children's games (no chat, no live connections, no PII).

## Which package do I want?

| Package | Use it when |
|---------|-------------|
| [`@playprint/core`](./packages/core) | You want playstyle profiling that runs entirely inside your game — tracking, profiles, ghost AI biases, archetypes, presentation. Zero dependencies, no network, no account needed. **Start here.** |
| [`@playprint/sdk`](./packages/sdk) | You're connecting to the hosted [playprint.ai](https://playprint.ai) platform: telemetry ingest, hosted profiles, cross-game Legends. Wraps `@playprint/core`, so local profiling keeps working offline. |

## Quick start

```bash
npm install @playprint/core
```

```ts
import { PlayprintTracker, createGhost, mapGhostBiases } from '@playprint/core';

const tracker = new PlayprintTracker({ gameId: 'my_game' });

tracker.startMatch();
tracker.decision({ label: 'attack' });            // risk inferred from label
tracker.outcome({ type: 'hit', delta: 0.5 });
const profile = await tracker.endMatch('win');    // 14-dimension behavioural profile

const ghost = createGhost(profile);               // 5 bias weights
const aiParams = mapGhostBiases(ghost, {          // → your game's AI parameters
  attackFrequency: { bias: 'aggression', range: [0.1, 0.9] },
  bluffChance:     { bias: 'deception',  range: [0, 0.3] },
});
```

Full documentation: [playprint.ai/docs](https://playprint.ai/docs) — [quickstart](https://playprint.ai/docs/quickstart), [concepts](https://playprint.ai/docs/concepts), [API reference](https://playprint.ai/docs/api-reference).

## Repository layout

- [`packages/core`](./packages/core) — `@playprint/core`: the zero-dependency engine (tracker, extraction, ghosts, archetypes, calibration, presentation) with its test suite and examples
- [`packages/sdk`](./packages/sdk) — `@playprint/sdk`: the hosted-platform client (ingest, delivery, identity scoping)

```bash
pnpm install
pnpm build       # build both packages (tsup, dual ESM/CJS)
pnpm test        # run the test suites
pnpm typecheck   # tsc --noEmit across packages
```

## Privacy posture

Playprint profiles behaviour, not people: gameplay decisions only — no voice, chat, likeness, or personal data. The SDK's default identity scope produces per-game, cryptographically unlinkable player identities (the COPPA-safe posture); cross-game identity is an explicit opt-in. GDPR export and erasure utilities are built into core. See [playprint.ai/safety](https://playprint.ai/safety) and [playprint.ai/coppa](https://playprint.ai/coppa).

## License

MIT
