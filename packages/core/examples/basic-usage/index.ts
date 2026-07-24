import {
  PlayprintTracker,
  createGhost,
  mapGhostBiases,
  getArchetype,
} from '@playprint/core';

async function main() {
  const tracker = new PlayprintTracker({
    gameId: 'my_card_game',
    accountId: 'player_42',
  });

  // --- Match 1: Aggressive win ---
  tracker.startMatch();
  tracker.decision({ label: 'attack' });
  tracker.outcome({ type: 'hit', delta: 0.3 });
  tracker.decision({ label: 'rush' });
  tracker.outcome({ type: 'hit', delta: 0.5 });
  tracker.decision({ label: 'gamble' });
  tracker.outcome({ type: 'crit', delta: 0.8 });
  await tracker.endMatch('win');

  // --- Match 2: Defensive loss ---
  tracker.startMatch();
  tracker.decision({ label: 'defend' });
  tracker.outcome({ type: 'block', delta: -0.1 });
  tracker.decision({ label: 'heal' });
  tracker.outcome({ type: 'recovered', delta: 0.1 });
  tracker.decision({ label: 'retreat' });
  tracker.outcome({ type: 'escape', delta: -0.3 });
  await tracker.endMatch('loss');

  // --- Match 3: Mixed strategy win ---
  tracker.startMatch();
  tracker.decision({ label: 'build' });
  tracker.outcome({ type: 'setup', delta: 0.1 });
  tracker.decision({ label: 'bluff', risk: 0.9, information: 0.3 }); // Tier 2
  tracker.outcome({ type: 'fooled', delta: 0.6 });
  tracker.decision({ label: 'attack' });
  tracker.outcome({ type: 'hit', delta: 0.4 });
  const profile = await tracker.endMatch('win');

  console.log('\n=== Playprint Profile ===');
  console.log(`  Aggression:     ${profile.aggression.toFixed(3)}`);
  console.log(`  Std Dev:        ${profile.aggressionStdDev.toFixed(3)}`);
  console.log(`  Info Pref:      ${profile.informationPreference.toFixed(3)}`);
  console.log(`  Tempo (E/M/L):  ${profile.tempoEarly.toFixed(2)} / ${profile.tempoMid.toFixed(2)} / ${profile.tempoLate.toFixed(2)}`);
  console.log(`  Bluff Rate:     ${profile.bluffRate.toFixed(3)}`);
  console.log(`  Comeback Rate:  ${profile.comebackRate.toFixed(3)}`);
  console.log(`  Decisions:      ${profile.totalDecisions}`);
  console.log(`  Matches:        ${profile.totalMatches}`);

  const ghost = createGhost(profile);
  console.log('\n=== Ghost Biases ===');
  console.log(`  Aggression:     ${ghost.aggression.toFixed(3)}`);
  console.log(`  Patience:       ${ghost.patience.toFixed(3)}`);
  console.log(`  Risk Tolerance: ${ghost.riskTolerance.toFixed(3)}`);
  console.log(`  Consistency:   ${ghost.consistency.toFixed(3)}`);
  console.log(`  Deception:      ${ghost.deception.toFixed(3)}`);

  // Map ghost biases → game-specific AI parameters
  const aiParams = mapGhostBiases(ghost, {
    attackFrequency:   { bias: 'aggression', range: [0.1, 0.9] },
    retreatThreshold:  { bias: 'patience', range: [0.2, 0.8] },
    bluffChance:       { bias: 'deception', range: [0, 0.3] },
    reactionTime:      { bias: 'consistency', range: [200, 800] },
    riskThreshold:     { bias: 'riskTolerance', range: [0.3, 0.9] },
  });

  console.log('\n=== AI Parameters (from ghost mapping) ===');
  console.log(`  Attack Freq:     ${aiParams.attackFrequency.toFixed(3)}`);
  console.log(`  Retreat At:      ${aiParams.retreatThreshold.toFixed(3)}`);
  console.log(`  Bluff Chance:    ${aiParams.bluffChance.toFixed(3)}`);
  console.log(`  Reaction Time:   ${aiParams.reactionTime.toFixed(0)}ms`);
  console.log(`  Risk Threshold:  ${aiParams.riskThreshold.toFixed(3)}`);

  const archetype = getArchetype(profile);
  console.log('\n=== Archetype ===');
  console.log(`  ${archetype.name}${archetype.modifier ? ` ${archetype.modifier}` : ''}`);
}

main().catch(console.error);
