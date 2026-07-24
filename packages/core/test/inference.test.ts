import { describe, it, expect } from 'vitest';
import { inferRisk, inferTags, defaultComputeTempo, DEFAULT_RISK_MAP } from '../src/inference';

describe('inferRisk', () => {
  it('returns known risk for mapped labels', () => {
    expect(inferRisk('attack')).toBe(0.7);
    expect(inferRisk('defend')).toBe(0.2);
    expect(inferRisk('gamble')).toBe(0.9);
    expect(inferRisk('heal')).toBe(0.15);
  });

  it('is case-insensitive', () => {
    expect(inferRisk('ATTACK')).toBe(0.7);
    expect(inferRisk('Defend')).toBe(0.2);
  });

  it('returns 0.5 for unknown labels', () => {
    expect(inferRisk('somethingweird')).toBe(0.5);
    expect(inferRisk('xyz_action')).toBe(0.5);
  });

  it('uses custom riskMap when provided', () => {
    const custom = { fireball: 0.95, heal: 0.05 };
    expect(inferRisk('fireball', custom)).toBe(0.95);
    expect(inferRisk('heal', custom)).toBe(0.05); // custom overrides default
  });

  it('falls back to DEFAULT_RISK_MAP when custom map misses', () => {
    const custom = { fireball: 0.95 };
    expect(inferRisk('attack', custom)).toBe(0.7); // from default
  });

  it('clamps custom map values above 1 to 1', () => {
    expect(inferRisk('overpowered', { overpowered: 1.5 })).toBe(1);
  });

  it('clamps custom map values below 0 to 0', () => {
    expect(inferRisk('negative', { negative: -0.3 })).toBe(0);
  });

  it('returns 0.5 for NaN custom map values', () => {
    expect(inferRisk('broken', { broken: NaN })).toBe(0.5);
  });

  it('returns 0.5 for Infinity custom map values', () => {
    expect(inferRisk('broken', { broken: Infinity })).toBe(0.5);
  });
});

describe('inferTags', () => {
  it('tags aggressive labels', () => {
    expect(inferTags('attack')).toContain('aggressive');
    expect(inferTags('rush')).toContain('aggressive');
  });

  it('tags defensive labels', () => {
    expect(inferTags('defend')).toContain('defensive');
    expect(inferTags('shield')).toContain('defensive');
  });

  it('tags bluff as both aggressive and heavy_bluff', () => {
    const tags = inferTags('bluff');
    expect(tags).toContain('aggressive');
    expect(tags).toContain('heavy_bluff');
  });

  it('tags counter as disruption', () => {
    expect(inferTags('counter')).toContain('disruption');
  });

  it('tags building labels', () => {
    expect(inferTags('build')).toContain('building');
    expect(inferTags('setup')).toContain('building');
  });

  it('returns empty for unknown labels', () => {
    expect(inferTags('xyz')).toEqual([]);
  });
});

describe('defaultComputeTempo', () => {
  it('returns early for sequences 1-5', () => {
    expect(defaultComputeTempo(1)).toBe('early');
    expect(defaultComputeTempo(5)).toBe('early');
  });

  it('returns mid for sequences 6-15', () => {
    expect(defaultComputeTempo(6)).toBe('mid');
    expect(defaultComputeTempo(15)).toBe('mid');
  });

  it('returns late for sequences 16+', () => {
    expect(defaultComputeTempo(16)).toBe('late');
    expect(defaultComputeTempo(100)).toBe('late');
  });
});

describe('DEFAULT_RISK_MAP', () => {
  it('has entries for all expected labels', () => {
    const expected = [
      'attack', 'aggressive', 'rush', 'gamble', 'bluff',
      'defend', 'block', 'shield', 'heal', 'wait',
      'build', 'setup', 'position',
      'counter', 'trade', 'neutral',
      'retreat', 'flee', 'surrender',
    ];
    for (const label of expected) {
      expect(DEFAULT_RISK_MAP).toHaveProperty(label);
      expect(typeof DEFAULT_RISK_MAP[label]).toBe('number');
    }
  });
});
