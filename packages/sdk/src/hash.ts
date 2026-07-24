/**
 * User ID hashing — playprint.ai never receives raw user identifiers.
 *
 * `hashUserId` produces a SHA-256 hex digest (64 chars, comfortably above the
 * platform's 16-char minimum for `anonymous_user_id`). Uses `crypto.subtle`
 * where available (browsers, Node 18+, Deno, workers) with a `node:crypto`
 * fallback for Node environments without WebCrypto globals.
 */

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

interface SubtleLike {
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
}

interface NodeHashLike {
  update(data: Uint8Array): { digest(encoding: string): string };
}

/**
 * Hash a raw user ID to a stable, anonymous SHA-256 hex string.
 *
 * @param rawId - The raw user identifier (never sent to playprint.ai).
 * @param salt - Optional salt, prepended as `${salt}:${rawId}` before hashing.
 *   Use a per-title salt to prevent cross-referencing IDs across games.
 */
export async function hashUserId(rawId: string, salt?: string): Promise<string> {
  const input = salt ? `${salt}:${rawId}` : rawId;
  const data = new TextEncoder().encode(input);

  const subtle = (globalThis as { crypto?: { subtle?: SubtleLike } }).crypto?.subtle;
  if (subtle) {
    const buffer = await subtle.digest('SHA-256', data);
    return toHex(new Uint8Array(buffer));
  }

  // Node fallback — dynamic specifier keeps this out of browser bundles and
  // avoids a hard type dependency on @types/node.
  try {
    const specifier = 'node:crypto';
    const mod = (await import(/* @vite-ignore */ specifier)) as {
      createHash?: (algorithm: string) => NodeHashLike;
    };
    if (mod.createHash) {
      return mod.createHash('sha256').update(data).digest('hex');
    }
  } catch {
    // fall through to the error below
  }

  throw new Error('hashUserId requires WebCrypto (crypto.subtle) or node:crypto.');
}

/**
 * Derive a GAME-SCOPED anonymous identity from a raw user ID.
 *
 * Computes SHA-256 over the domain-separated string
 * `playprint:v1:${gameId}:${rawId}` and returns the 64-char hex digest.
 * Deterministic: the same `(rawId, gameId)` pair always yields the same ID,
 * while the same `rawId` under two different `gameId`s yields unrelated,
 * cryptographically unlinkable IDs — no party can correlate a player across
 * titles from the derived values alone. This is the identity used by
 * `PlayprintClient` in the default `'game'` identity scope.
 *
 * @param rawId - The raw user identifier (never sent to playprint.ai).
 * @param gameId - The game identifier to scope the identity to.
 */
export async function deriveGameScopedId(rawId: string, gameId: string): Promise<string> {
  return hashUserId(rawId, `playprint:v1:${gameId}`);
}
