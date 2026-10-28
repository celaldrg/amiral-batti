/**
 * Computer opponents. Each level chooses the next cell from a SeaView (marks
 * plus sizes of the ships still afloat) and only ever picks untried cells.
 *   easy   - any untried cell at random.
 *   normal - hunt/target: random open water until a hit, then the hit's
 *            neighbours, then along the line of hits.
 *   hard   - probability density over every position the remaining ships
 *            can still take.
 * @module ai
 */
import { SIZE, allPlacements, neighbors, toCell, toIndex } from './fleet.js';
import { MARK } from './board.js';
import { pick } from './rng.js';

/** Difficulty levels, weakest first. */
export const AI_LEVELS = Object.freeze(['easy', 'normal', 'hard']);

/** Hard level: how much more a position counts for each unresolved hit it explains. */
const HIT_WEIGHT = 20;

/** Every cell index, in board order. */
const CELLS = Object.freeze(Array.from({ length: SIZE * SIZE }, (_, i) => i));

/**
 * @typedef {import('./board.js').SeaView} SeaView
 * @typedef {import('./rng.js').Rng} Rng
 */

/**
 * @typedef {object} Ai
 * @property {(view: SeaView) => number} nextShot Index of an untried cell to
 *   fire at. The sea must still have a ship afloat.
 */

/**
 * Creates a computer opponent.
 * @param {'easy'|'normal'|'hard'} level
 * @param {Rng} rng Breaks ties and drives random choices.
 * @param {{ touching?: boolean }} [rules] When ships may not touch, the
 *   cells around a sunk ship are known to be water.
 * @returns {Ai}
 */
export function createAi(level, rng, { touching = false } = {}) {
  const strategy = STRATEGIES.get(level);
  if (!strategy) throw new RangeError(`Unknown AI level: ${level}`);
  return { nextShot: (view) => strategy(view, rng, touching) };
}

/**
 * @param {SeaView} view
 * @param {Rng} rng
 * @returns {number}
 */
function easyShot(view, rng) {
  return pick(rng, CELLS.filter((cell) => view.marks[cell] === MARK.NONE));
}

/**
 * @param {SeaView} view
 * @param {Rng} rng
 * @param {boolean} touching
 * @returns {number}
 */
function normalShot(view, rng, touching) {
  const open = openCells(view.marks, touching);
  const targets = targetCells(view.marks, open);
  return pick(rng, targets.length > 0 ? targets : CELLS.filter((cell) => open[cell]));
}

/**
 * @param {SeaView} view
 * @param {Rng} rng
 * @param {boolean} touching
 * @returns {number}
 */
function hardShot(view, rng, touching) {
  const { marks, remaining } = view;
  const open = openCells(marks, touching);
  const targeting = CELLS.some((cell) => marks[cell] === MARK.HIT);
  const density = new Float64Array(SIZE * SIZE);
  for (const [length, count] of tally(remaining)) {
    for (const spot of allPlacements(length)) {
      const weight = count * placementWeight(spot, marks, open, touching, targeting);
      if (weight === 0) continue;
      for (const cell of spot.cells) {
        if (marks[cell] === MARK.NONE) density[cell] += weight;
      }
    }
  }
  return pick(rng, bestCells(density));
}

/** @type {Map<string, (view: SeaView, rng: Rng, touching: boolean) => number>} */
const STRATEGIES = new Map([
  ['easy', easyShot],
  ['normal', normalShot],
  ['hard', hardShot],
]);

/**
 * Flags the untried cells that may still hide a ship: with the no-touch rule
 * the cells around sunk ships are water.
 * @param {ArrayLike<number>} marks
 * @param {boolean} touching
 * @returns {Uint8Array} 1 for open cells.
 */
function openCells(marks, touching) {
  const open = new Uint8Array(SIZE * SIZE);
  for (const cell of CELLS) open[cell] = marks[cell] === MARK.NONE ? 1 : 0;
  if (!touching) {
    for (const cell of CELLS) {
      if (marks[cell] !== MARK.SUNK) continue;
      for (const next of neighbors(cell, true)) open[next] = 0;
    }
  }
  return open;
}

/**
 * Cells worth firing at to finish a damaged ship: the open ends of a straight
 * line of hits, otherwise the open neighbours of the hits.
 * @param {ArrayLike<number>} marks
 * @param {Uint8Array} open
 * @returns {number[]}
 */
function targetCells(marks, open) {
  for (const group of hitGroups(marks)) {
    const ends = lineEnds(group).filter((cell) => open[cell]);
    if (ends.length > 0) return ends;
    const around = [...new Set(group.flatMap((cell) => neighbors(cell)))].filter((cell) => open[cell]);
    if (around.length > 0) return around;
  }
  return [];
}

/**
 * Unresolved hits split into side-by-side groups, in board order.
 * @param {ArrayLike<number>} marks
 * @returns {number[][]}
 */
function hitGroups(marks) {
  const seen = new Uint8Array(SIZE * SIZE);
  const groups = [];
  for (const start of CELLS) {
    if (marks[start] !== MARK.HIT || seen[start]) continue;
    const group = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const cell = stack.pop();
      group.push(cell);
      for (const next of neighbors(cell)) {
        if (marks[next] === MARK.HIT && !seen[next]) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

/**
 * The two cells that extend a straight line of two or more hits.
 * @param {number[]} group Side-by-side hits.
 * @returns {number[]} Empty for a single hit or a bent group.
 */
function lineEnds(group) {
  if (group.length < 2) return [];
  const cells = group.map(toCell);
  const { row, col } = cells[0];
  const horizontal = cells.every((cell) => cell.row === row);
  const vertical = cells.every((cell) => cell.col === col);
  if (!horizontal && !vertical) return [];
  const steps = cells.map((cell) => (horizontal ? cell.col : cell.row));
  return [Math.min(...steps) - 1, Math.max(...steps) + 1]
    .filter((step) => step >= 0 && step < SIZE)
    .map((step) => (horizontal ? toIndex(row, step) : toIndex(step, col)));
}

/**
 * How many times each ship size is still afloat.
 * @param {number[]} sizes
 * @returns {Map<number, number>}
 */
function tally(sizes) {
  const counts = new Map();
  for (const size of sizes) counts.set(size, (counts.get(size) ?? 0) + 1);
  return counts;
}

/**
 * Weight of one possible ship position (0 when impossible). While unresolved
 * hits exist only positions through them count, more so the more they cover.
 * @param {import('./fleet.js').Placement} spot
 * @param {ArrayLike<number>} marks
 * @param {Uint8Array} open
 * @param {boolean} touching
 * @param {boolean} targeting
 * @returns {number}
 */
function placementWeight(spot, marks, open, touching, targeting) {
  let hits = 0;
  for (const cell of spot.cells) {
    if (marks[cell] === MARK.HIT) hits += 1;
    else if (!open[cell]) return 0;
  }
  if (targeting && hits === 0) return 0;
  // A hit right next to the position belongs to another ship, which would touch it.
  if (!touching && spot.halo.some((cell) => marks[cell] === MARK.HIT)) return 0;
  return HIT_WEIGHT ** hits;
}

/**
 * @param {Float64Array} density
 * @returns {number[]} Cells sharing the highest positive density.
 */
function bestCells(density) {
  let best = 0;
  let cells = [];
  for (const cell of CELLS) {
    if (density[cell] > best) {
      best = density[cell];
      cells = [cell];
    } else if (best > 0 && density[cell] === best) {
      cells.push(cell);
    }
  }
  return cells;
}
