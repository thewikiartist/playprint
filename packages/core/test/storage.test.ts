import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LocalStorageAdapter, InMemoryStorage } from '../src/storage';
import type { MatchRecord, PlayprintData } from '../src/types';

function makeMatch(id: string): MatchRecord {
  return { matchId: id, result: 'win', events: [] };
}

function makeProfile(): PlayprintData {
  return {
    aggression: 0.5,
    aggressionStdDev: 0.1,
    informationPreference: 0.5,
    tempoEarly: 0.3,
    tempoMid: 0.4,
    tempoLate: 0.3,
    bluffRate: 0,
    patternBreakRate: 0,
    riskWhenWinning: 0.5,
    riskWhenLosing: 0.5,
    comebackRate: 0,
    counterplayRate: 0,
    totalDecisions: 10,
    totalMatches: 2,
  };
}

/** Minimal in-memory localStorage stand-in. */
function makeFakeLocalStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

describe('LocalStorageAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('SSR guard (no localStorage global)', () => {
    beforeEach(() => {
      vi.stubGlobal('localStorage', undefined);
    });

    it('loadMatches returns [] without throwing', async () => {
      const adapter = new LocalStorageAdapter();
      await expect(adapter.loadMatches('acc')).resolves.toEqual([]);
    });

    it('loadProfile returns null without throwing', async () => {
      const adapter = new LocalStorageAdapter();
      await expect(adapter.loadProfile('acc')).resolves.toBeNull();
    });

    it('saveMatch, saveProfile and clear are safe no-ops', async () => {
      const adapter = new LocalStorageAdapter();
      await expect(adapter.saveMatch('acc', makeMatch('m1'))).resolves.toBeUndefined();
      await expect(adapter.saveProfile('acc', makeProfile())).resolves.toBeUndefined();
      await expect(adapter.clear('acc')).resolves.toBeUndefined();
    });
  });

  describe('with a working localStorage', () => {
    let fake: ReturnType<typeof makeFakeLocalStorage>;

    beforeEach(() => {
      fake = makeFakeLocalStorage();
      vi.stubGlobal('localStorage', fake);
    });

    it('round-trips matches and profiles', async () => {
      const adapter = new LocalStorageAdapter();
      await adapter.saveMatch('acc', makeMatch('m1'));
      await adapter.saveMatch('acc', makeMatch('m2'));
      const matches = await adapter.loadMatches('acc');
      expect(matches.map((m) => m.matchId)).toEqual(['m1', 'm2']);

      await adapter.saveProfile('acc', makeProfile());
      const profile = await adapter.loadProfile('acc');
      expect(profile?.totalDecisions).toBe(10);
    });

    it('caps stored matches, keeping the most recent N', async () => {
      const adapter = new LocalStorageAdapter('playprint', 3);
      for (let i = 1; i <= 5; i++) {
        await adapter.saveMatch('acc', makeMatch(`m${i}`));
      }
      const matches = await adapter.loadMatches('acc');
      expect(matches.map((m) => m.matchId)).toEqual(['m3', 'm4', 'm5']);
    });

    it('defaults the match cap to 200', async () => {
      const adapter = new LocalStorageAdapter();
      const many = Array.from({ length: 205 }, (_, i) => makeMatch(`m${i}`));
      // Seed 204 matches directly, then save one more through the adapter
      fake.setItem('playprint:acc:matches', JSON.stringify(many.slice(0, 204)));
      await adapter.saveMatch('acc', many[204]);
      const matches = await adapter.loadMatches('acc');
      expect(matches).toHaveLength(200);
      expect(matches[matches.length - 1].matchId).toBe('m204');
      expect(matches[0].matchId).toBe('m5');
    });

    it('quarantines corrupt match JSON instead of destroying it', async () => {
      const adapter = new LocalStorageAdapter();
      fake.setItem('playprint:acc:matches', '{not valid json!');

      const matches = await adapter.loadMatches('acc');
      expect(matches).toEqual([]);
      expect(fake.getItem('playprint:acc:matches')).toBeNull();
      expect(fake.getItem('playprint:acc:matches.corrupt')).toBe('{not valid json!');
    });

    it('quarantines valid JSON that is not an array of matches', async () => {
      const adapter = new LocalStorageAdapter();
      fake.setItem('playprint:acc:matches', '{"oops":true}');

      const matches = await adapter.loadMatches('acc');
      expect(matches).toEqual([]);
      expect(fake.getItem('playprint:acc:matches.corrupt')).toBe('{"oops":true}');
    });

    it('quarantines corrupt profile JSON', async () => {
      const adapter = new LocalStorageAdapter();
      fake.setItem('playprint:acc:profile', 'garbage%%%');

      const profile = await adapter.loadProfile('acc');
      expect(profile).toBeNull();
      expect(fake.getItem('playprint:acc:profile')).toBeNull();
      expect(fake.getItem('playprint:acc:profile.corrupt')).toBe('garbage%%%');
    });

    it('saving after quarantine starts a fresh store', async () => {
      const adapter = new LocalStorageAdapter();
      fake.setItem('playprint:acc:matches', '{not valid json!');
      await adapter.saveMatch('acc', makeMatch('m1'));
      const matches = await adapter.loadMatches('acc');
      expect(matches.map((m) => m.matchId)).toEqual(['m1']);
      expect(fake.getItem('playprint:acc:matches.corrupt')).toBe('{not valid json!');
    });

    it('clear removes data and quarantined payloads', async () => {
      const adapter = new LocalStorageAdapter();
      fake.setItem('playprint:acc:matches.corrupt', 'old');
      fake.setItem('playprint:acc:profile.corrupt', 'old');
      await adapter.saveMatch('acc', makeMatch('m1'));
      await adapter.saveProfile('acc', makeProfile());

      await adapter.clear('acc');
      expect(fake.data.size).toBe(0);
    });
  });
});

describe('InMemoryStorage', () => {
  it('isolates accounts', async () => {
    const storage = new InMemoryStorage();
    await storage.saveMatch('a', makeMatch('m1'));
    expect(await storage.loadMatches('a')).toHaveLength(1);
    expect(await storage.loadMatches('b')).toHaveLength(0);
  });
});
