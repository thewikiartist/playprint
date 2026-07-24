/** Generate a UUID v4 string. */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** ISO 8601 timestamp. */
export function now(): string {
  return new Date().toISOString();
}

/** Clamp a value between min and max. */
export function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

/** Filter out NaN and Infinity values. */
function finite(values: number[]): number[] {
  return values.filter(Number.isFinite);
}

/** Arithmetic mean of an array. Non-finite values are ignored. Returns 0 for empty arrays. */
export function mean(values: number[]): number {
  const safe = finite(values);
  if (safe.length === 0) return 0;
  return safe.reduce((s, v) => s + v, 0) / safe.length;
}

/** Population standard deviation. Non-finite values are ignored. Returns 0 for empty arrays. */
export function stddev(values: number[]): number {
  const safe = finite(values);
  if (safe.length === 0) return 0;
  const m = safe.reduce((s, v) => s + v, 0) / safe.length;
  const variance = safe.reduce((s, v) => s + (v - m) ** 2, 0) / safe.length;
  return Math.sqrt(variance);
}

// ── Version comparison ──────────────────────────────────────────

/**
 * Compare two semver-like version strings (e.g. `'1.0'`, `'1.2.3'`).
 *
 * Returns:
 * - Negative if `a < b`
 * - Zero if `a === b`
 * - Positive if `a > b`
 *
 * Handles versions with different numbers of segments (e.g. `'1.0'` vs `'1.0.1'`).
 */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  const len = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < len; i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA !== numB) return numA - numB;
  }
  return 0;
}

// ── PII Sanitization ────────────────────────────────────────────

/** Field names commonly associated with PII. */
const PII_FIELD_NAMES = new Set([
  'name', 'first_name', 'last_name', 'full_name', 'username',
  'email', 'email_address', 'mail',
  'phone', 'phone_number', 'telephone',
  'address', 'street', 'city', 'zip', 'postal_code',
  'ip', 'ip_address', 'ipv4', 'ipv6',
  'ssn', 'social_security',
  'password', 'secret', 'token', 'api_key',
  'credit_card', 'card_number',
  'date_of_birth', 'dob', 'birthday',
]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IPV4_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/**
 * Recursively strip known PII patterns from an object.
 * Removes fields whose names match known PII field names,
 * and redacts string values that look like emails or IP addresses.
 */
function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();

    // Skip PII-named fields entirely
    if (PII_FIELD_NAMES.has(lowerKey)) continue;

    // Redact string values that look like PII
    if (typeof value === 'string') {
      if (EMAIL_PATTERN.test(value) || IPV4_PATTERN.test(value)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = value;
      }
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = sanitizeObject(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}

// ── Behavioral Signature Hashing ─────────────────────────────────

/** Core profile fields in fixed canonical order for hashing. */
const CANONICAL_FIELDS = [
  'aggression',
  'aggressionStdDev',
  'informationPreference',
  'tempoEarly',
  'tempoMid',
  'tempoLate',
  'bluffRate',
  'patternBreakRate',
  'riskWhenWinning',
  'riskWhenLosing',
  'comebackRate',
  'counterplayRate',
  'decisionTypeDiversity',
] as const;

/**
 * Produce a deterministic canonical string from core profile fields.
 * Extensions are excluded for cross-game stability.
 */
function canonicalizeBehavior(profile: import('./types').PlayprintData): string {
  return CANONICAL_FIELDS
    .map((key) => {
      const val = (profile as unknown as Record<string, unknown>)[key];
      const num = typeof val === 'number' && Number.isFinite(val) ? val : 0;
      return `${key}=${num.toFixed(3)}`;
    })
    .join('|');
}

/**
 * One-way behavioral fingerprint via SHA-256.
 *
 * Produces a deterministic hex digest of quantized core profile fields.
 * Extensions are excluded so the hash is stable across games.
 *
 * Requires `crypto.subtle` (available in browsers, Node 15+, Deno, workers).
 */
export async function hashBehavioralSignature(
  profile: import('./types').PlayprintData,
): Promise<string> {
  const canonical = canonicalizeBehavior(profile);
  const data = new TextEncoder().encode(canonical);
  const buffer = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Synchronous behavioral fingerprint via FNV-1a (32-bit).
 *
 * Fallback for environments without `crypto.subtle`.
 * Returns an 8-character hex string.
 */
export function hashBehavioralSignatureSync(
  profile: import('./types').PlayprintData,
): string {
  const canonical = canonicalizeBehavior(profile);
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Default PII sanitizer for telemetry events.
 *
 * Strips known PII field names from `game_payload` and `metadata`,
 * and redacts string values matching email or IP patterns.
 *
 * Usage:
 * ```ts
 * new PlayprintTracker({ gameId: 'my_game', sanitize: stripKnownPii });
 * ```
 */
export function stripKnownPii(event: import('./types').TelemetryEvent): import('./types').TelemetryEvent {
  const sanitized = { ...event };

  if (sanitized.game_payload) {
    sanitized.game_payload = sanitizeObject(sanitized.game_payload);
  }
  if (sanitized.metadata) {
    sanitized.metadata = sanitizeObject(sanitized.metadata);
  }

  return sanitized;
}
