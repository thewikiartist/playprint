import type { GameModule } from './types';

/**
 * SDK-level game module registry.
 *
 * Games register their modules at import time. The registry enables
 * cross-game discovery (e.g. listing all games in a store) without
 * hardcoding game lists in the application layer.
 */

const registry = new Map<string, GameModule<any>>();

/**
 * Register a game module. Replaces any existing module with the same `gameId`.
 */
export function registerGameModule(module: GameModule<any>): void {
  registry.set(module.gameId, module);
}

/**
 * Retrieve a registered game module by its `gameId`.
 * Returns `undefined` if no module is registered with that ID.
 */
export function getGameModule(gameId: string): GameModule<any> | undefined {
  return registry.get(gameId);
}

/**
 * Get all registered game modules.
 */
export function getAllGameModules(): GameModule<any>[] {
  return Array.from(registry.values());
}

/**
 * Check whether a game module is registered.
 */
export function hasGameModule(gameId: string): boolean {
  return registry.has(gameId);
}

/**
 * Clear all registered game modules. Useful for testing.
 */
export function clearGameModuleRegistry(): void {
  registry.clear();
}
