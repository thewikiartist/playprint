#!/usr/bin/env node
/**
 * Sync package sources from the private Moonbeans monorepo into this public
 * mirror. Development happens in Moonbeans; run this before pushing/publishing
 * from the mirror so the two never drift.
 *
 * Usage:
 *   node scripts/sync-from-moonbeans.mjs [path-to-moonbeans]
 *
 * Defaults to ../Moonbeans relative to this repo's root. Copies are
 * whole-directory replaces (delete + copy) so removals propagate too.
 * CLAUDE.md, node_modules, dist, and tarballs never cross over.
 */

import { cpSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const moonbeans = resolve(process.argv[2] ?? join(repoRoot, '..', 'Moonbeans'));

// [source dir in Moonbeans, target dir here]
const MAPPINGS = [
  [join(moonbeans, 'packages', 'playprint'), join(repoRoot, 'packages', 'core')],
  [join(moonbeans, 'packages', 'playprint-sdk'), join(repoRoot, 'packages', 'sdk')],
];

// Never copied into the public mirror.
const EXCLUDE = new Set(['node_modules', 'dist', 'CLAUDE.md', '.turbo']);

if (!existsSync(moonbeans)) {
  console.error(`Moonbeans not found at ${moonbeans} — pass its path as the first argument.`);
  process.exit(1);
}

for (const [src, dest] of MAPPINGS) {
  if (!existsSync(src)) {
    console.error(`Missing source: ${src}`);
    process.exit(1);
  }
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, {
    recursive: true,
    filter: (p) => !EXCLUDE.has(basename(p)) && !p.endsWith('.tgz'),
  });
  console.log(`synced ${src} -> ${dest}`);
}

console.log('\nDone. Review with `git status`, then build/test before pushing:');
console.log('  pnpm install && pnpm build && pnpm test && pnpm typecheck');
