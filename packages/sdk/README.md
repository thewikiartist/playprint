# @playprint/sdk

Hosted-platform client for [Playprint](https://playprint.ai). Wraps the
zero-dependency [`@playprint/core`](../playprint) engine for local player
profiling, and ships the platform's telemetry stream (`match.start`,
`decision.batch`, `match.end`) to the playprint.ai ingest API.

- Zero runtime dependencies beyond `@playprint/core`
- Dual ESM/CJS builds, browser + Node 18+
- Never sends PII: user IDs are hashed (SHA-256) before leaving the device

## Which package do I want?

| Package | Use it when |
|---------|-------------|
| [`@playprint/core`](https://www.npmjs.com/package/@playprint/core) | You want playstyle profiling that runs entirely inside your game — no network, no account. If you're unsure, start there; you can add this package later without changing your tracking code. |
| **`@playprint/sdk`** (this one) | You're connecting to the hosted [playprint.ai](https://playprint.ai) platform: telemetry ingest, hosted profiles, cross-game Legends. Wraps `@playprint/core`, so local profiling keeps working offline. |

## Quickstart

```bash
npm install @playprint/sdk
```

```ts
import { PlayprintClient, hashUserId } from '@playprint/sdk';

const pp = new PlayprintClient({
  apiKey: 'pp_live_...',   // from your playprint.ai developer dashboard
  gameId: 'my_game',
});

// 1. Start a match
const matchId = pp.startMatch({ opponentType: 'human' }); // 'human' | 'ai' | 'legend'

// 2. Record decisions as they happen (tiered input, risk inferred from labels)
pp.trackDecision({ label: 'attack' });
pp.trackDecision({ label: 'defend' });
pp.trackDecision({ label: 'bluff', risk: 0.9, information: 0.3 });

// 3. Or send a pre-aggregated batch in your gameplay-mapping vocabulary
pp.trackDecisionBatch(
  [
    { decision_type: 'play_style', value: 'aggressive' },
    { decision_type: 'risk_plays', value: 5, count: 5 },
  ],
  { mapping_version: '1.0.0', total_rounds: 12 },
);

// 4. End the match — returns the locally extracted profile immediately
const localProfile = await pp.endMatch('win'); // 'win' | 'loss' | 'draw'

// 5. Deliver queued telemetry to playprint.ai
await pp.flush();

// 6. Retrieve the hosted profile (traits, Legend presentation, skills)
const profile = await pp.getProfile();
console.log(profile?.presentation);
```

## Configuration

```ts
new PlayprintClient({
  apiKey: 'pp_live_...',           // required — sent via X-PLAYPRINT-KEY
  gameId: 'my_game',               // required
  environment: 'production',       // 'dev' | 'staging' | 'production' (default)
  endpoint: 'https://playprint.ai',// override for self-hosted / testing
  storage: new LocalStorageAdapter(), // any @playprint/core StorageAdapter
  fetchFn: customFetch,            // custom fetch (tests, polyfills)
  flushIntervalMs: 30_000,         // periodic auto-flush (timer is unref'd in Node)
  maxQueueSize: 1000,              // queue cap — oldest events dropped beyond it
  identityScope: 'game',           // 'game' (default) | 'network' — see Identity scopes
  persistAnonymousId: true,        // persist the generated anon ID (browser; default)
});
```

Events are queued locally and sent in batches by `flush()` (explicitly, on the
`flushIntervalMs` interval, or via `navigator.sendBeacon` on browser
page-hide). Transient failures are retried with exponential backoff (max 3
attempts) and requeued; permanently rejected payloads are dropped.

Call `stop()` to clear the interval timer and page-hide listener when you are
done with a client.

## Identity scopes

Player identity comes in two scopes, set via `identityScope`:

- **`'game'` (default)** — every identity is scoped to your `gameId`.
  Identified players are hashed with a game-specific domain separator
  (`deriveGameScopedId`), so the same player in two different games gets
  cryptographically unlinkable anonymous IDs. Generated anonymous IDs are
  persisted per-game (`playprint_anon_${gameId}` in `localStorage`).
- **`'network'`** — cross-game ("network Legend") identity. Raw IDs are
  hashed without game scoping, and the generated anonymous ID is persisted
  under a shared key (`playprint_anon_network`) so your titles can recognize
  the same player.

**COPPA positioning.** Game scope is the data-minimizing, COPPA-safe default:
per-title identities cannot be joined into a cross-game profile of a child,
by you or by anyone downstream — the unlinkability is cryptographic, not
policy-based. Network scope enables cross-game Legends and is an explicit
opt-in; before using it, you are responsible for appropriate consent and
age-gating (e.g. verified parental consent for under-13 players in the US).

```ts
import { deriveGameScopedId } from '@playprint/sdk';

// SHA-256 over `playprint:v1:${gameId}:${rawId}` — deterministic per game
const idInGameA = await deriveGameScopedId('player-123', 'game_a');
const idInGameB = await deriveGameScopedId('player-123', 'game_b');
// idInGameA !== idInGameB, and neither reveals 'player-123'
```

The client reports its scope via `getIdentityScope()` and stamps
`identity_scope` into the `match_context` of emitted `decision.batch` events
so the platform can verify and enforce the scope server-side. To disable
anonymous-ID persistence entirely (fresh identity per client), pass
`persistAnonymousId: false`.

## Identified players

Playprint never stores raw user IDs. Hash them first:

```ts
import { hashUserId } from '@playprint/sdk';

const hashed = await hashUserId('player-123');           // 64-char SHA-256 hex
const salted = await hashUserId('player-123', 'my_salt');// per-title salt

const profile = await pp.getProfile('player-123'); // hashes internally
```

`getProfile(rawId)` hashes according to the client's identity scope: with the
default `'game'` scope it uses `deriveGameScopedId(rawId, gameId)`; with
`'network'` scope it uses the unscoped `hashUserId(rawId)`.

Anonymous players get a generated per-client anonymous ID automatically.

## Offline / no backend

The full `@playprint/core` pipeline runs locally, so you can profile players
without any network:

```ts
const profile = await pp.getLocalProfile(); // extractProfile() over stored matches
```

Note that the client's payloads must not contain PII — the ingest API rejects
events with suspected PII fields (`name`, `email`, `ip`, ...).

## License

MIT
