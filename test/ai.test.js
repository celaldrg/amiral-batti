import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AI_LEVELS, createAi } from '../src/ai.js';
import { MARK, createBoard, fireAt, isDefeated, viewOf } from '../src/board.js';
import { neighbors, randomFleet, toIndex } from '../src/fleet.js';
import { createRng, deriveSeed } from '../src/rng.js';

const GAMES = 300;
const FULL_FLEET = [5, 4, 3, 3, 2];

/**
 * Lets one AI shoot at a seeded random fleet until it is sunk.
 * Fails if the AI ever names a cell off the sea or a cell it already tried.
 * @returns {number} Shots needed.
 */
function playOut(level, game, touching, onShot = () => {}) {
  const board = createBoard(randomFleet(createRng(deriveSeed(game, 11)), { touching }));
  const ai = createAi(level, createRng(deriveSeed(game, 22)), { touching });
  const fired = new Set();
  while (!isDefeated(board)) {
    const cell = ai.nextShot(viewOf(board));
    assert.ok(Number.isInteger(cell) && cell >= 0 && cell < 100, `${level} named cell ${cell}`);
    assert.ok(!fired.has(cell), `${level} fired twice at cell ${cell} in game ${game}`);
    onShot(cell, board.marks);
    fired.add(cell);
    fireAt(board, cell);
  }
  return fired.size;
}

function averageShots(level, touching) {
  let total = 0;
  for (let game = 0; game < GAMES; game += 1) total += playOut(level, game, touching);
  return total / GAMES;
}

function compareLevels(t, touching) {
  const average = Object.fromEntries(AI_LEVELS.map((level) => [level, averageShots(level, touching)]));
  const report = `average shots to sink the fleet over ${GAMES} seeded games (touching ${touching ? 'allowed' : 'not allowed'}): `
    + `hard=${average.hard.toFixed(2)}, normal=${average.normal.toFixed(2)}, easy=${average.easy.toFixed(2)}`;
  t.diagnostic(report);
  assert.ok(average.hard < average.normal, report);
  assert.ok(average.normal < average.easy, report);
}

/** A view with the given marks (cells as [row, col]) on an otherwise untried sea. */
function viewWith(marked, remaining = FULL_FLEET) {
  const marks = new Uint8Array(100);
  for (const [mark, cells] of Object.entries(marked)) {
    for (const [row, col] of cells) marks[toIndex(row, col)] = MARK[mark];
  }
  return { marks, remaining };
}

/** Every shot a level takes on a view, over several seeds. */
function shotsOn(level, view, touching = false) {
  return new Set(Array.from({ length: 25 }, (_, seed) => createAi(level, createRng(seed), { touching }).nextShot(view)));
}

const cellSet = (cells) => new Set(cells.map(([row, col]) => toIndex(row, col)));

describe('AI', () => {
  it('offers three levels and rejects unknown ones', () => {
    assert.deepEqual(AI_LEVELS, ['easy', 'normal', 'hard']);
    for (const level of ['expert', 'constructor', '']) {
      assert.throws(() => createAi(level, createRng(1)), RangeError);
    }
  });

  it('no level ever fires at the same cell twice (both touching rules)', () => {
    for (const touching of [false, true]) {
      for (const level of AI_LEVELS) {
        for (let game = 0; game < 100; game += 1) {
          assert.ok(playOut(level, game, touching) <= 100);
        }
      }
    }
  });

  it('is deterministic for a seed', () => {
    for (const level of AI_LEVELS) {
      assert.equal(playOut(level, 7, false), playOut(level, 7, false));
    }
  });

  it('strength order: hard < normal < easy in average shots over 300 seeded games', (t) => {
    compareLevels(t, false);
  });

  it('keeps the same order when ships may touch', (t) => {
    compareLevels(t, true);
  });

  it('normal: tries the neighbours of a lone hit', () => {
    assert.deepEqual(shotsOn('normal', viewWith({ HIT: [[0, 0]] })), cellSet([[0, 1], [1, 0]]));
    const middle = shotsOn('normal', viewWith({ HIT: [[5, 5]] }));
    assert.ok([...middle].every((cell) => cellSet([[4, 5], [6, 5], [5, 4], [5, 6]]).has(cell)));
  });

  it('normal: follows a line of hits, and turns around at a miss', () => {
    assert.deepEqual(shotsOn('normal', viewWith({ HIT: [[5, 4], [5, 5]] })), cellSet([[5, 3], [5, 6]]));
    assert.deepEqual(shotsOn('normal', viewWith({ HIT: [[3, 8], [4, 8]] })), cellSet([[2, 8], [5, 8]]));
    assert.deepEqual(
      shotsOn('normal', viewWith({ HIT: [[5, 4], [5, 5]], MISS: [[5, 6]] })),
      cellSet([[5, 3]]),
    );
  });

  it('hard: finishes a damaged ship before hunting', () => {
    assert.ok([...shotsOn('hard', viewWith({ HIT: [[4, 4]] }))]
      .every((cell) => cellSet([[3, 4], [5, 4], [4, 3], [4, 5]]).has(cell)));
    assert.deepEqual(shotsOn('hard', viewWith({ HIT: [[4, 4], [4, 5]] })), cellSet([[4, 3], [4, 6]]));
    // Only the patrol boat at (0,0)-(0,1) explains this hit: finish it rather than hunt the open sea.
    assert.deepEqual(shotsOn('hard', viewWith({ HIT: [[0, 0]], MISS: [[1, 0], [0, 2]] })), cellSet([[0, 1]]));
  });

  it('hard: never extends a line into a cell that would make two damaged ships touch', () => {
    // (4,4) would continue the line (4,5)-(4,6), but it touches the hit at (3,3) by a corner.
    const view = viewWith({ HIT: [[3, 3], [4, 5], [4, 6]], MISS: [[4, 8]] });
    assert.deepEqual(shotsOn('hard', view), cellSet([[4, 7]]));
    assert.deepEqual(shotsOn('hard', view, true), cellSet([[4, 4]]), 'fine when ships may touch');
  });

  it('hard: only aims where a remaining ship still fits', () => {
    // Everything is water except a 3-cell strip at the top left and one isolated cell.
    const open = cellSet([[0, 0], [0, 1], [0, 2], [5, 5]]);
    const marks = new Uint8Array(100).map((_, cell) => (open.has(cell) ? MARK.NONE : MARK.MISS));
    assert.deepEqual(shotsOn('hard', { marks, remaining: [2] }), cellSet([[0, 1]]));
  });

  it('normal and hard never fire into water known to be empty when ships may not touch', () => {
    for (const level of ['normal', 'hard']) {
      for (let game = 0; game < 100; game += 1) {
        playOut(level, game, false, (cell, marks) => {
          const nextToSunk = neighbors(cell, true).some((other) => marks[other] === MARK.SUNK);
          assert.ok(!nextToSunk, `${level} fired next to a sunk ship (game ${game})`);
          if (level === 'hard') {
            const cornerHit = neighbors(cell, true)
              .filter((other) => !neighbors(cell).includes(other))
              .some((other) => marks[other] === MARK.HIT);
            assert.ok(!cornerHit, `hard fired diagonally next to a hit (game ${game})`);
          }
        });
      }
    }
  });
});
