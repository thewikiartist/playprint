// Client
export { PlayprintClient } from './client';

// User ID hashing / game-scoped identity derivation
export { hashUserId, deriveGameScopedId } from './hash';

// Identity generators
export { generateAnonymousId, generateSessionId } from './utils';

// Types
export type {
  PlayprintClientOptions,
  PlayprintEnvironment,
  WireEnvironment,
  OpponentType,
  IdentityScope,
  IngestEvent,
  BatchDecision,
  DecisionSequenceEntry,
  MatchContext,
  FlushResult,
  FetchLike,
  FetchResponseLike,
} from './types';

// Re-exports from the core engine for convenience
export type { DecisionInput, PlayprintData, StorageAdapter } from '@playprint/core';
