/**
 * Fleet setup on your sea, by mouse, touch or keyboard. Pick a ship in the
 * harbor, then drag it onto the sea or tap a cell. Tap a placed ship to
 * select it and again to rotate it; drag it to move it, or off the sea to
 * send it back to the harbor. Keys on the board: 1-5 pick a ship, arrows
 * move the cursor, Enter places, R rotates, Delete removes, Escape deselects.
 * @module setup
 */
import { FLEET, toIndex } from './fleet.js';
import { bowFor, isArrowKey, middleOf, segmentAt, shipAt, stepCursor } from './coords.js';
import { createHull } from './hull.js';
import { element } from './dom.js';

/** Pointer travel (px) before a press becomes a drag. */
const DRAG_THRESHOLD = 6;

/** After a drag that started on a chip, its click is ignored this long (ms). */
const CLICK_GRACE_MS = 400;

/**
 * @typedef {import('./game.js').GameState} GameState
 * @typedef {import('./board-view.js').ShipDrawing} ShipDrawing
 * @typedef {(key: string, params?: Record<string, string|number>) => string} Translate
 */

/**
 * A pointer held down on a harbor chip or on the sea.
 * @typedef {object} Press
 * @property {number} pointerId
 * @property {number} x
 * @property {number} y
 * @property {string|null} id      Ship held; null when pressing open water.
 * @property {number} start        Cell pressed, -1 in the harbor.
 * @property {number} grab         Segment held, counted from the bow.
 * @property {boolean} vertical    Orientation of the ship held.
 * @property {boolean} fromHarbor
 * @property {boolean} dragging
 * @property {number} over         Cell under the pointer, -1 off the sea.
 */

/**
 * @typedef {object} SetupOptions
 * @property {import('./board-view.js').BoardView} board Your sea.
 * @property {HTMLElement} harbor Receives the ship chips.
 * @property {() => import('./game.js').Game} getGame
 * @property {() => void} onPreview Only the picture of your sea changed.
 * @property {() => void} onChange The fleet or the selection changed.
 * @property {(reason: string) => void} onRefuse A placement was refused.
 */

/**
 * @typedef {object} Setup
 * @property {() => void} reset Fresh selection for a new game.
 * @property {() => void} rotate Rotates the selected ship, or the orientation for the next placement.
 * @property {() => void} randomize
 * @property {() => void} clear
 * @property {() => (string|null)} selected Id of the selected ship.
 * @property {(state: GameState) => { ships: ShipDrawing[], aim: number }} picture What your sea shows.
 * @property {(state: GameState, t: Translate) => void} update Refreshes the harbor chips.
 */

/**
 * Wires the setup controls to your sea and the harbor.
 * @param {SetupOptions} options
 * @returns {Setup}
 */
export function createSetup({ board, harbor, getGame, onPreview, onChange, onRefuse }) {
  /** @type {string|null} */
  let selectedId = FLEET[0].id;
  let upright = false;
  let cursor = toIndex(4, 4);
  let hover = -1;
  let keyboard = false;
  /** @type {Press|null} */
  let press = null;
  let clickGraceUntil = 0;
  const chips = new Map(FLEET.map((type) => [type.id, createChip(type)]));
  harbor.append(...chips.values());
  bindSea(board.element);

  function current() {
    return getGame().getState();
  }

  function inSetup() {
    return current().phase === 'setup';
  }

  function placedShip(id, state = current()) {
    return state.player.ships.find((ship) => ship.id === id) ?? null;
  }

  function sizeOf(id) {
    return FLEET.find((type) => type.id === id).size;
  }

  function orientationOf(id, state = current()) {
    return placedShip(id, state)?.vertical ?? upright;
  }

  function select(id) {
    selectedId = id;
    onChange();
  }

  function place(id, index, anchor, vertical) {
    const moving = placedShip(id) !== null;
    const { row, col } = bowFor(sizeOf(id), vertical, index, anchor);
    const outcome = getGame().placeShip(id, row, col, vertical);
    if (!outcome.ok) {
      onRefuse(outcome.reason);
      return;
    }
    selectedId = moving ? id : current().unplaced[0] ?? null;
    onChange();
  }

  function rotate() {
    if (!inSetup()) return;
    const ship = selectedId ? placedShip(selectedId) : null;
    if (!ship) {
      upright = !upright;
      onChange();
      return;
    }
    const outcome = getGame().rotateShip(ship.id);
    if (outcome.ok) onChange();
    else onRefuse(outcome.reason);
  }

  function removeSelected() {
    if (!selectedId || !placedShip(selectedId)) return;
    getGame().removeShip(selectedId);
    onChange();
  }

  function randomize() {
    if (!inSetup()) return;
    getGame().randomizeFleet();
    selectedId = null;
    onChange();
  }

  function clear() {
    if (!inSetup()) return;
    getGame().clearFleet();
    selectedId = FLEET[0].id;
    onChange();
  }

  function reset() {
    selectedId = FLEET[0].id;
    upright = false;
    hover = -1;
    keyboard = false;
    press = null;
  }

  /** A tap on the sea: select a ship, rotate the selected one, or place it. */
  function tap(index) {
    const ship = shipAt(current().player.ships, index);
    if (ship && ship.id === selectedId) rotate();
    else if (ship) select(ship.id);
    else if (selectedId) place(selectedId, index, middleOf(sizeOf(selectedId)), orientationOf(selectedId));
  }

  /** Enter on the sea: place the selected ship at the cursor, or select the ship there. */
  function enterAt(index) {
    if (selectedId) {
      place(selectedId, index, middleOf(sizeOf(selectedId)), orientationOf(selectedId));
      return;
    }
    const ship = shipAt(current().player.ships, index);
    if (ship) select(ship.id);
  }

  function bindSea(node) {
    node.addEventListener('pointerdown', pressSea);
    node.addEventListener('pointermove', moveOverSea);
    node.addEventListener('pointerup', release);
    node.addEventListener('pointercancel', cancel);
    node.addEventListener('pointerleave', () => {
      if (hover < 0) return;
      hover = -1;
      onPreview();
    });
    node.addEventListener('keydown', onKey);
    node.addEventListener('focus', () => {
      if (!inSetup() || !node.matches(':focus-visible')) return;
      keyboard = true;
      onPreview();
    });
    node.addEventListener('blur', () => {
      if (!keyboard) return;
      keyboard = false;
      onPreview();
    });
  }

  function pressSea(event) {
    if (!inSetup() || !event.isPrimary || event.button !== 0) return;
    const index = board.cellAt(event.clientX, event.clientY);
    if (index < 0) return;
    const ship = shipAt(current().player.ships, index);
    keyboard = false;
    press = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      id: ship?.id ?? null,
      start: index,
      grab: ship ? segmentAt(ship, index) : 0,
      vertical: ship?.vertical ?? false,
      fromHarbor: false,
      dragging: false,
      over: index,
    };
    board.element.setPointerCapture(event.pointerId);
  }

  function moveOverSea(event) {
    if (!inSetup()) return;
    if (press) {
      follow(event);
      return;
    }
    if (event.pointerType !== 'mouse') return;
    const index = board.cellAt(event.clientX, event.clientY);
    if (index === hover && !keyboard) return;
    hover = index;
    keyboard = false;
    onPreview();
  }

  /** Tracks a held pointer; it becomes a drag once it has moved far enough. */
  function follow(event) {
    if (!press || event.pointerId !== press.pointerId) return;
    const over = board.cellAt(event.clientX, event.clientY);
    if (press.dragging) {
      if (over === press.over) return;
      press.over = over;
      onPreview();
      return;
    }
    const travel = Math.hypot(event.clientX - press.x, event.clientY - press.y);
    if (!press.id || travel < DRAG_THRESHOLD) return;
    press.dragging = true;
    press.over = over;
    onPreview();
  }

  function release(event) {
    if (!press || event.pointerId !== press.pointerId) return;
    const done = press;
    press = null;
    if (done.dragging) drop(done);
    else if (!done.fromHarbor) tap(done.start);
  }

  /** Ends a drag: on the sea the ship is placed, off the sea it goes back to the harbor. */
  function drop(done) {
    if (done.fromHarbor) clickGraceUntil = performance.now() + CLICK_GRACE_MS;
    if (done.over >= 0) {
      place(done.id, done.over, done.grab, done.vertical);
    } else if (!done.fromHarbor) {
      getGame().removeShip(done.id);
      select(done.id);
    } else {
      onPreview();
    }
  }

  function cancel(event) {
    if (!press || event.pointerId !== press.pointerId) return;
    press = null;
    onPreview();
  }

  function createChip(type) {
    const chip = element('button', 'chip');
    chip.type = 'button';
    const hull = element('span', 'chip-hull');
    hull.style.setProperty('--size', String(type.size));
    hull.append(createHull(type.size, false));
    chip.append(hull, element('span', 'chip-name'), element('span', 'chip-size', String(type.size)));
    chip.addEventListener('pointerdown', (event) => pressChip(event, type));
    chip.addEventListener('pointermove', follow);
    chip.addEventListener('pointerup', release);
    chip.addEventListener('pointercancel', cancel);
    chip.addEventListener('click', () => {
      if (inSetup() && performance.now() > clickGraceUntil) select(type.id);
    });
    return chip;
  }

  function pressChip(event, type) {
    if (!inSetup() || !event.isPrimary || event.button !== 0) return;
    keyboard = false;
    selectedId = type.id;
    press = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      id: type.id,
      start: -1,
      grab: middleOf(type.size),
      vertical: orientationOf(type.id),
      fromHarbor: true,
      dragging: false,
      over: -1,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    onChange();
  }

  function onKey(event) {
    if (!inSetup() || event.altKey || event.ctrlKey || event.metaKey) return;
    if (handleKey(event.key)) event.preventDefault();
  }

  /** @returns {boolean} False when the key means nothing here. */
  function handleKey(key) {
    const number = key.length === 1 ? Number(key) : 0;
    if (isArrowKey(key)) {
      cursor = stepCursor(cursor, key);
      keyboard = true;
      onPreview();
    } else if (key === 'Enter' || key === ' ') {
      keyboard = true;
      enterAt(cursor);
    } else if (key === 'r' || key === 'R') {
      rotate();
    } else if (key === 'Delete' || key === 'Backspace') {
      removeSelected();
    } else if (key === 'Escape') {
      select(null);
    } else if (Number.isInteger(number) && number >= 1 && number <= FLEET.length) {
      select(FLEET[number - 1].id);
    } else {
      return false;
    }
    return true;
  }

  function picture(state) {
    const lifted = press?.dragging ? press.id : null;
    const ships = state.player.ships.map((ship) => ({
      ...ship, look: 'own', selected: ship.id === selectedId, lifted: ship.id === lifted,
    }));
    const ghost = preview(state);
    return { ships: ghost ? [...ships, ghost] : ships, aim: keyboard ? cursor : -1 };
  }

  /** The placement preview: the dragged ship, or the selected one under the mouse or cursor. */
  function preview(state) {
    if (press?.dragging) {
      return press.over >= 0 ? candidate(press.id, press.over, press.grab, press.vertical) : null;
    }
    const target = keyboard ? cursor : hover;
    if (press || !selectedId || target < 0) return null;
    if (!keyboard && shipAt(state.player.ships, target)) return null;
    return candidate(selectedId, target, middleOf(sizeOf(selectedId)), orientationOf(selectedId, state));
  }

  function candidate(id, index, anchor, vertical) {
    const size = sizeOf(id);
    const { row, col } = bowFor(size, vertical, index, anchor);
    const allowed = getGame().canPlaceShip(id, row, col, vertical).ok;
    return { id, size, row, col, vertical, look: allowed ? 'ghost' : 'blocked' };
  }

  function update(state, t) {
    for (const type of FLEET) {
      const chip = chips.get(type.id);
      const placed = !state.unplaced.includes(type.id);
      const name = t(`ship_${type.id}`);
      const params = { ship: name, size: type.size };
      chip.classList.toggle('is-placed', placed);
      chip.classList.toggle('is-selected', type.id === selectedId);
      chip.setAttribute('aria-pressed', String(type.id === selectedId));
      chip.setAttribute('aria-label', placed ? t('chipPlaced', params) : t('chipLabel', params));
      chip.querySelector('.chip-name').textContent = name;
    }
  }

  return {
    reset,
    rotate,
    randomize,
    clear,
    selected: () => selectedId,
    picture,
    update,
  };
}
