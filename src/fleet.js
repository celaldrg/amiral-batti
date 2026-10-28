/**
 * The fleet, ship geometry and placement rules on the 10x10 sea.
 * Cells are numbered row by row: index = row * SIZE + col.
 * @module fleet
 */
import { shuffle } from './rng.js';

/** Rows and columns of each sea. */
export const SIZE = 10;

/**
 * @typedef {object} ShipType
 * @property {string} id   Stable identifier; the UI turns it into a name.
 * @property {number} size Number of cells.
 */

/**
 * A ship on the sea. (row, col) is its bow: the left cell of a horizontal
 * ship or the top cell of a vertical one.
 * @typedef {object} Ship
 * @property {string} id
 * @property {number} size
 * @property {number} row
 * @property {number} col
 * @property {boolean} vertical
 */

/**
 * Why a ship cannot go somewhere: off the sea, on another ship, or touching
 * another ship while that is not allowed.
 * @typedef {'bounds'|'overlap'|'touch'} PlacementError
 */

/**
 * One position a ship of some length can take on an empty sea.
 * @typedef {object} Placement
 * @property {number} row
 * @property {number} col
 * @property {boolean} vertical
 * @property {readonly number[]} cells Cells it covers.
 * @property {readonly number[]} halo  Cells touching it by a side or a corner.
 */

/**
 * The fleet of each side: five ships, 17 cells.
 * @type {readonly ShipType[]}
 */
export const FLEET = Object.freeze([
  Object.freeze({ id: 'flagship', size: 5 }),
  Object.freeze({ id: 'frigate', size: 4 }),
  Object.freeze({ id: 'corvette', size: 3 }),
  Object.freeze({ id: 'gunboat', size: 3 }),
  Object.freeze({ id: 'patrol', size: 2 }),
]);

/**
 * @param {number} row
 * @param {number} col
 * @returns {number} Cell index.
 */
export function toIndex(row, col) {
  return row * SIZE + col;
}

/**
 * @param {number} index Cell index.
 * @returns {{ row: number, col: number }}
 */
export function toCell(index) {
  return { row: Math.floor(index / SIZE), col: index % SIZE };
}

/**
 * True when (row, col) are integers that address a cell of the sea.
 * @param {number} row
 * @param {number} col
 * @returns {boolean}
 */
export function isOnSea(row, col) {
  return Number.isInteger(row) && Number.isInteger(col)
    && row >= 0 && row < SIZE && col >= 0 && col < SIZE;
}

/**
 * Cells next to a cell that lie on the sea.
 * @param {number} index
 * @param {boolean} [diagonal=false] Also include the four corner neighbours.
 * @returns {number[]}
 */
export function neighbors(index, diagonal = false) {
  const { row, col } = toCell(index);
  const result = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      const isSelf = dr === 0 && dc === 0;
      const isCorner = dr !== 0 && dc !== 0;
      if (!isSelf && (diagonal || !isCorner) && isOnSea(row + dr, col + dc)) {
        result.push(toIndex(row + dr, col + dc));
      }
    }
  }
  return result;
}

/**
 * Cells covered by a ship, bow first. The ship must lie on the sea.
 * @param {{ size: number, row: number, col: number, vertical: boolean }} ship
 * @returns {number[]}
 */
export function shipCells(ship) {
  const start = toIndex(ship.row, ship.col);
  const step = ship.vertical ? SIZE : 1;
  return Array.from({ length: ship.size }, (_, k) => start + k * step);
}

/**
 * Cells that touch a group of cells by a side or a corner, excluding the group.
 * Around a sunk ship these are certainly water when ships may not touch.
 * @param {readonly number[]} cells
 * @returns {number[]}
 */
export function haloCells(cells) {
  const group = new Set(cells);
  const halo = new Set();
  for (const cell of cells) {
    for (const next of neighbors(cell, true)) {
      if (!group.has(next)) halo.add(next);
    }
  }
  return [...halo];
}

/**
 * @param {Ship} ship
 * @returns {boolean} True when every cell of the ship lies on the sea.
 */
function fitsOnSea(ship) {
  const endRow = ship.vertical ? ship.row + ship.size - 1 : ship.row;
  const endCol = ship.vertical ? ship.col : ship.col + ship.size - 1;
  return isOnSea(ship.row, ship.col) && isOnSea(endRow, endCol);
}

/**
 * Checks whether a ship may join the ships already on the sea.
 * @param {readonly Ship[]} ships Ships already placed.
 * @param {Ship} ship The candidate.
 * @param {{ touching?: boolean }} [rules] touching: ships may touch each other.
 * @returns {PlacementError|null} Null when the placement is legal.
 */
export function checkPlacement(ships, ship, { touching = false } = {}) {
  if (!fitsOnSea(ship)) return 'bounds';
  const taken = new Set(ships.flatMap((other) => shipCells(other)));
  const cells = shipCells(ship);
  if (cells.some((cell) => taken.has(cell))) return 'overlap';
  if (!touching && haloCells(cells).some((cell) => taken.has(cell))) return 'touch';
  return null;
}

/**
 * Validates a whole fleet: exactly the ships of FLEET, each placed legally.
 * @param {readonly Ship[]} ships
 * @param {{ touching?: boolean }} [rules]
 * @returns {{ ok: boolean, reason?: PlacementError|'composition', id?: string }}
 */
export function validateFleet(ships, rules = {}) {
  const complete = ships.length === FLEET.length && FLEET.every((type) => (
    ships.filter((ship) => ship.id === type.id && ship.size === type.size).length === 1
  ));
  if (!complete) return { ok: false, reason: 'composition' };
  for (let n = 0; n < ships.length; n += 1) {
    const reason = checkPlacement(ships.slice(0, n), ships[n], rules);
    if (reason) return { ok: false, reason, id: ships[n].id };
  }
  return { ok: true };
}

/** @type {Map<number, readonly Placement[]>} */
const placementCache = new Map();

/**
 * Every position a ship of the given length can take on an empty sea.
 * The result is cached and frozen.
 * @param {number} length
 * @returns {readonly Placement[]}
 */
export function allPlacements(length) {
  if (!placementCache.has(length)) placementCache.set(length, buildPlacements(length));
  return placementCache.get(length);
}

/**
 * @param {number} length
 * @returns {readonly Placement[]}
 */
function buildPlacements(length) {
  const result = [];
  for (const vertical of [false, true]) {
    const lastRow = vertical ? SIZE - length : SIZE - 1;
    const lastCol = vertical ? SIZE - 1 : SIZE - length;
    for (let row = 0; row <= lastRow; row += 1) {
      for (let col = 0; col <= lastCol; col += 1) {
        const cells = Object.freeze(shipCells({ size: length, row, col, vertical }));
        const halo = Object.freeze(haloCells(cells));
        result.push(Object.freeze({ row, col, vertical, cells, halo }));
      }
    }
  }
  return Object.freeze(result);
}

/**
 * Places the whole fleet at random. Backtracks over shuffled positions, so it
 * always finds a legal layout when one exists (one always does for FLEET).
 * @param {import('./rng.js').Rng} rng
 * @param {{ touching?: boolean }} [rules]
 * @returns {Ship[]} Ships in FLEET order.
 */
export function randomFleet(rng, rules = {}) {
  const biggestFirst = [...FLEET].sort((a, b) => b.size - a.size);
  const ships = placeRest(biggestFirst, [], rng, rules);
  if (!ships) throw new Error('The fleet does not fit on the sea');
  return FLEET.map((type) => ships.find((ship) => ship.id === type.id));
}

/**
 * Depth-first search: places the first type, then recurses on the rest.
 * @param {readonly ShipType[]} types Ship types still to place.
 * @param {Ship[]} placed
 * @param {import('./rng.js').Rng} rng
 * @param {{ touching?: boolean }} rules
 * @returns {Ship[]|null}
 */
function placeRest(types, placed, rng, rules) {
  if (types.length === 0) return placed;
  const [type, ...rest] = types;
  for (const spot of shuffle(rng, [...allPlacements(type.size)])) {
    const ship = { id: type.id, size: type.size, row: spot.row, col: spot.col, vertical: spot.vertical };
    if (checkPlacement(placed, ship, rules) === null) {
      const done = placeRest(rest, [...placed, ship], rng, rules);
      if (done) return done;
    }
  }
  return null;
}
