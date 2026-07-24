// Types
export type {
  TelemetryEvent,
  DecisionPayload,
  OutcomePayload,
  DecisionInput,
  PlayprintData,
  MatchRecord,
  GhostBiases,
  Archetype,
  StorageAdapter,
  TrackerOptions,
  ExtractionOptions,
  TraitProfile,
  GenerativeArchetypeResult,
  TraitDefinition,
  TraitPresentation,
  SkillPresentation,
  LegendPresentationResult,
  PresentationOverrides,
  PresentationOptions,
  DeriveTraitsOptions,
  EventSanitizer,
  GhostDecisionEngine,
  ExportedPlayerData,
  DeletionResult,
  // New types
  DecisionCategory,
  ExtensionExtractorMap,
  GameModule,
  GhostProfileData,
  GhostModifier,
  StateActionEntry,
  StateActionTable,
  CommunicationBiases,
  CanonicalTrait,
  SkillScore,
} from './types';

// Core API
export { PlayprintTracker, exportPlayerData, deletePlayerData, createTracker } from './tracker';
export { extractProfile } from './extraction';

// Population calibration
export {
  createCalibration,
  updateCalibration,
  calibrationFromTraitProfiles,
  calibrateTraits,
  normalCdf,
} from './calibration';
export type {
  GameCalibration,
  TraitCalibrationStats,
  CalibrationPrior,
  CalibrateOptions,
} from './calibration';

export {
  createGhost,
  ghostBiasesFromTraits,
  mapGhostBiases,
  sampleFromDistribution,
  buildGhostProfileFromModule,
  composeModifiers,
  conditionalModifier,
  resolveStateAction,
  buildFallbackKeys,
  deriveCommunicationBiases,
  classifyCommunicationStyle,
} from './ghost';
export { getArchetype } from './archetypes';

// Generative archetypes
export { generateArchetype, HANDLE_LABELS } from './generative-archetypes';
export {
  deriveTraits,
  deriveAwareness,
  STANDARD_TRAIT_KEYS,
  CANONICAL_TRAIT_KEYS,
  LEGACY_TRAIT_KEYS,
  PROFILE_MODEL_VERSION,
} from './traits';
export { getLegendPresentation, DEFAULT_TRAITS, DEFAULT_SKILLS } from './presentation';

// Trait compatibility
export {
  mapV1toV2,
  mapV2toV1,
  TRAIT_ALIASES,
  REVERSE_ALIASES,
  detectProfileVersion,
} from './trait-compat';

// Storage
export { InMemoryStorage, LocalStorageAdapter } from './storage';

// Inference utilities
export { inferRisk, inferTags, defaultComputeTempo, DEFAULT_RISK_MAP, classifyDecision } from './inference';

// Skills
export { extractCoreSkills, pairDecisionsWithOutcomes } from './skills';
export type { CoreSkillScores } from './skills';

// Utilities
export { stripKnownPii, compareVersions, hashBehavioralSignature, hashBehavioralSignatureSync } from './utils';

// Game module registry
export {
  registerGameModule,
  getGameModule,
  getAllGameModules,
  hasGameModule,
  clearGameModuleRegistry,
} from './registry';
