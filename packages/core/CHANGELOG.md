# Changelog

## 0.2.1 (2026-07-24)

Metadata-only release — no code changes.

- README: added a "Which package do I want?" guide (core vs `@playprint/sdk`)
- package.json: repository/homepage/bugs now point to the public
  [playprint repo](https://github.com/thewikiartist/playprint) (the previous
  links pointed at a private monorepo and returned 404)
- Sharpened description and keywords (ghost-ai, ai-bots, drivatar,
  async-multiplayer) so the package surfaces for the problems it solves

## 0.2.0 (2026-07-21)

Believability release — population calibration and expressive ghosts.
All changes are additive; no existing API signature or behavior changed
unless you opt in by passing the new parameters.

### Features

- **Population calibration** (new `calibration.ts`): serializable per-game
  `GameCalibration` with `createCalibration()` (optionally seeded from a
  `GameModule.calibrationPrior`), `updateCalibration()`,
  `calibrationFromTraitProfiles()`, and `calibrateTraits()` — re-expresses
  raw traits as population-relative values spanning the full [0, 1] range.
  Fixes trait compression (all traits landing in a narrow band) and the
  resulting archetype collapse.
- **createGhost(profile, calibration?)** — with a calibration, ghost biases
  are derived from calibrated traits via the new `ghostBiasesFromTraits()`
  full-range mapping (0 → 0, 1 → 1, no re-centering).
- **getArchetype(profile, calibration?)** — with a calibration, archetype
  thresholds become population quantiles instead of raw-value cutoffs.
- **buildGhostProfileFromModule(..., calibration?)** — passes through.
- **ExtractionOptions.decisionTypeVocabulary** (and
  `GameModule.decisionTypes`) — `decisionTypeDiversity` entropy is
  Laplace-smoothed over the game's declared vocabulary, so a single rare
  decision type no longer flips the value.
- **PlayprintData.riskFrontloading** — match-length-invariant urgency
  signal (first-half vs second-half decision risk); `urgent` derives from
  it when present, with the v2 tempo formula as fallback.
- **PlayprintData.confidence** — evidence confidence that calibration,
  archetypes, and ghosts use to treat low-evidence profiles as neutral.
- **PROFILE_MODEL_VERSION = 3.** Trait shapes are unchanged (same 6
  canonical keys) so no new trait-compat mapping is needed; v2 profiles
  remain fully readable.

## 0.1.0 (2026-02-24)

Initial public release.

### Features

- **PlayprintTracker** — Record decisions and outcomes with 3-tier input (label-only, risk+info, full payload)
- **extractProfile()** — Aggregate match history into 14-dimensional `PlayprintData`
- **createGhost() / mapGhostBiases()** — Convert profiles to 5 abstract ghost AI biases, then map to game-specific parameters
- **getArchetype()** — Simple 4-bucket archetype classification with optional Deceiver modifier
- **generateArchetype()** — Rich 5-layer generative personality system (18 archetypes, 18 modifiers, tempo tags, behavior combos, taglines)
- **deriveTraits()** — Map raw profiles to 9 normalized trait dimensions with game-specific overrides
- **getLegendPresentation()** — Player-facing presentation layer with titles, trait names, tips, and icons
- **inferRisk() / inferTags()** — Label-based risk and intent inference for Tier 1 decisions
- **InMemoryStorage** — Reference storage adapter for testing
- **LocalStorageAdapter** — Browser localStorage persistence for client-side games
- Dual ESM/CJS output via tsup
- Full TypeScript type exports
- Zero runtime dependencies
