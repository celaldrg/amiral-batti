/**
 * Pure helpers around a game in progress: the saved form that lets a battle
 * survive a page reload, shot statistics, the win/loss record and the water
 * the player can rule out around sunk ships.
 * @module session
 */
import { createGame, normalizeSettings } from './game.js';
import { haloCells, shipCells } from './fleet.js';
import { MARK } from './board.js';

/** Version of the saved-game format; other versions are ignored. */
const SAVE_VERSION = 1;

/**
 * Everything needed to rebuild a battle. The computer's fleet comes back
 * from the seed, so it is not stored.
 * @typedef {object} SavedGame
 * @property {number} version
 * @property {number} seed
 * @property {import('./game.js').Settings} settings
 * @property {import('./fleet.js').Ship[]} fleet Your ships.
 * @property {import('./game.js').ShotOrder[]} history Every shot, oldest first.
 */

/**
 * @param {unknown} value
 * @returns {boolean} True for a uint32, the seeds createGame uses.
 */
function isSeed(value) {
  return Number.isInteger(value) && value >= 0 && value < 2 ** 32;
}

/**
 * Turns a battle into plain data that can be saved as JSON.
 * @param {number} seed The seed the game was created with.
 * @param {import('./game.js').GameState} state A state in the battle phase.
 * @returns {SavedGame}
 */
export function toSaved(seed, state) {
  return {
    version: SAVE_VERSION,
    seed,
    settings: { ...state.settings },
    fleet: state.player.ships.map(({ id, size, row, col, vertical }) => ({ id, size, row, col, vertical })),
    history: state.log.map(({ shooter, row, col }) => ({ shooter, row, col })),
  };
}

/**
 * Rebuilds a saved battle. Data that is damaged, from another version or
 * describes a finished game gives null instead of throwing.
 * @param {unknown} data
 * @returns {{ game: import('./game.js').Game, seed: number } | null}
 */
export function fromSaved(data) {
  if (typeof data !== 'object' || data === null) return null;
  const { version, seed, settings, fleet, history } = /** @type {Partial<SavedGame>} */ (data);
  if (version !== SAVE_VERSION || !isSeed(seed) || !Array.isArray(fleet) || !Array.isArray(history)) return null;
  try {
    const game = createGame({ ...normalizeSettings(settings), seed, playerFleet: fleet, history });
    return game.getState().phase === 'battle' ? { game, seed } : null;
  } catch {
    return null;
  }
}

/**
 * Shots fired by one side and how many of them found a ship.
 * @param {readonly import('./game.js').LogEntry[]} log
 * @param {import('./game.js').Side} shooter
 * @returns {{ shots: number, hits: number, accuracy: number }} accuracy in whole percent.
 */
export function shotStats(log, shooter) {
  const fired = log.filter((entry) => entry.shooter === shooter);
  const hits = fired.filter((entry) => entry.result !== 'miss').length;
  const accuracy = fired.length === 0 ? 0 : Math.round((hits / fired.length) * 100);
  return { shots: fired.length, hits, accuracy };
}

/**
 * A win/loss record read back from storage, repaired when damaged.
 * @param {unknown} value
 * @returns {{ wins: number, losses: number }}
 */
export function normalizeRecord(value) {
  const source = typeof value === 'object' && value !== null ? value : {};
  const count = (n) => (Number.isInteger(n) && n >= 0 ? n : 0);
  return { wins: count(source.wins), losses: count(source.losses) };
}

/**
 * Untried cells next to a sunk ship. When ships may not touch, no ship can
 * be there, so the interface shades them as clear water.
 * @param {import('./game.js').SeaState} sea
 * @param {boolean} touching The touching setting of the game.
 * @returns {Set<number>}
 */
export function knownWater(sea, touching) {
  const water = new Set();
  if (touching) return water;
  for (const ship of sea.ships) {
    if (!ship.sunk || !Number.isInteger(ship.row)) continue;
    for (const cell of haloCells(shipCells(/** @type {import('./fleet.js').Ship} */ (ship)))) {
      if (sea.marks[cell] === MARK.NONE) water.add(cell);
    }
  }
  return water;
}
