import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, createGame, normalizeSettings } from '../src/game.js';
import { AI_LEVELS } from '../src/ai.js';
import { MARK } from '../src/board.js';
import { FLEET, shipCells, toCell, toIndex, validateFleet } from '../src/fleet.js';
import { createRng, pick } from '../src/rng.js';

const ship = (id, row, col, vertical = false) => ({
  id, size: FLEET.find((type) => type.id === id).size, row, col, vertical,
});

/** Ships on rows 0, 2, 4, 6 and 8 at the left edge: rows 1, 3, 5, 7 and 9 are open water. */
const LEFT_FLEET = FLEET.map((type, n) => ship(type.id, n * 2, 0));
/** Ships on rows 0, 2, 4, 6 and 8 at the right edge. */
const RIGHT_FLEET = FLEET.map((type, n) => ship(type.id, n * 2, 10 - type.size));
const LEFT_CELLS = new Set(LEFT_FLEET.flatMap((s) => shipCells(s)));
/** The 83 water cells of LEFT_FLEET as [row, col], in board order. */
const WATER = Array.from({ length: 100 }, (_, cell) => cell)
  .filter((cell) => !LEFT_CELLS.has(cell))
  .map((cell) => [toCell(cell).row, toCell(cell).col]);

/** No game can last longer: every cell of both seas. */
const MAX_SHOTS = 200;

const shots = (shooter, cells) => cells.map(([row, col]) => ({ shooter, row, col }));
const count = (marks, mark) => marks.filter((value) => value === mark).length;
const afloat = (ships) => ships.filter((s) => !s.sunk).length;

/** A random cell of the computer's sea that you have not fired at yet. */
function randomTarget(rng, state) {
  const open = state.enemy.marks.flatMap((mark, cell) => (mark === MARK.NONE ? [cell] : []));
  return toCell(pick(rng, open));
}

/** A game in battle: your fleet on the right, the computer's on the left. */
function battle(options = {}) {
  const game = createGame({ seed: 1, playerFleet: RIGHT_FLEET, enemyFleet: LEFT_FLEET, ...options });
  if (!options.history) assert.deepEqual(game.start(), { ok: true });
  return game;
}

describe('settings', () => {
  it('fills in defaults and drops invalid values', () => {
    assert.deepEqual(normalizeSettings(), { ...DEFAULT_SETTINGS });
    assert.deepEqual(normalizeSettings(null), { ...DEFAULT_SETTINGS });
    assert.deepEqual(normalizeSettings('hard'), { ...DEFAULT_SETTINGS });
    assert.deepEqual(normalizeSettings({ ai: 'hard', salvo: true, touching: true }), { ai: 'hard', salvo: true, touching: true });
    assert.deepEqual(normalizeSettings({ ai: 'genius', salvo: 'yes', touching: 1 }), { ...DEFAULT_SETTINGS });
  });

  it('starts a new game in setup with the chosen settings', () => {
    const state = createGame({ seed: 3, ai: 'easy', salvo: true }).getState();
    assert.equal(state.phase, 'setup');
    assert.deepEqual(state.settings, { ai: 'easy', salvo: true, touching: false });
    assert.deepEqual(state.unplaced, FLEET.map((type) => type.id));
    assert.deepEqual(state.player.ships, []);
    assert.equal(state.player.marks.length, 100);
    assert.ok(state.player.marks.every((mark) => mark === MARK.NONE));
    assert.deepEqual(state.enemy.ships.map((s) => Object.keys(s).sort()), FLEET.map(() => ['id', 'size', 'sunk']));
    assert.equal(state.winner, null);
  });

  it('rejects invalid fleets passed as options', () => {
    assert.throws(() => createGame({ seed: 2, enemyFleet: LEFT_FLEET.slice(1) }), /composition/);
    const touching = LEFT_FLEET.map((s) => (s.id === 'frigate' ? { ...s, row: 1 } : s));
    assert.throws(() => createGame({ seed: 2, playerFleet: touching }), /touch/);
    assert.doesNotThrow(() => createGame({ seed: 2, playerFleet: touching, touching: true }));
  });
});

describe('fleet setup', () => {
  it('places, moves and removes ships with placement checks', () => {
    const game = createGame({ seed: 5 });
    assert.deepEqual(game.placeShip('frigate', 2, 2, false), { ok: true });
    assert.deepEqual(game.canPlaceShip('patrol', 3, 2, false), { ok: false, reason: 'touch' });
    assert.deepEqual(game.placeShip('patrol', 2, 4, true), { ok: false, reason: 'overlap' });
    assert.deepEqual(game.placeShip('flagship', 0, 6, false), { ok: false, reason: 'bounds' });
    assert.deepEqual(game.placeShip('submarine', 0, 0, false), { ok: false, reason: 'unknown' });
    assert.deepEqual(game.placeShip('patrol', 5, 5, true), { ok: true });
    assert.deepEqual(game.placeShip('frigate', 8, 0, false), { ok: true }, 'moving a ship ignores its old spot');
    assert.deepEqual(game.getState().player.ships, [
      { ...ship('frigate', 8, 0), hits: 0, sunk: false },
      { ...ship('patrol', 5, 5, true), hits: 0, sunk: false },
    ]);
    assert.deepEqual(game.getState().unplaced, ['flagship', 'corvette', 'gunboat']);
    assert.deepEqual(game.removeShip('patrol'), { ok: true });
    assert.deepEqual(game.removeShip('patrol'), { ok: false, reason: 'unplaced' });
    assert.deepEqual(game.clearFleet(), { ok: true });
    assert.deepEqual(game.getState().player.ships, []);
  });

  it('allows touching ships only when the setting says so', () => {
    const game = createGame({ seed: 5, touching: true });
    game.placeShip('frigate', 2, 2, false);
    assert.deepEqual(game.placeShip('patrol', 3, 2, false), { ok: true });
    assert.deepEqual(game.placeShip('corvette', 2, 3, true), { ok: false, reason: 'overlap' });
  });

  it('rotates a ship about its bow and pulls it back onto the sea', () => {
    const game = createGame({ seed: 5 });
    game.placeShip('flagship', 7, 0, false);
    assert.deepEqual(game.rotateShip('flagship'), { ok: true });
    assert.deepEqual(game.getState().player.ships[0], { ...ship('flagship', 5, 0, true), hits: 0, sunk: false });
    assert.deepEqual(game.rotateShip('flagship'), { ok: true });
    assert.deepEqual(game.getState().player.ships[0], { ...ship('flagship', 5, 0), hits: 0, sunk: false });
    assert.deepEqual(game.placeShip('patrol', 7, 1, false), { ok: true });
    assert.deepEqual(game.rotateShip('flagship'), { ok: false, reason: 'touch' });
    assert.deepEqual(game.getState().player.ships[0], { ...ship('flagship', 5, 0), hits: 0, sunk: false });
    assert.deepEqual(game.rotateShip('frigate'), { ok: false, reason: 'unplaced' });
  });

  it('places a random legal fleet, repeatably for a seed', () => {
    const first = createGame({ seed: 77 });
    const second = createGame({ seed: 77 });
    first.randomizeFleet();
    second.randomizeFleet();
    const ships = first.getState().player.ships.map(({ id, size, row, col, vertical }) => ({ id, size, row, col, vertical }));
    assert.deepEqual(validateFleet(ships), { ok: true });
    assert.deepEqual(first.getState(), second.getState());
    assert.deepEqual(first.getState().unplaced, []);
  });

  it('starts only with a complete fleet, then locks the setup', () => {
    const game = createGame({ seed: 8 });
    assert.deepEqual(game.fire(0, 0), { ok: false, reason: 'phase' });
    game.placeShip('patrol', 0, 0, false);
    assert.deepEqual(game.start(), { ok: false, reason: 'incomplete' });
    game.randomizeFleet();
    assert.deepEqual(game.start(), { ok: true });
    const state = game.getState();
    assert.equal(state.phase, 'battle');
    assert.equal(state.turn, 'player');
    assert.equal(state.shotsLeft, 1);
    for (const action of [
      () => game.start(),
      () => game.randomizeFleet(),
      () => game.clearFleet(),
      () => game.placeShip('patrol', 9, 8, false),
      () => game.removeShip('patrol'),
      () => game.rotateShip('patrol'),
    ]) {
      assert.deepEqual(action(), { ok: false, reason: 'phase' });
    }
  });
});

describe('battle: hit, miss, sunk and win', () => {
  it('reports misses, hits and sunk ships, and the player wins by sinking the fleet', () => {
    const game = battle();
    const miss = game.fire(1, 5);
    assert.deepEqual(miss, { ok: true, shooter: 'player', row: 1, col: 5, result: 'miss', shipId: null, gameOver: false });
    assert.equal(game.getState().turn, 'enemy');
    assert.equal(game.enemyFire().ok, true);
    for (const [n, target] of LEFT_FLEET.entries()) {
      const cells = shipCells(target);
      for (const [k, cell] of cells.entries()) {
        const outcome = game.fire(toCell(cell).row, toCell(cell).col);
        const sinks = k === cells.length - 1;
        const last = sinks && n === LEFT_FLEET.length - 1;
        assert.equal(outcome.result, sinks ? 'sunk' : 'hit');
        assert.equal(outcome.shipId, sinks ? target.id : null, 'only a sinking shot names the ship');
        assert.equal(outcome.gameOver, last);
        if (!last) assert.equal(game.enemyFire().ok, true);
      }
    }
    const state = game.getState();
    assert.equal(state.phase, 'over');
    assert.equal(state.winner, 'player');
    assert.equal(state.shotsLeft, 0);
    assert.equal(count(state.enemy.marks, MARK.SUNK), 17);
    assert.equal(count(state.enemy.marks, MARK.MISS), 1);
    assert.ok(state.enemy.ships.every((s) => s.sunk && Number.isInteger(s.row)));
    assert.deepEqual(state.log.filter((e) => e.result === 'sunk' && e.shooter === 'player').map((e) => e.shipId),
      LEFT_FLEET.map((s) => s.id));
    assert.deepEqual(game.fire(9, 9), { ok: false, reason: 'phase' });
    assert.deepEqual(game.enemyFire(), { ok: false, reason: 'phase' });
  });

  it('the computer wins when it sinks your fleet first', () => {
    const game = battle({ ai: 'hard' });
    for (const [row, col] of WATER) {
      assert.equal(game.fire(row, col).result, 'miss');
      const reply = game.enemyFire();
      if (reply.gameOver) break;
    }
    const state = game.getState();
    assert.equal(state.phase, 'over');
    assert.equal(state.winner, 'enemy');
    assert.ok(state.player.ships.every((s) => s.sunk && s.hits === s.size));
    assert.equal(count(state.player.marks, MARK.SUNK), 17);
    assert.ok(state.enemy.ships.every((s) => !s.sunk && Number.isInteger(s.row)), 'the computer fleet is revealed');
  });

  it('enforces turns, the sea bounds and one shot per cell', () => {
    const game = battle();
    assert.deepEqual(game.enemyFire(), { ok: false, reason: 'turn' });
    for (const [row, col] of [[-1, 0], [0, 10], [10, 0], [2.5, 1]]) {
      assert.deepEqual(game.fire(row, col), { ok: false, reason: 'bounds' });
    }
    assert.equal(game.fire(3, 3).ok, true);
    assert.deepEqual(game.fire(3, 4), { ok: false, reason: 'turn' });
    const reply = game.enemyFire();
    assert.equal(reply.shooter, 'enemy');
    assert.deepEqual(game.fire(3, 3), { ok: false, reason: 'repeat' });
    assert.equal(game.getState().log.length, 2);
  });

  it('names your ship when the computer hits it', () => {
    const game = battle({ history: shots('player', [[1, 1]]).concat(shots('enemy', [[0, 5]])) });
    const [, enemyShot] = game.getState().log;
    assert.deepEqual(enemyShot, { shooter: 'enemy', row: 0, col: 5, result: 'hit', shipId: 'flagship' });
    assert.equal(game.getState().player.ships[0].hits, 1);
  });

  it('hides the computer ships until they sink', () => {
    const game = battle({ history: shots('player', [[8, 0]]).concat(shots('enemy', [[9, 9]]), shots('player', [[8, 1]])) });
    const ships = game.getState().enemy.ships;
    assert.deepEqual(ships.find((s) => s.id === 'patrol'), { id: 'patrol', size: 2, sunk: true, row: 8, col: 0, vertical: false });
    assert.deepEqual(ships.find((s) => s.id === 'frigate'), { id: 'frigate', size: 4, sunk: false });
  });

  it('returns snapshots that cannot change the game', () => {
    const game = battle();
    const state = game.getState();
    state.enemy.marks[0] = MARK.HIT;
    state.player.ships[0].row = 5;
    state.log.push({});
    state.settings.ai = 'hard';
    assert.deepEqual(game.getState(), battle().getState());
  });

  it('replays a history and rejects an impossible one', () => {
    const history = shots('player', [[1, 1]]).concat(shots('enemy', [[1, 1]]));
    const game = battle({ history });
    assert.equal(game.getState().log.length, 2);
    assert.equal(game.getState().turn, 'player');
    assert.throws(() => battle({ history: shots('enemy', [[1, 1]]) }), /turn/);
    assert.throws(() => battle({ history: shots('player', [[1, 1], [1, 2]]) }), /turn/);
    assert.throws(() => createGame({ seed: 2, enemyFleet: LEFT_FLEET, history: [] }), /complete player fleet/);
  });

  it('plays the same game for the same seed and actions', () => {
    const run = () => {
      const game = createGame({ seed: 4242, ai: 'hard', salvo: true });
      game.randomizeFleet();
      game.start();
      const rng = createRng(1);
      for (let shot = 0; game.getState().phase === 'battle'; shot += 1) {
        assert.ok(shot < MAX_SHOTS, 'the game never ended');
        const state = game.getState();
        if (state.turn === 'enemy') {
          game.enemyFire();
        } else {
          const { row, col } = randomTarget(rng, state);
          game.fire(row, col);
        }
      }
      return game.getState();
    };
    assert.deepEqual(run(), run());
  });
});

describe('salvo rule', () => {
  it('gives one shot per own ship afloat each turn', () => {
    const game = battle({ salvo: true });
    assert.equal(game.getState().shotsLeft, 5);
    for (const [n, [row, col]] of WATER.slice(0, 5).entries()) {
      assert.equal(game.getState().turn, 'player');
      assert.equal(game.getState().shotsLeft, 5 - n);
      game.fire(row, col);
    }
    assert.equal(game.getState().turn, 'enemy');
    assert.equal(game.getState().shotsLeft, 5);
    for (let n = 0; n < 5; n += 1) assert.equal(game.enemyFire().ok, true);
    assert.equal(game.getState().turn, 'player');
    assert.equal(game.getState().log.length, 10);
  });

  it('loses a shot per turn for every sunk ship', () => {
    const playerTurn = shots('player', [[8, 0], [8, 1], [1, 0], [1, 1], [1, 2]]); // sinks the computer's patrol boat
    const enemyTurn = shots('enemy', [[8, 8], [8, 9], [1, 5], [1, 6]]); // only 4 shots left; sinks your patrol boat
    const game = battle({ salvo: true, history: [...playerTurn, ...enemyTurn] });
    const state = game.getState();
    assert.equal(state.turn, 'player');
    assert.equal(state.shotsLeft, 4);
    assert.equal(afloat(state.player.ships), 4);
    assert.equal(afloat(state.enemy.ships), 4);
    assert.throws(
      () => battle({ salvo: true, history: [...playerTurn, ...enemyTurn, ...shots('enemy', [[1, 7]])] }),
      /turn/,
      'a fifth computer shot is not allowed',
    );
  });

  it('salvo counts hold through complete games at every level', () => {
    for (const level of AI_LEVELS) {
      for (let seed = 0; seed < 5; seed += 1) {
        const game = createGame({ seed, ai: level, salvo: true });
        game.randomizeFleet();
        game.start();
        const rng = createRng(seed + 100);
        let state = game.getState();
        for (let turn = 0; state.phase === 'battle'; turn += 1) {
          assert.ok(turn < MAX_SHOTS, 'the game never ended');
          const shooter = state.turn;
          const expected = afloat(shooter === 'player' ? state.player.ships : state.enemy.ships);
          assert.equal(state.shotsLeft, expected, `${level}: ${shooter} turn with ${expected} ships afloat`);
          for (let n = 0; n < expected && state.phase === 'battle'; n += 1) {
            if (shooter === 'player') {
              const { row, col } = randomTarget(rng, state);
              assert.equal(game.fire(row, col).ok, true);
            } else {
              assert.equal(game.enemyFire().ok, true);
            }
            state = game.getState();
          }
          if (state.phase === 'battle') assert.notEqual(state.turn, shooter);
        }
        assert.ok(state.winner === 'player' || state.winner === 'enemy');
      }
    }
  });
});

describe('complete games through the game flow', () => {
  it('the computer never repeats a cell, and every game ends with a fleet sunk', () => {
    for (const level of AI_LEVELS) {
      for (const salvo of [false, true]) {
        for (const touching of [false, true]) {
          for (let seed = 0; seed < 8; seed += 1) {
            const game = createGame({ seed, ai: level, salvo, touching });
            game.randomizeFleet();
            game.start();
            const rng = createRng(seed + 500);
            let state = game.getState();
            for (let shot = 0; state.phase === 'battle'; shot += 1) {
              assert.ok(shot < MAX_SHOTS, 'the game never ended');
              if (state.turn === 'enemy') {
                const outcome = game.enemyFire();
                assert.equal(state.player.marks[toIndex(outcome.row, outcome.col)], MARK.NONE,
                  `${level} fired twice at ${outcome.row},${outcome.col}`);
              } else {
                const { row, col } = randomTarget(rng, state);
                assert.equal(game.fire(row, col).ok, true);
              }
              state = game.getState();
            }
            const loser = state.winner === 'player' ? state.enemy : state.player;
            assert.ok(loser.ships.every((s) => s.sunk));
            assert.equal(count(loser.marks, MARK.SUNK), 17);
          }
        }
      }
    }
  });
});
