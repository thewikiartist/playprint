import { describe, it, expect } from 'vitest';
import { PlayprintTracker, createTracker } from '../src/tracker';
import { InMemoryStorage } from '../src/storage';
import type { GameModule } from '../src/types';

describe('PlayprintTracker', () => {
  it('completes a full match lifecycle', async () => {
    const tracker = new PlayprintTracker({ gameId: 'test_game' });

    const matchId = tracker.startMatch();
    expect(matchId).toBeTruthy();
    expect(tracker.isActive()).toBe(true);

    tracker.decision({ label: 'attack' });
    tracker.outcome({ type: 'hit', delta: 0.3 });
    tracker.decision({ label: 'defend' });
    tracker.outcome({ type: 'block', delta: -0.1 });

    const profile = await tracker.endMatch('win');
    expect(tracker.isActive()).toBe(false);
    expect(profile.totalDecisions).toBe(2);
    expect(profile.totalMatches).toBe(1);
  });

  it('auto-increments sequence numbers', () => {
    const tracker = new PlayprintTracker({ gameId: 'test_game' });
    tracker.startMatch();
    tracker.decision({ label: 'attack' });
    tracker.decision({ label: 'defend' });
    tracker.outcome({ type: 'hit', delta: 0.5 });

    const events = tracker.getEvents();
    const sequences = events.map((e) => e.sequence);
    expect(sequences).toEqual([0, 1, 2, 3]);
  });

  it('handles tier 1 input (label only)', () => {
    const tracker = new PlayprintTracker({ gameId: 'test_game' });
    tracker.startMatch();
    tracker.decision({ label: 'attack' });

    const events = tracker.getEvents();
    const decision = events.find((e) => e.event_name === 'decision');
    expect(decision?.decision?.decision_type).toBe('attack');
    expect(decision?.decision?.risk).toBe(0.7);
    expect(decision?.decision?.information).toBe(0.5);
    expect(decision?.decision?.tempo).toBeDefined();
  });

  it('handles tier 2 input (label + numbers)', () => {
    const tracker = new PlayprintTracker({ gameId: 'test_game' });
    tracker.startMatch();
    tracker.decision({ label: 'special_move', risk: 0.9, information: 0.8 });

    const events = tracker.getEvents();
    const decision = events.find((e) => e.event_name === 'decision');
    expect(decision?.decision?.risk).toBe(0.9);
    expect(decision?.decision?.information).toBe(0.8);
  });

  it('handles tier 3 input (full payload)', () => {
    const tracker = new PlayprintTracker({ gameId: 'test_game' });
    tracker.startMatch();
    tracker.decision({
      decision_type: 'custom',
      risk: 0.6,
      information: 0.7,
      tempo: 'late',
      intent_tags: ['aggressive', 'heavy_bluff'],
    });

    const events = tracker.getEvents();
    const decision = events.find((e) => e.event_name === 'decision');
    expect(decision?.decision?.decision_type).toBe('custom');
    expect(decision?.decision?.tempo).toBe('late');
    expect(decision?.decision?.intent_tags).toContain('heavy_bluff');
  });

  it('caps events at maxEventsPerMatch', () => {
    const tracker = new PlayprintTracker({
      gameId: 'test_game',
      maxEventsPerMatch: 5,
    });
    tracker.startMatch(); // event 1

    for (let i = 0; i < 10; i++) {
      tracker.decision({ label: 'attack' }); // events 2-5, then capped
    }

    expect(tracker.getEvents()).toHaveLength(5);
  });

  it('throws on decision before startMatch', () => {
    const tracker = new PlayprintTracker({ gameId: 'test_game' });
    expect(() => tracker.decision({ label: 'attack' })).toThrow(
      /no active match/,
    );
  });

  it('throws on outcome before startMatch', () => {
    const tracker = new PlayprintTracker({ gameId: 'test_game' });
    expect(() => tracker.outcome({ type: 'hit', delta: 0.5 })).toThrow(
      /no active match/,
    );
  });

  it('throws on endMatch before startMatch', async () => {
    const tracker = new PlayprintTracker({ gameId: 'test_game' });
    await expect(tracker.endMatch('win')).rejects.toThrow(/no active match/);
  });

  it('uses custom riskMap for tier 1 inference', () => {
    const tracker = new PlayprintTracker({
      gameId: 'test_game',
      riskMap: { fireball: 0.95 },
    });
    tracker.startMatch();
    tracker.decision({ label: 'fireball' });

    const events = tracker.getEvents();
    const decision = events.find((e) => e.event_name === 'decision');
    expect(decision?.decision?.risk).toBe(0.95);
  });

  it('accumulates profile across multiple matches', async () => {
    const tracker = new PlayprintTracker({ gameId: 'test_game' });

    tracker.startMatch();
    tracker.decision({ label: 'attack' });
    await tracker.endMatch('win');

    tracker.startMatch();
    tracker.decision({ label: 'defend' });
    const profile = await tracker.endMatch('loss');

    expect(profile.totalMatches).toBe(2);
    expect(profile.totalDecisions).toBe(2);
  });

  it('sets game_payload on events', () => {
    const tracker = new PlayprintTracker({ gameId: 'test_game' });
    tracker.startMatch({ gamePayload: { map: 'arena' } });
    tracker.decision({
      label: 'attack',
      gamePayload: { weapon: 'sword' },
    });

    const events = tracker.getEvents();
    expect(events[0].game_payload).toEqual({ map: 'arena' });
    expect(events[1].game_payload).toEqual({ weapon: 'sword' });
  });

  it('sets account_id when provided', () => {
    const tracker = new PlayprintTracker({
      gameId: 'test_game',
      accountId: 'player_1',
    });
    tracker.startMatch();
    tracker.decision({ label: 'attack' });

    const events = tracker.getEvents();
    expect(events[0].account_id).toBe('player_1');
  });

  it('omits account_id when not provided', () => {
    const tracker = new PlayprintTracker({ gameId: 'test_game' });
    tracker.startMatch();

    const events = tracker.getEvents();
    expect(events[0].account_id).toBeUndefined();
  });

  it('isProfileReady returns false before minimum matches', async () => {
    const tracker = new PlayprintTracker({
      gameId: 'test_game',
      minMatchesForProfile: 3,
    });

    tracker.startMatch();
    tracker.decision({ label: 'attack' });
    await tracker.endMatch('win');

    expect(await tracker.isProfileReady()).toBe(false);
  });

  it('isProfileReady returns true after minimum matches', async () => {
    const tracker = new PlayprintTracker({
      gameId: 'test_game',
      minMatchesForProfile: 2,
    });

    tracker.startMatch();
    tracker.decision({ label: 'attack' });
    await tracker.endMatch('win');

    tracker.startMatch();
    tracker.decision({ label: 'defend' });
    await tracker.endMatch('loss');

    expect(await tracker.isProfileReady()).toBe(true);
  });

  it('defaults minMatchesForProfile to 5', async () => {
    const tracker = new PlayprintTracker({ gameId: 'test_game' });

    for (let i = 0; i < 4; i++) {
      tracker.startMatch();
      tracker.decision({ label: 'attack' });
      await tracker.endMatch('win');
    }
    expect(await tracker.isProfileReady()).toBe(false);

    tracker.startMatch();
    tracker.decision({ label: 'attack' });
    await tracker.endMatch('win');
    expect(await tracker.isProfileReady()).toBe(true);
  });

  it('throws on startMatch while a match is active', () => {
    const tracker = new PlayprintTracker({ gameId: 'test_game' });
    tracker.startMatch();
    expect(() => tracker.startMatch()).toThrow(/already active/);
  });

  it('discardMatch resets without saving', async () => {
    const tracker = new PlayprintTracker({ gameId: 'test_game' });
    tracker.startMatch();
    tracker.decision({ label: 'attack' });
    tracker.discardMatch();

    expect(tracker.isActive()).toBe(false);
    expect(tracker.getEvents()).toHaveLength(0);

    // Profile should have no matches (nothing was saved)
    const profile = await tracker.getProfile();
    expect(profile.totalMatches).toBe(0);
  });

  it('can start a new match after discardMatch', () => {
    const tracker = new PlayprintTracker({ gameId: 'test_game' });
    tracker.startMatch();
    tracker.discardMatch();
    const matchId = tracker.startMatch();
    expect(matchId).toBeTruthy();
    expect(tracker.isActive()).toBe(true);
  });

  it('emit() creates a custom event with game payload', () => {
    const tracker = new PlayprintTracker({ gameId: 'test_game' });
    tracker.startMatch();
    tracker.emit('hand.start', { turn_number: 1 });

    const events = tracker.getEvents();
    const custom = events.find((e) => e.event_name === 'hand.start');
    expect(custom).toBeDefined();
    expect(custom?.game_payload).toEqual({ turn_number: 1 });
  });

  it('emit() creates a custom event without payload', () => {
    const tracker = new PlayprintTracker({ gameId: 'test_game' });
    tracker.startMatch();
    tracker.emit('round.start');

    const events = tracker.getEvents();
    const custom = events.find((e) => e.event_name === 'round.start');
    expect(custom).toBeDefined();
    expect(custom?.game_payload).toBeUndefined();
  });

  it('emit() throws when no match is active', () => {
    const tracker = new PlayprintTracker({ gameId: 'test_game' });
    expect(() => tracker.emit('custom')).toThrow(/no active match/);
  });

  it('emit() increments sequence numbers', () => {
    const tracker = new PlayprintTracker({ gameId: 'test_game' });
    tracker.startMatch();
    tracker.emit('hand.start', { turn: 1 });
    tracker.decision({ label: 'attack' });
    tracker.emit('communication', { msg: 'gg' });

    const events = tracker.getEvents();
    const sequences = events.map((e) => e.sequence);
    expect(sequences).toEqual([0, 1, 2, 3]);
  });

  // ── Input validation ──────────────────────────────────────

  it('clamps tier 2 risk above 1 to 1', () => {
    const tracker = new PlayprintTracker({ gameId: 'test_game' });
    tracker.startMatch();
    tracker.decision({ label: 'big_attack', risk: 1.5, information: 0.5 });

    const events = tracker.getEvents();
    const decision = events.find((e) => e.event_name === 'decision');
    expect(decision?.decision?.risk).toBe(1);
  });

  it('clamps tier 2 risk below 0 to 0', () => {
    const tracker = new PlayprintTracker({ gameId: 'test_game' });
    tracker.startMatch();
    tracker.decision({ label: 'retreat', risk: -0.3, information: 0.5 });

    const events = tracker.getEvents();
    const decision = events.find((e) => e.event_name === 'decision');
    expect(decision?.decision?.risk).toBe(0);
  });

  it('clamps tier 2 information to [0, 1]', () => {
    const tracker = new PlayprintTracker({ gameId: 'test_game' });
    tracker.startMatch();
    tracker.decision({ label: 'attack', risk: 0.5, information: 2.0 });

    const events = tracker.getEvents();
    const decision = events.find((e) => e.event_name === 'decision');
    expect(decision?.decision?.information).toBe(1);
  });

  it('clamps tier 3 risk and information to [0, 1]', () => {
    const tracker = new PlayprintTracker({ gameId: 'test_game' });
    tracker.startMatch();
    tracker.decision({
      decision_type: 'custom',
      risk: 5,
      information: -1,
      tempo: 'mid',
    });

    const events = tracker.getEvents();
    const decision = events.find((e) => e.event_name === 'decision');
    expect(decision?.decision?.risk).toBe(1);
    expect(decision?.decision?.information).toBe(0);
  });

  it('throws on NaN outcome delta', () => {
    const tracker = new PlayprintTracker({ gameId: 'test_game' });
    tracker.startMatch();
    expect(() => tracker.outcome({ type: 'hit', delta: NaN })).toThrow(/Invalid outcome delta/);
  });

  it('throws on Infinity outcome delta', () => {
    const tracker = new PlayprintTracker({ gameId: 'test_game' });
    tracker.startMatch();
    expect(() => tracker.outcome({ type: 'hit', delta: Infinity })).toThrow(/Invalid outcome delta/);
  });

  it('throws on -Infinity outcome delta', () => {
    const tracker = new PlayprintTracker({ gameId: 'test_game' });
    tracker.startMatch();
    expect(() => tracker.outcome({ type: 'hit', delta: -Infinity })).toThrow(/Invalid outcome delta/);
  });

  // ── Anonymous identity ────────────────────────────────────

  it('anonymous trackers get unique buckets in shared storage', async () => {
    const shared = new InMemoryStorage();
    const trackerA = new PlayprintTracker({ gameId: 'test_game', storage: shared });
    const trackerB = new PlayprintTracker({ gameId: 'test_game', storage: shared });

    trackerA.startMatch();
    trackerA.decision({ label: 'attack' });
    await trackerA.endMatch('win');

    const profileA = await trackerA.getProfile();
    const profileB = await trackerB.getProfile();
    expect(profileA.totalMatches).toBe(1);
    expect(profileB.totalMatches).toBe(0);
  });

  it('generates a stable, non-shared temporary ID for anonymous accounts', async () => {
    const trackerA = new PlayprintTracker({ gameId: 'test_game' });
    const trackerB = new PlayprintTracker({ gameId: 'test_game' });

    const exportA1 = await trackerA.exportData();
    const exportA2 = await trackerA.exportData();
    const exportB = await trackerB.exportData();

    expect(exportA1.accountId).not.toBe('__anonymous__');
    expect(exportA1.accountId.length).toBeGreaterThanOrEqual(16);
    expect(exportA1.accountId).toBe(exportA2.accountId);
    expect(exportA1.accountId).not.toBe(exportB.accountId);
  });

  // ── Event buffer cap semantics ────────────────────────────

  it('drops OLDEST events at the cap, preserving match.end', async () => {
    const tracker = new PlayprintTracker({
      gameId: 'test_game',
      maxEventsPerMatch: 3,
    });
    tracker.startMatch();
    for (let i = 0; i < 5; i++) {
      tracker.decision({ label: `move_${i}` });
    }
    await tracker.endMatch('win');

    const exported = await tracker.exportData();
    const events = exported.matches[0].events;
    expect(events).toHaveLength(3);
    expect(events[events.length - 1].event_name).toBe('match.end');
    // The newest decisions survive; the oldest events were evicted
    expect(events[0].decision?.decision_type).toBe('move_3');
    expect(events[1].decision?.decision_type).toBe('move_4');
  });

  // ── createTracker schema version passthrough ──────────────

  it('createTracker passes GameModule.schemaVersion through to events', () => {
    const module: GameModule = {
      gameId: 'mod_game',
      displayName: 'Mod Game',
      schemaVersion: '2.1',
      bluffTag: 'heavy_bluff',
      patternBreakTag: 'pattern_break',
      extensionExtractors: {},
    };
    const tracker = createTracker(module);
    tracker.startMatch();
    tracker.decision({ label: 'attack' });

    for (const event of tracker.getEvents()) {
      expect(event.schema_version).toBe('2.1');
    }
  });

  it('defaults event schema_version to 1.0 without a module', () => {
    const tracker = new PlayprintTracker({ gameId: 'test_game' });
    tracker.startMatch();
    expect(tracker.getEvents()[0].schema_version).toBe('1.0');
  });
});
