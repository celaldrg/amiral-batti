/**
 * The fixed mid-battle position behind the ?demo query parameter (used for
 * the README screenshot). It is a real game: play can continue from it.
 * @module demo
 */
import { createGame } from './game.js';

const DEMO_SEED = 20261027;

/** @type {import('./fleet.js').Ship[]} */
const PLAYER_FLEET = [
  { id: 'flagship', size: 5, row: 1, col: 1, vertical: false },
  { id: 'frigate', size: 4, row: 3, col: 7, vertical: true },
  { id: 'corvette', size: 3, row: 5, col: 2, vertical: true },
  { id: 'gunboat', size: 3, row: 8, col: 5, vertical: false },
  { id: 'patrol', size: 2, row: 4, col: 4, vertical: false },
];

/** @type {import('./fleet.js').Ship[]} */
const ENEMY_FLEET = [
  { id: 'flagship', size: 5, row: 2, col: 2, vertical: true },
  { id: 'frigate', size: 4, row: 0, col: 5, vertical: false },
  { id: 'corvette', size: 3, row: 4, col: 5, vertical: false },
  { id: 'gunboat', size: 3, row: 8, col: 6, vertical: false },
  { id: 'patrol', size: 2, row: 9, col: 1, vertical: false },
];

/** Your shots as [row, col], oldest first: the corvette sunk, two hits on the flagship. */
const PLAYER_SHOTS = [
  [2, 7], [5, 5], [4, 6], [4, 7], [4, 5], [7, 3], [1, 0], [9, 8],
  [6, 5], [1, 8], [7, 8], [8, 3], [3, 2], [3, 3], [4, 2],
];

/** The computer's shots as [row, col], oldest first: the patrol boat sunk, two hits on the frigate. */
const ENEMY_SHOTS = [
  [6, 4], [2, 8], [4, 5], [3, 5], [4, 4], [9, 1], [0, 6], [2, 3],
  [6, 9], [8, 1], [0, 9], [9, 4], [5, 7], [5, 8], [4, 7],
];

/**
 * Builds the demo game: normal computer, no salvo, ships may not touch. Both
 * seas show misses, hits and one sunk ship, and it is your turn.
 * @returns {import('./game.js').Game}
 */
export function createDemoGame() {
  const history = PLAYER_SHOTS.flatMap(([row, col], turn) => [
    { shooter: 'player', row, col },
    { shooter: 'enemy', row: ENEMY_SHOTS[turn][0], col: ENEMY_SHOTS[turn][1] },
  ]);
  return createGame({
    seed: DEMO_SEED,
    ai: 'normal',
    salvo: false,
    touching: false,
    playerFleet: PLAYER_FLEET,
    enemyFleet: ENEMY_FLEET,
    history,
  });
}
