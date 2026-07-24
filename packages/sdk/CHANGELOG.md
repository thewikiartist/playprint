# Changelog

## 0.1.1 (2026-07-24)

Metadata-only release — no code changes.

- README: added a "Which package do I want?" guide (`@playprint/core` vs sdk)
- package.json: repository/homepage/bugs now point to the public
  [playprint repo](https://github.com/thewikiartist/playprint) (the previous
  links pointed at a private monorepo and returned 404)
- Sharpened description and keywords so the package surfaces for the
  problems it solves

## 0.1.0 (2026-07-21)

Initial release: `PlayprintClient` wrapping `@playprint/core` — telemetry
ingest (match.start / decision.batch / match.end), reliable delivery with
retry and sendBeacon flush, hosted profile retrieval, and per-game
unlinkable identity scoping.
