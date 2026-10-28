import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoGame } from '../src/demo.js';
import { MARK } from '../src/board.js';

const count = (marks, mark) => marks.filter((value) => value === mark).length;

describe('demo position', () => {
  it('is mid-battle with your turn to fire', () => {
    const state = createDemoGame().getState();
    assert.equal(state.phase, 'battle');
    assert.equal(state.turn, 'player');
    assert.equal(state.shotsLeft, 1);
    assert.equal(state.winner, null);
    assert.deepEqual(state.settings, { ai: 'normal', salvo: false, touching: false });
  });

  it('shows misses, hits and exactly one sunk ship on both seas', () => {
    const state = createDemoGame().getState();
    for (const side of ['player', 'enemy']) {
      const { marks, ships } = state[side];
      assert.ok(count(marks, MARK.MISS) >= 5, `${side}: misses`);
      assert.ok(count(marks, MARK.HIT) >= 2, `${side}: hits on a ship still afloat`);
      assert.equal(ships.filter((ship) => ship.sunk).length, 1, `${side}: one sunk ship`);
      assert.equal(count(marks, MARK.SUNK), ships.find((ship) => ship.sunk).size);
    }
  });

  it('has a log of alternating shots, yours first', () => {
    const { log } = createDemoGame().getState();
    assert.ok(log.length >= 20);
    log.forEach((entry, n) => assert.equal(entry.shooter, n % 2 === 0 ? 'player' : 'enemy'));
  });

  it('is the same every time', () => {
    assert.deepEqual(createDemoGame().getState(), createDemoGame().getState());
  });

  it('can be played on: the computer goes after your damaged frigate', () => {
    const game = createDemoGame();
    assert.equal(game.fire(9, 9).result, 'miss');
    const reply = game.enemyFire();
    assert.equal(reply.result, 'hit');
    assert.equal(reply.shipId, 'frigate');
    assert.equal(game.getState().turn, 'player');
  });
});
