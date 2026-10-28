/**
 * One 10x10 sea drawn with DOM elements: water, ship hulls, shot marks,
 * splash and explosion effects, the aiming cursor and placement previews.
 * It only draws and maps pointer positions to cells; the controllers decide
 * what to show and handle the input.
 * @module board-view
 */
import { SIZE } from './fleet.js';
import { columnName } from './coords.js';
import { createHull } from './hull.js';
import { element, prefersReducedMotion } from './dom.js';

/** Cell class for each MARK value. */
const MARK_CLASSES = ['', 'is-miss', 'is-hit', 'is-sunk'];

/** Longest effect animation, delay excluded (ms). */
const EFFECT_MS = 900;

/** Ship looks that are previews: drawn on top and never animated in. */
const PREVIEW_LOOKS = new Set(['ghost', 'blocked']);

const NO_CELLS = new Set();

/**
 * A ship to draw. look: own (afloat), wreck (sunk), revealed (the computer's
 * ship shown after the game), ghost / blocked (legal / illegal preview).
 * @typedef {object} ShipDrawing
 * @property {string} id
 * @property {number} size
 * @property {number} row
 * @property {number} col
 * @property {boolean} vertical
 * @property {'own'|'wreck'|'revealed'|'ghost'|'blocked'} look
 * @property {boolean} [selected]
 * @property {boolean} [lifted] Being dragged elsewhere: drawn faded.
 */

/**
 * @typedef {object} BoardPicture
 * @property {ArrayLike<number>} marks MARK of each cell.
 * @property {ShipDrawing[]} ships
 * @property {Set<number>} [water] Cells known to hold no ship.
 * @property {number} [aim]  Aimed or cursor cell, -1 for none.
 * @property {number} [last] Latest shot on this sea, -1 for none.
 * @property {string} label Accessible name of the board.
 * @property {(index: number) => string} cellLabel Accessible name of a cell.
 */

/**
 * @typedef {object} BoardView
 * @property {HTMLElement} element The focusable board.
 * @property {(picture: BoardPicture) => void} draw
 * @property {(clientX: number, clientY: number) => number} cellAt Cell under a point, -1 outside.
 * @property {(index: number, kind: 'splash'|'blast'|'sink', delay?: number) => void} effect
 * @property {() => void} shake Brief refusal wiggle.
 */

/**
 * Builds a board inside `host`, with column letters and row numbers.
 * @param {HTMLElement} host
 * @param {string} idPrefix Makes the cell ids unique on the page.
 * @returns {BoardView}
 */
export function createBoardView(host, idPrefix) {
  const board = element('div', 'board');
  board.tabIndex = 0;
  board.setAttribute('role', 'grid');
  const shipLayer = element('div', 'board-ships');
  shipLayer.setAttribute('aria-hidden', 'true');
  const cellLayer = element('div', 'board-cells');
  const cells = buildCells(cellLayer, idPrefix);
  board.append(shipLayer, cellLayer);
  host.append(axis('cols', columnName), axis('rows', (n) => String(n + 1)), board);
  /** @type {Map<string, HTMLElement>} */
  const drawnShips = new Map();

  function draw({ marks, ships, water = NO_CELLS, aim = -1, last = -1, label, cellLabel }) {
    board.setAttribute('aria-label', label);
    cells.forEach((cell, index) => {
      setIfChanged(cell, 'class', cellClass(index, marks[index], water, aim, last));
      setIfChanged(cell, 'aria-label', cellLabel(index));
    });
    if (aim >= 0) board.setAttribute('aria-activedescendant', cells[aim].id);
    else board.removeAttribute('aria-activedescendant');
    drawShips(shipLayer, drawnShips, ships);
  }

  function cellAt(clientX, clientY) {
    const rect = board.getBoundingClientRect();
    const col = Math.floor(((clientX - rect.left) / rect.width) * SIZE);
    const row = Math.floor(((clientY - rect.top) / rect.height) * SIZE);
    return row >= 0 && row < SIZE && col >= 0 && col < SIZE ? row * SIZE + col : -1;
  }

  function effect(index, kind, delay = 0) {
    const spark = element('span', `fx fx--${kind}`);
    spark.style.animationDelay = `${delay}ms`;
    cells[index].append(spark);
    setTimeout(() => spark.remove(), EFFECT_MS + delay);
  }

  function shake() {
    if (prefersReducedMotion()) return;
    board.animate(
      [{ transform: 'none' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' }, { transform: 'none' }],
      { duration: 260, easing: 'ease-out' },
    );
  }

  return { element: board, draw, cellAt, effect, shake };
}

/**
 * Creates the 100 cells in ten rows (rows use display: contents).
 * @param {HTMLElement} layer
 * @param {string} idPrefix
 * @returns {HTMLElement[]}
 */
function buildCells(layer, idPrefix) {
  const cells = [];
  for (let row = 0; row < SIZE; row += 1) {
    const line = element('div', 'board-row');
    line.setAttribute('role', 'row');
    for (let col = 0; col < SIZE; col += 1) {
      const cell = element('div', 'cell');
      cell.id = `${idPrefix}-${row * SIZE + col}`;
      cell.setAttribute('role', 'gridcell');
      line.append(cell);
      cells.push(cell);
    }
    layer.append(line);
  }
  return cells;
}

/**
 * A strip of coordinate labels along one edge of the board.
 * @param {'cols'|'rows'} kind
 * @param {(n: number) => string} name
 * @returns {HTMLElement}
 */
function axis(kind, name) {
  const strip = element('div', `board-axis board-axis--${kind}`);
  strip.setAttribute('aria-hidden', 'true');
  for (let n = 0; n < SIZE; n += 1) strip.append(element('span', '', name(n)));
  return strip;
}

/**
 * @param {number} index
 * @param {number} mark
 * @param {Set<number>} water
 * @param {number} aim
 * @param {number} last
 * @returns {string}
 */
function cellClass(index, mark, water, aim, last) {
  const classes = ['cell'];
  if (mark) classes.push(MARK_CLASSES[mark], 'is-marked');
  else if (water.has(index)) classes.push('is-clear');
  if (index === aim) classes.push('is-aim');
  else if (aim >= 0 && sameLine(index, aim)) classes.push('is-axis');
  if (index === last) classes.push('is-last');
  return classes.join(' ');
}

/**
 * @param {number} a
 * @param {number} b
 * @returns {boolean} True when two cells share a row or a column.
 */
function sameLine(a, b) {
  return Math.floor(a / SIZE) === Math.floor(b / SIZE) || a % SIZE === b % SIZE;
}

/**
 * @param {Element} node
 * @param {string} name
 * @param {string} value
 */
function setIfChanged(node, name, value) {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

/**
 * Updates the ship layer, reusing the drawing of a ship whose position and
 * look did not change, so only new or moved ships animate in.
 * @param {HTMLElement} layer
 * @param {Map<string, HTMLElement>} drawn
 * @param {ShipDrawing[]} ships
 */
function drawShips(layer, drawn, ships) {
  const keep = new Set();
  for (const ship of ships) {
    const key = [ship.id, ship.row, ship.col, ship.vertical ? 'v' : 'h', ship.look].join(':');
    let node = drawn.get(key);
    if (!node) {
      node = shipNode(ship);
      drawn.set(key, node);
      layer.append(node);
    }
    node.classList.toggle('is-selected', Boolean(ship.selected));
    node.classList.toggle('is-lifted', Boolean(ship.lifted));
    keep.add(key);
  }
  for (const [key, node] of drawn) {
    if (!keep.has(key)) {
      node.remove();
      drawn.delete(key);
    }
  }
}

/**
 * @param {ShipDrawing} ship
 * @returns {HTMLElement}
 */
function shipNode(ship) {
  const node = element('div', `ship ship--${ship.look}`);
  if (!PREVIEW_LOOKS.has(ship.look)) node.classList.add('is-new');
  const rows = ship.vertical ? ship.size : 1;
  const cols = ship.vertical ? 1 : ship.size;
  node.style.gridArea = `${ship.row + 1} / ${ship.col + 1} / span ${rows} / span ${cols}`;
  node.append(createHull(ship.size, ship.vertical));
  return node;
}
