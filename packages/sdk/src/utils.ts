/** Random hex string of `bytes * 2` characters, cryptographically strong when possible. */
export function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  const cryptoGlobal = (globalThis as {
    crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array };
  }).crypto;
  if (cryptoGlobal?.getRandomValues) {
    cryptoGlobal.getRandomValues(arr);
  } else {
    for (let i = 0; i < bytes; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
  }
  let out = '';
  for (let i = 0; i < arr.length; i++) {
    out += arr[i].toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Generate an anonymous user ID for players without an account.
 * 37 characters — well above the platform's 16-char minimum.
 */
export function generateAnonymousId(): string {
  return `anon_${randomHex(16)}`;
}

/** Generate a session ID. */
export function generateSessionId(): string {
  return `sess_${randomHex(12)}`;
}

/** Promise-based sleep. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
