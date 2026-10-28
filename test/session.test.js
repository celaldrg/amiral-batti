import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fromSaved, knownWater, normalizeRecord, shotStats, toSaved } from '../src/session.js';
import { createGame } from '../src/game.js';
import { createDemoGame } from '../src/demo.js';
import { MARK } from '../src/board.js';
import { toCell, toIndex } from '../src/fleet.js';
import { createRng, pick } from '../src/rng.js';

/** A battle after `turns` exchanges of random player shots and computer replies. */
function battleAfter(seed, turns, options = {}) {
  const game = createGame({ seed, ...options });
  game.randomizeFleet();
  game.start();
  const rng = createRng(seed + 1);
  for (let n = 0; n < turns && game.getState().phase === 'battle'; n += 1) {
    const state = game.getState();
    if (state.turn === 'enemy') {
      game.enemyFire();
    } else {
      const open = state.enemy.marks.flatMap((mark, cell) => (mark === MARK.NONE ? [cell] : []));
      const { row, col } = toCell(pick(rng, open));
      game.fire(row, col);
    }
  }
  return game;
}

/** Saves through JSON, as localStorage would. */
const roundTrip = (seed, game) => JSON.parse(JSON.stringify(toSaved(seed, game.getState())));

describe('saved battles', () => {
  it('restores the exact battle after a reload', () => {
    for (const options of [{}, { ai: 'hard', salvo: true }, { ai: 'easy', touching: true }]) {
      const game = battleAfter(31, 40, options);
      const restored = fromSaved(roundTrip(31, game));
      assert.ok(restored, `restored with ${JSON.stringify(options)}`);
      assert.equal(restored.seed, 31);
      assert.deepEqual(restored.game.getState(), game.getState());
    }
  });

  it('lets a restored battle go on', () => {
    const restored = fromSaved(roundTrip(5, battleAfter(5, 10)));
    const state = restored.game.getState();
    assert.equal(state.turn, 'player');
    const open = state.enemy.marks.findIndex((mark) => mark === MARK.NONE);
    const { row, col } = toCell(open);
    assert.equal(restored.game.fire(row, col).ok, true);
    assert.equal(restored.game.enemyFire().ok, true);
  });

  it('ignores damaged, foreign or finished saves', () => {
    const good = roundTrip(9, battleAfter(9, 6));
    const broken = [
      null, 'text', 42, {},
      { ...good, version: 2 },
      { ...good, seed: -1 },
      { ...good, seed: 1.5 },
      { ...good, seed: 2 ** 32 },
      { ...good, fleet: 'ships' },
      { ...good, fleet: good.fleet.slice(1) },
      { ...good, fleet: good.fleet.map((ship, n) => (n === 1 ? { ...good.fleet[0], id: ship.id, size: ship.size } : ship)) },
      { ...good, history: null },
      { ...good, history: [...good.history, good.history[0]] },
      { ...good, history: [{ shooter: 'enemy', row: 0, col: 0 }] },
      { ...good, history: [null] },
    ];
    for (const data of broken) assert.equal(fromSaved(data), null, JSON.stringify(data)?.slice(0, 80));
  });

  it('does not restore a game that is already over', () => {
    let game = battleAfter(12, 400);
    assert.equal(game.getState().phase, 'over');
    assert.equal(fromSaved(roundTrip(12, game)), null);
    game = battleAfter(12, 0);
    assert.equal(fromSaved(roundTrip(12, game))?.game.getState().log.length, 0, 'a battle with no shots yet is fine');
  });
});

describe('shot statistics and record', () => {
  it('counts shots, hits and accuracy per side', () => {
    const log = [
      { shooter: 'player', result: 'miss' },
      { shooter: 'enemy', result: 'hit' },
      { shooter: 'player', result: 'hit' },
      { shooter: 'player', result: 'sunk' },
    ];
    assert.deepEqual(shotStats(log, 'player'), { shots: 3, hits: 2, accuracy: 67 });
    assert.deepEqual(shotStats(log, 'enemy'), { shots: 1, hits: 1, accuracy: 100 });
    assert.deepEqual(shotStats([], 'player'), { shots: 0, hits: 0, accuracy: 0 });
  });

  it('repairs a damaged record', () => {
    assert.deepEqual(normalizeRecord({ wins: 3, losses: 1 }), { wins: 3, losses: 1 });
    assert.deepEqual(normalizeRecord({ wins: -2, losses: 'x' }), { wins: 0, losses: 0 });
    assert.deepEqual(normalizeRecord(null), { wins: 0, losses: 0 });
  });
});

describe('known water', () => {
  it('marks the untried cells around sunk ships when ships may not touch', () => {
    const { enemy } = createDemoGame().getState();
    // The demo sinks the computer's corvette at row 4, columns 5 to 7; (5, 5) was already fired at.
    const expected = [[3, 4], [3, 5], [3, 6], [3, 7], [3, 8], [4, 4], [4, 8], [5, 4], [5, 6], [5, 7], [5, 8]]
      .map(([row, col]) => toIndex(row, col));
    assert.deepEqual([...knownWater(enemy, false)].sort((a, b) => a - b), expected);
  });

  it('marks nothing when ships may touch or nothing is sunk', () => {
    const { enemy } = createDemoGame().getState();
    assert.equal(knownWater(enemy, true).size, 0);
    assert.equal(knownWater(battleAfter(3, 0).getState().enemy, false).size, 0);
  });
});
