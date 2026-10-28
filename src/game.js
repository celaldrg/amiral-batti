/**
 * Game flow against the computer: fleet setup, turns (or salvos), the
 * computer's shots, the shot log and the result. Pure: no DOM, no timers.
 *
 * Failed actions return { ok: false, reason } with one of these reasons:
 *   phase      - not possible in the current phase
 *   turn       - it is not that side's turn
 *   bounds     - off the sea
 *   repeat     - that cell was already fired at
 *   overlap    - the ship would lie on another ship
 *   touch      - the ship would touch another ship (not allowed)
 *   unknown    - no such ship id
 *   unplaced   - that ship is not on the sea yet
 *   incomplete - not every ship is placed
 * @module game
 */
import { FLEET, SIZE, checkPlacement, isOnSea, randomFleet, toCell, toIndex, validateFleet } from './fleet.js';
import { MARK, afloatCount, createBoard, fireAt, isDefeated, viewOf } from './board.js';
import { AI_LEVELS, createAi } from './ai.js';
import { createRng, deriveSeed } from './rng.js';

/**
 * @typedef {import('./fleet.js').Ship} Ship
 * @typedef {'player'|'enemy'} Side
 * @typedef {'setup'|'battle'|'over'} Phase
 * @typedef {{ ok: boolean, reason?: string }} Outcome
 */

/**
 * @typedef {object} Settings
 * @property {'easy'|'normal'|'hard'} ai Computer level.
 * @property {boolean} salvo    Each turn has one shot per own ship afloat.
 * @property {boolean} touching Ships may touch each other.
 */

/**
 * A shot to replay through the history option.
 * @typedef {object} ShotOrder
 * @property {Side} shooter
 * @property {number} row
 * @property {number} col
 */

/**
 * A fired shot. shipId names the ship when it sank, and on hits against your
 * own fleet; a plain hit on the computer's fleet does not reveal the ship.
 * @typedef {object} LogEntry
 * @property {Side} shooter
 * @property {number} row
 * @property {number} col
 * @property {import('./board.js').ShotResult} result
 * @property {string|null} shipId
 */

/**
 * Result of fire() and enemyFire(): on success the new log entry plus
 * gameOver; on failure { ok: false, reason }.
 * @typedef {object} ShotOutcome
 * @property {boolean} ok
 * @property {string} [reason]
 * @property {Side} [shooter]
 * @property {number} [row]
 * @property {number} [col]
 * @property {import('./board.js').ShotResult} [result]
 * @property {string|null} [shipId]
 * @property {boolean} [gameOver]
 */

/**
 * A ship in a state snapshot. Your ships always carry their position and
 * hits; the computer's ships carry a position only once sunk or when the game
 * is over, and never their hits.
 * @typedef {object} ShipState
 * @property {string} id
 * @property {number} size
 * @property {boolean} sunk
 * @property {number} [hits]
 * @property {number} [row]
 * @property {number} [col]
 * @property {boolean} [vertical]
 */

/**
 * @typedef {object} SeaState
 * @property {ShipState[]} ships In FLEET order (yours: only placed ones during setup).
 * @property {number[]} marks    MARK of each cell, index = row * SIZE + col.
 */

/**
 * @typedef {object} GameState
 * @property {Phase} phase
 * @property {Side} turn        Who shoots now (battle) or shot last (over).
 * @property {number} shotsLeft Shots left in the current turn.
 * @property {Side|null} winner
 * @property {Settings} settings
 * @property {string[]} unplaced Ids of your ships not on the sea yet.
 * @property {SeaState} player   Your sea, with the computer's shots.
 * @property {SeaState} enemy    The computer's sea, with your shots.
 * @property {LogEntry[]} log    Every shot so far, oldest first.
 */

/**
 * @typedef {object} Game
 * @property {() => GameState} getState Fresh snapshot for rendering.
 * @property {(id: string, row: number, col: number, vertical: boolean) => Outcome} canPlaceShip
 *   Checks a placement without changing anything (drag previews).
 * @property {(id: string, row: number, col: number, vertical: boolean) => Outcome} placeShip
 *   Places or moves one of your ships; (row, col) is its bow.
 * @property {(id: string) => Outcome} rotateShip Turns a placed ship about its
 *   bow, shifted back onto the sea when it would stick out.
 * @property {(id: string) => Outcome} removeShip
 * @property {() => Outcome} randomizeFleet Places your whole fleet at random.
 * @property {() => Outcome} clearFleet
 * @property {() => Outcome} start Starts the battle once every ship is placed; you shoot first.
 * @property {(row: number, col: number) => ShotOutcome} fire Your shot at the computer's sea.
 * @property {() => ShotOutcome} enemyFire One computer shot; call it while state.turn is 'enemy'.
 */

/** Settings used for missing or invalid options. */
export const DEFAULT_SETTINGS = Object.freeze({ ai: 'normal', salvo: false, touching: false });

/**
 * Returns complete, valid settings; missing or invalid values fall back to
 * DEFAULT_SETTINGS (handy for settings read back from storage).
 * @param {unknown} [input]
 * @returns {Settings}
 */
export function normalizeSettings(input) {
  const source = typeof input === 'object' && input !== null ? input : {};
  return {
    ai: AI_LEVELS.includes(source.ai) ? source.ai : DEFAULT_SETTINGS.ai,
    salvo: typeof source.salvo === 'boolean' ? source.salvo : DEFAULT_SETTINGS.salvo,
    touching: typeof source.touching === 'boolean' ? source.touching : DEFAULT_SETTINGS.touching,
  };
}

/**
 * @param {Side} side
 * @returns {Side}
 */
function opponent(side) {
  return side === 'player' ? 'enemy' : 'player';
}

/**
 * Validates a fleet passed as an option; returns clean copies in FLEET order.
 * @param {readonly Ship[]} ships
 * @param {Settings} settings
 * @returns {Ship[]}
 */
function checkedFleet(ships, settings) {
  const verdict = validateFleet(ships, settings);
  if (!verdict.ok) throw new Error(`Invalid fleet: ${verdict.reason}`);
  return FLEET.map((type) => {
    const { id, size, row, col, vertical } = ships.find((ship) => ship.id === type.id);
    return { id, size, row, col, vertical: Boolean(vertical) };
  });
}

/**
 * Creates a game against the computer. Place your ships during 'setup', call
 * start(), then fire(row, col). Whenever state.turn is 'enemy', call
 * enemyFire() once per computer shot (for example after a short delay).
 * @param {object} [options]
 * @param {number} [options.seed] Seeds every random choice; random when omitted.
 * @param {'easy'|'normal'|'hard'} [options.ai]
 * @param {boolean} [options.salvo]
 * @param {boolean} [options.touching]
 * @param {Ship[]} [options.playerFleet] Your complete fleet, already placed.
 * @param {Ship[]} [options.enemyFleet] The computer's fleet instead of a random one.
 * @param {ShotOrder[]} [options.history] Shots already fired, in turn order:
 *   the battle starts at once (needs playerFleet) and they are replayed.
 * @returns {Game}
 */
export function createGame(options = {}) {
  const settings = normalizeSettings(options);
  const seed = options.seed ?? Math.floor(Math.random() * 2 ** 32);
  const setupRng = createRng(deriveSeed(seed, 1));
  const ai = createAi(settings.ai, createRng(deriveSeed(seed, 2)), settings);
  const enemyBoard = createBoard(options.enemyFleet
    ? checkedFleet(options.enemyFleet, settings)
    : randomFleet(createRng(deriveSeed(seed, 3)), settings));
  /** @type {Map<string, Ship>} */
  const placed = new Map();
  /** @type {LogEntry[]} */
  const log = [];
  /** @type {import('./board.js').Board|null} */
  let playerBoard = null;
  /** @type {Phase} */
  let phase = 'setup';
  /** @type {Side} */
  let turn = 'player';
  let shotsLeft = 0;
  /** @type {Side|null} */
  let winner = null;

  function setupError(id) {
    if (phase !== 'setup') return 'phase';
    return FLEET.some((type) => type.id === id) ? null : 'unknown';
  }

  function shipFor(id, row, col, vertical) {
    const { size } = FLEET.find((type) => type.id === id);
    return { id, size, row, col, vertical: Boolean(vertical) };
  }

  function canPlaceShip(id, row, col, vertical) {
    const others = [...placed.values()].filter((ship) => ship.id !== id);
    const reason = setupError(id) ?? checkPlacement(others, shipFor(id, row, col, vertical), settings);
    return reason ? { ok: false, reason } : { ok: true };
  }

  function placeShip(id, row, col, vertical) {
    const outcome = canPlaceShip(id, row, col, vertical);
    if (outcome.ok) placed.set(id, shipFor(id, row, col, vertical));
    return outcome;
  }

  function rotateShip(id) {
    const ship = placed.get(id);
    if (!ship) return { ok: false, reason: setupError(id) ?? 'unplaced' };
    const vertical = !ship.vertical;
    const row = vertical ? Math.min(ship.row, SIZE - ship.size) : ship.row;
    const col = vertical ? ship.col : Math.min(ship.col, SIZE - ship.size);
    return placeShip(id, row, col, vertical);
  }

  function removeShip(id) {
    const reason = setupError(id) ?? (placed.has(id) ? null : 'unplaced');
    if (reason) return { ok: false, reason };
    placed.delete(id);
    return { ok: true };
  }

  function randomizeFleet() {
    if (phase !== 'setup') return { ok: false, reason: 'phase' };
    placed.clear();
    for (const ship of randomFleet(setupRng, settings)) placed.set(ship.id, ship);
    return { ok: true };
  }

  function clearFleet() {
    if (phase !== 'setup') return { ok: false, reason: 'phase' };
    placed.clear();
    return { ok: true };
  }

  function start() {
    if (phase !== 'setup') return { ok: false, reason: 'phase' };
    if (placed.size < FLEET.length) return { ok: false, reason: 'incomplete' };
    playerBoard = createBoard(FLEET.map((type) => placed.get(type.id)));
    phase = 'battle';
    beginTurn('player');
    return { ok: true };
  }

  /** The sea a side defends. */
  function boardOf(side) {
    return side === 'player' ? playerBoard : enemyBoard;
  }

  function beginTurn(side) {
    turn = side;
    shotsLeft = settings.salvo ? afloatCount(boardOf(side)) : 1;
  }

  function shotError(shooter) {
    if (phase !== 'battle') return 'phase';
    return turn === shooter ? null : 'turn';
  }

  function cellError(board, row, col) {
    if (!isOnSea(row, col)) return 'bounds';
    return board.marks[toIndex(row, col)] === MARK.NONE ? null : 'repeat';
  }

  function shoot(shooter, index) {
    const target = boardOf(opponent(shooter));
    const { result, shipId } = fireAt(target, index);
    const known = result === 'sunk' || shooter === 'enemy';
    const entry = { shooter, ...toCell(index), result, shipId: known ? shipId : null };
    log.push(entry);
    shotsLeft -= 1;
    if (isDefeated(target)) {
      phase = 'over';
      winner = shooter;
      shotsLeft = 0;
    } else if (shotsLeft === 0) {
      beginTurn(opponent(shooter));
    }
    return { ok: true, ...entry, gameOver: phase === 'over' };
  }

  function play(shooter, row, col) {
    const reason = shotError(shooter) ?? cellError(boardOf(opponent(shooter)), row, col);
    return reason ? { ok: false, reason } : shoot(shooter, toIndex(row, col));
  }

  function fire(row, col) {
    return play('player', row, col);
  }

  function enemyFire() {
    const reason = shotError('enemy');
    return reason ? { ok: false, reason } : shoot('enemy', ai.nextShot(viewOf(playerBoard)));
  }

  function replay(history) {
    if (!start().ok) throw new Error('A history needs a complete player fleet');
    for (const order of history) {
      const outcome = play(order.shooter, order.row, order.col);
      if (!outcome.ok) throw new Error(`Shot ${JSON.stringify(order)} cannot be played: ${outcome.reason}`);
    }
  }

  function playerShips() {
    if (!playerBoard) {
      return FLEET.filter((type) => placed.has(type.id))
        .map((type) => ({ ...placed.get(type.id), hits: 0, sunk: false }));
    }
    return playerBoard.ships.map((ship, n) => (
      { ...ship, hits: playerBoard.hits[n], sunk: playerBoard.hits[n] === ship.size }
    ));
  }

  function enemyShips() {
    return enemyBoard.ships.map((ship, n) => {
      const { id, size, row, col, vertical } = ship;
      const sunk = enemyBoard.hits[n] === size;
      return sunk || phase === 'over' ? { id, size, sunk, row, col, vertical } : { id, size, sunk };
    });
  }

  function getState() {
    return {
      phase,
      turn,
      shotsLeft,
      winner,
      settings: { ...settings },
      unplaced: FLEET.filter((type) => !placed.has(type.id)).map((type) => type.id),
      player: { ships: playerShips(), marks: Array.from(playerBoard?.marks ?? new Uint8Array(SIZE * SIZE)) },
      enemy: { ships: enemyShips(), marks: Array.from(enemyBoard.marks) },
      log: log.map((entry) => ({ ...entry })),
    };
  }

  for (const ship of options.playerFleet ? checkedFleet(options.playerFleet, settings) : []) {
    placed.set(ship.id, ship);
  }
  if (options.history) replay(options.history);

  return {
    getState, canPlaceShip, placeShip, rotateShip, removeShip, randomizeFleet, clearFleet, start, fire, enemyFire,
  };
}
