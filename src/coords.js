/**
 * Board geometry used by the interface: cell names, cursor movement and
 * where a ship goes when the player points at a cell. Pure functions.
 * @module coords
 */
import { SIZE, shipCells, toCell, toIndex } from './fleet.js';

const LETTERS = 'ABCDEFGHIJ';

/** Row and column steps of the arrow keys. */
const ARROW_STEPS = Object.freeze({
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
});

/**
 * @param {number} value
 * @param {number} low
 * @param {number} high
 * @returns {number}
 */
function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/**
 * Letter of a column, A to J from left to right.
 * @param {number} col
 * @returns {string}
 */
export function columnName(col) {
  return LETTERS[col];
}

/**
 * Usual name of a cell: column letter then row number, so index 42 is "C5".
 * @param {number} index
 * @returns {string}
 */
export function cellName(index) {
  const { row, col } = toCell(index);
  return `${columnName(col)}${row + 1}`;
}

/**
 * @param {string} key A KeyboardEvent key.
 * @returns {boolean} True for the four arrow keys.
 */
export function isArrowKey(key) {
  return Object.hasOwn(ARROW_STEPS, key);
}

/**
 * Moves a cursor one cell in the direction of an arrow key, stopping at the
 * edge of the sea. Other keys leave it where it is.
 * @param {number} index
 * @param {string} key
 * @returns {number}
 */
export function stepCursor(index, key) {
  if (!isArrowKey(key)) return index;
  const [dRow, dCol] = ARROW_STEPS[key];
  const { row, col } = toCell(index);
  return toIndex(clamp(row + dRow, 0, SIZE - 1), clamp(col + dCol, 0, SIZE - 1));
}

/**
 * The segment a tap or the keyboard cursor holds a ship by: its middle
 * (the front one of the two middles for even sizes).
 * @param {number} size
 * @returns {number} Offset from the bow.
 */
export function middleOf(size) {
  return Math.floor((size - 1) / 2);
}

/**
 * Where the bow goes so that segment `anchor` of the ship covers a cell,
 * pulled back onto the sea when the ship would stick out.
 * @param {number} size
 * @param {boolean} vertical
 * @param {number} index Cell the anchor segment should cover.
 * @param {number} anchor Offset from the bow, 0 to size - 1.
 * @returns {{ row: number, col: number }}
 */
export function bowFor(size, vertical, index, anchor) {
  const { row, col } = toCell(index);
  const last = SIZE - size;
  return vertical
    ? { row: clamp(row - anchor, 0, last), col }
    : { row, col: clamp(col - anchor, 0, last) };
}

/**
 * Offset of a cell within a ship, counted from the bow.
 * @param {{ row: number, col: number, vertical: boolean }} ship
 * @param {number} index A cell of the ship.
 * @returns {number}
 */
export function segmentAt(ship, index) {
  const { row, col } = toCell(index);
  return ship.vertical ? row - ship.row : col - ship.col;
}

/**
 * The ship covering a cell, if any.
 * @template {{ size: number, row: number, col: number, vertical: boolean }} S
 * @param {readonly S[]} ships Ships with a position.
 * @param {number} index
 * @returns {S|null}
 */
export function shipAt(ships, index) {
  return ships.find((ship) => shipCells(ship).includes(index)) ?? null;
}
