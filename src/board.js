/**
 * One side's sea: its fleet and the shots it has received.
 * @module board
 */
import { SIZE, shipCells } from './fleet.js';

/** What a cell shows: not fired at, water, a hit, or part of a sunk ship. */
export const MARK = Object.freeze({ NONE: 0, MISS: 1, HIT: 2, SUNK: 3 });

/** @typedef {'miss'|'hit'|'sunk'} ShotResult */

/**
 * @typedef {object} Board
 * @property {import('./fleet.js').Ship[]} ships
 * @property {Int8Array} owner  Number of the ship on each cell, -1 for water.
 * @property {Uint8Array} marks MARK of each cell.
 * @property {number[]} hits    Hits taken by each ship.
 */

/**
 * What a shooter knows about a sea: the marks of its cells and the sizes of
 * the ships still afloat (sinking a ship is announced, its position is not).
 * @typedef {object} SeaView
 * @property {ArrayLike<number>} marks Read-only.
 * @property {number[]} remaining
 */

/**
 * Creates a sea holding a (valid) fleet. The ships are copied.
 * @param {readonly import('./fleet.js').Ship[]} ships
 * @returns {Board}
 */
export function createBoard(ships) {
  const owner = new Int8Array(SIZE * SIZE).fill(-1);
  ships.forEach((ship, n) => {
    for (const cell of shipCells(ship)) owner[cell] = n;
  });
  return {
    ships: ships.map((ship) => ({ ...ship })),
    owner,
    marks: new Uint8Array(SIZE * SIZE),
    hits: ships.map(() => 0),
  };
}

/**
 * Fires at a cell that has not been fired at yet. When the shot completes a
 * ship, every cell of that ship turns from HIT to SUNK.
 * @param {Board} board
 * @param {number} index
 * @returns {{ result: ShotResult, shipId: string|null }}
 * @throws {RangeError} When the cell is off the sea or was fired at before.
 */
export function fireAt(board, index) {
  if (!Number.isInteger(index) || index < 0 || index >= SIZE * SIZE) {
    throw new RangeError(`No such cell: ${index}`);
  }
  if (board.marks[index] !== MARK.NONE) throw new RangeError(`Cell ${index} was already fired at`);
  const n = board.owner[index];
  if (n < 0) {
    board.marks[index] = MARK.MISS;
    return { result: 'miss', shipId: null };
  }
  const ship = board.ships[n];
  board.hits[n] += 1;
  if (board.hits[n] < ship.size) {
    board.marks[index] = MARK.HIT;
    return { result: 'hit', shipId: ship.id };
  }
  for (const cell of shipCells(ship)) board.marks[cell] = MARK.SUNK;
  return { result: 'sunk', shipId: ship.id };
}

/**
 * @param {Board} board
 * @returns {import('./fleet.js').Ship[]} Ships not sunk yet.
 */
function afloatShips(board) {
  return board.ships.filter((ship, n) => board.hits[n] < ship.size);
}

/**
 * @param {Board} board
 * @returns {number} Number of ships not sunk yet.
 */
export function afloatCount(board) {
  return afloatShips(board).length;
}

/**
 * @param {Board} board
 * @returns {boolean} True when the whole fleet is sunk.
 */
export function isDefeated(board) {
  return afloatCount(board) === 0;
}

/**
 * The shooter's view of a sea, without ship positions.
 * @param {Board} board
 * @returns {SeaView}
 */
export function viewOf(board) {
  return { marks: board.marks, remaining: afloatShips(board).map((ship) => ship.size) };
}
