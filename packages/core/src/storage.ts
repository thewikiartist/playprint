import type { StorageAdapter, MatchRecord, PlayprintData } from './types';

/** In-memory storage adapter. Useful for testing and single-session use. */
export class InMemoryStorage implements StorageAdapter {
  private matches = new Map<string, MatchRecord[]>();
  private profiles = new Map<string, PlayprintData>();

  async saveMatch(accountId: string, match: MatchRecord): Promise<void> {
    const existing = this.matches.get(accountId) ?? [];
    existing.push(match);
    this.matches.set(accountId, existing);
  }

  async loadMatches(accountId: string): Promise<MatchRecord[]> {
    return this.matches.get(accountId) ?? [];
  }

  async saveProfile(accountId: string, profile: PlayprintData): Promise<void> {
    this.profiles.set(accountId, profile);
  }

  async loadProfile(accountId: string): Promise<PlayprintData | null> {
    return this.profiles.get(accountId) ?? null;
  }

  async clear(accountId: string): Promise<void> {
    this.matches.delete(accountId);
    this.profiles.delete(accountId);
  }
}

/** Default maximum number of stored matches per account (most recent kept). */
const DEFAULT_MAX_STORED_MATCHES = 200;

/** Minimal structural type for the localStorage global (avoids requiring DOM libs). */
interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Browser localStorage adapter. Persists match history and profiles across sessions.
 *
 * Data is stored as JSON under keys prefixed with `playprint:`. Each account gets
 * two keys: `playprint:{accountId}:matches` and `playprint:{accountId}:profile`.
 *
 * Behavior notes:
 * - Safe in environments without a `localStorage` global (SSR, workers, Node):
 *   reads return empty results and writes are no-ops.
 * - Stored matches are capped at `maxStoredMatches` (default 200); the most
 *   recent matches are kept.
 * - Corrupt JSON payloads are quarantined under a `.corrupt` sibling key
 *   (rather than destroyed) and treated as empty.
 *
 * @example
 * ```ts
 * import { PlayprintTracker, LocalStorageAdapter } from '@playprint/core';
 *
 * const tracker = new PlayprintTracker({
 *   gameId: 'my_game',
 *   storage: new LocalStorageAdapter(),
 * });
 * ```
 */
export class LocalStorageAdapter implements StorageAdapter {
  private prefix: string;
  private maxStoredMatches: number;

  constructor(prefix = 'playprint', maxStoredMatches = DEFAULT_MAX_STORED_MATCHES) {
    this.prefix = prefix;
    this.maxStoredMatches = maxStoredMatches;
  }

  /** Resolve the localStorage global, or null when unavailable (SSR). */
  private store(): WebStorageLike | null {
    const g = globalThis as { localStorage?: WebStorageLike };
    return typeof g.localStorage === 'undefined' || g.localStorage === null
      ? null
      : g.localStorage;
  }

  private matchesKey(accountId: string): string {
    return `${this.prefix}:${accountId}:matches`;
  }

  private profileKey(accountId: string): string {
    return `${this.prefix}:${accountId}:profile`;
  }

  /** Move a corrupt payload to a `.corrupt` sibling key so data isn't destroyed. */
  private quarantine(store: WebStorageLike, key: string, raw: string): void {
    store.setItem(`${key}.corrupt`, raw);
    store.removeItem(key);
  }

  async saveMatch(accountId: string, match: MatchRecord): Promise<void> {
    const store = this.store();
    if (!store) return;
    let matches = await this.loadMatches(accountId);
    matches.push(match);
    // Cap stored matches: keep the most recent N
    if (matches.length > this.maxStoredMatches) {
      matches = matches.slice(-this.maxStoredMatches);
    }
    store.setItem(this.matchesKey(accountId), JSON.stringify(matches));
  }

  async loadMatches(accountId: string): Promise<MatchRecord[]> {
    const store = this.store();
    if (!store) return [];
    const key = this.matchesKey(accountId);
    const raw = store.getItem(key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        this.quarantine(store, key, raw);
        return [];
      }
      return parsed as MatchRecord[];
    } catch {
      this.quarantine(store, key, raw);
      return [];
    }
  }

  async saveProfile(accountId: string, profile: PlayprintData): Promise<void> {
    const store = this.store();
    if (!store) return;
    store.setItem(this.profileKey(accountId), JSON.stringify(profile));
  }

  async loadProfile(accountId: string): Promise<PlayprintData | null> {
    const store = this.store();
    if (!store) return null;
    const key = this.profileKey(accountId);
    const raw = store.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PlayprintData;
    } catch {
      this.quarantine(store, key, raw);
      return null;
    }
  }

  async clear(accountId: string): Promise<void> {
    const store = this.store();
    if (!store) return;
    store.removeItem(this.matchesKey(accountId));
    store.removeItem(this.profileKey(accountId));
    store.removeItem(`${this.matchesKey(accountId)}.corrupt`);
    store.removeItem(`${this.profileKey(accountId)}.corrupt`);
  }
}
