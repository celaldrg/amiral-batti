/**
 * Page controller: builds both seas and wires the setup, the battle, the
 * settings, the language toggle and the new-game button. The rules live in
 * the pure modules; this one turns their state into the page and back.
 * @module main
 */
import { FLEET, shipCells, toCell, toIndex } from './fleet.js';
import { MARK } from './board.js';
import { createGame, normalizeSettings } from './game.js';
import { createDemoGame } from './demo.js';
import { cellName, isArrowKey, stepCursor } from './coords.js';
import { fromSaved, knownWater, normalizeRecord, shotStats, toSaved } from './session.js';
import { STRINGS, normalizeLanguage, translate } from './i18n.js';
import { createStore } from './storage.js';
import { createBoardView } from './board-view.js';
import { createSetup } from './setup.js';
import { renderFleet, renderLog } from './panels.js';
import { prefersReducedMotion } from './dom.js';

/** Pause before the computer's first shot of a turn (ms). */
const ENEMY_DELAY = 700;

/** Pause between the computer's shots in a salvo (ms). */
const SALVO_DELAY = 420;

/** How long "New game" waits for a second press during a battle (ms). */
const CONFIRM_MS = 3000;

/** Where the aiming cursor starts. */
const CENTER = toIndex(4, 4);

/** Cell aimed at in the demo position: right above two hits. */
const DEMO_AIM = toIndex(2, 2);

const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

/** Keys that reach the sea of the current phase while nothing has focus. */
const PAGE_KEYS = {
  setup: new Set([...ARROWS, 'Enter', ' ', 'r', 'R', 'Delete', 'Backspace', 'Escape', '1', '2', '3', '4', '5']),
  battle: new Set([...ARROWS, 'Enter', ' ']),
};

/**
 * A message for the status bar, kept as a key so it follows the language.
 * params.ship holds a ship id, translated when shown.
 * @typedef {{ key: string, params?: Record<string, string|number> }} Notice
 */

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
function byId(id) {
  return /** @type {HTMLElement} */ (document.getElementById(id));
}

const ui = {
  main: byId('game'),
  newGame: byId('new-game'),
  lang: byId('lang'),
  pill: byId('pill'),
  message: byId('message'),
  shots: byId('shots'),
  enemyCount: byId('enemy-count'),
  playerCount: byId('player-count'),
  enemyFleet: byId('enemy-fleet'),
  playerFleet: byId('player-fleet'),
  log: byId('log'),
  rules: byId('rules'),
  rotate: byId('rotate'),
  random: byId('random'),
  clear: byId('clear'),
  start: byId('start'),
  aiHint: byId('ai-hint'),
  salvo: /** @type {HTMLInputElement} */ (byId('salvo')),
  touching: /** @type {HTMLInputElement} */ (byId('touching')),
  result: byId('result'),
  resultTitle: byId('result-title'),
  resultText: byId('result-text'),
  resultRecord: byId('result-record'),
  playAgain: byId('play-again'),
};
const aiInputs = /** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll('input[name="ai"]'));

const store = createStore('amiral-batti:');
const demo = new URLSearchParams(window.location.search).has('demo');

let lang = normalizeLanguage(store.get('lang', null));
let settings = normalizeSettings(store.get('settings', null));
let record = normalizeRecord(store.get('record', null));
let seed = newSeed();
let game = createGame({ seed, ...settings });
/** @type {Notice|null} */
let notice = null;
let aim = CENTER;
let showAim = false;
let pressedCell = -1;
let enemyTimer = 0;
let confirmTimer = 0;
let confirming = false;
let shownShots = 0;

const enemyView = createBoardView(byId('enemy-board'), 'enemy-cell');
const playerView = createBoardView(byId('player-board'), 'player-cell');
const setup = createSetup({
  board: playerView,
  harbor: byId('harbor'),
  getGame: () => game,
  onPreview: () => drawPlayerSea(game.getState()),
  onChange: () => {
    notice = null;
    render();
  },
  onRefuse: (reason) => {
    refuse(reason);
    playerView.shake();
  },
});

/**
 * @param {string} key
 * @param {Record<string, string|number>} [params]
 * @returns {string}
 */
function t(key, params) {
  return translate(lang, key, params);
}

/** @returns {number} A fresh uint32 seed. */
function newSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

/* ---------- game flow ---------- */

/** Throws the current game away and opens the setup of a new one. */
function newGame() {
  clearTimeout(enemyTimer);
  stopConfirm();
  seed = newSeed();
  game = createGame({ seed, ...settings });
  setup.reset();
  notice = null;
  aim = CENTER;
  showAim = false;
  persist();
  render();
}

function startBattle() {
  const outcome = game.start();
  if (!outcome.ok) {
    refuse(outcome.reason);
    playerView.shake();
    return;
  }
  notice = { key: 'battleStarted' };
  persist();
  render();
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

/**
 * Your shot at a cell of the enemy waters.
 * @param {number} index
 */
function playerFire(index) {
  if (game.getState().phase !== 'battle') return;
  const { row, col } = toCell(index);
  const shot = game.fire(row, col);
  if (!shot.ok) {
    refuse(shot.reason, index);
    enemyView.shake();
    return;
  }
  aim = index;
  afterShot(shot);
}

/**
 * Shows a shot that was just fired and hands the turn on.
 * @param {import('./game.js').ShotOutcome} shot
 */
function afterShot(shot) {
  notice = shotNotice(shot);
  persist();
  render();
  showImpact(shot);
  if (shot.gameOver) finish();
  else queueEnemy();
}

/** Lets the computer fire after a pause while it is its turn. */
function queueEnemy() {
  const state = game.getState();
  if (state.phase !== 'battle' || state.turn !== 'enemy') return;
  const inSalvo = state.log.at(-1)?.shooter === 'enemy';
  clearTimeout(enemyTimer);
  enemyTimer = setTimeout(() => {
    const shot = game.enemyFire();
    if (shot.ok) afterShot(shot);
  }, inSalvo ? SALVO_DELAY : ENEMY_DELAY);
}

function finish() {
  const won = game.getState().winner === 'player';
  record = won ? { ...record, wins: record.wins + 1 } : { ...record, losses: record.losses + 1 };
  if (!demo) store.set('record', record);
  render();
  ui.playAgain.focus({ preventScroll: true });
  ui.result.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

/** Keeps a battle in progress across reloads; the demo never touches the save. */
function persist() {
  if (demo) return;
  const state = game.getState();
  if (state.phase === 'battle') store.set('game', toSaved(seed, state));
  else store.remove('game');
}

/**
 * Splash, blast and, for a sunk ship, a flash along its whole hull.
 * @param {import('./game.js').ShotOutcome} shot
 */
function showImpact(shot) {
  const byPlayer = shot.shooter === 'player';
  const view = byPlayer ? enemyView : playerView;
  const index = toIndex(shot.row, shot.col);
  if (shot.result === 'miss') {
    view.effect(index, 'splash');
    return;
  }
  view.effect(index, 'blast');
  if (shot.result !== 'sunk') return;
  const state = game.getState();
  const ship = (byPlayer ? state.enemy : state.player).ships.find((candidate) => candidate.id === shot.shipId);
  shipCells(/** @type {import('./fleet.js').Ship} */ (ship)).forEach((cell, n) => view.effect(cell, 'sink', 150 + n * 80));
}

/**
 * Shows why an action was refused, when the reason has a message.
 * @param {string} reason
 * @param {number} [index] Cell concerned, for the message.
 */
function refuse(reason, index = -1) {
  const key = `err_${reason}`;
  if (Object.hasOwn(STRINGS.en, key)) notice = { key, params: index >= 0 ? { cell: cellName(index) } : {} };
  render();
}

/**
 * @param {{ shooter: string, row: number, col: number, result: string, shipId?: string|null }} shot
 * @returns {Notice}
 */
function shotNotice(shot) {
  const who = shot.shooter === 'player' ? 'you' : 'enemy';
  return { key: `${who}_${shot.result}`, params: { cell: cellName(toIndex(shot.row, shot.col)), ship: shot.shipId ?? '' } };
}

/**
 * Applies new settings during the setup. The game is rebuilt with the same
 * seed; ships that break a new rule go back to the harbor.
 * @param {Partial<import('./game.js').Settings>} change
 */
function changeSettings(change) {
  const state = game.getState();
  if (state.phase !== 'setup') return;
  settings = normalizeSettings({ ...settings, ...change });
  store.set('settings', settings);
  game = createGame({ seed, ...settings });
  const returned = state.player.ships.filter((ship) => !game.placeShip(ship.id, ship.row, ship.col, ship.vertical).ok);
  notice = returned.length > 0 ? { key: 'returned' } : null;
  render();
}

function toggleLanguage() {
  lang = lang === 'en' ? 'tr' : 'en';
  store.set('lang', lang);
  translatePage();
  render();
}

/** First press during a battle asks for confirmation; the second starts over. */
function pressNewGame() {
  const state = game.getState();
  if (state.phase === 'battle' && state.log.length > 0 && !confirming) {
    confirming = true;
    renderNewGame();
    confirmTimer = setTimeout(stopConfirm, CONFIRM_MS);
    return;
  }
  newGame();
}

function stopConfirm() {
  clearTimeout(confirmTimer);
  confirming = false;
  renderNewGame();
}

/* ---------- rendering ---------- */

function translatePage() {
  document.documentElement.lang = lang;
  document.title = t('title');
  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.textContent = t(/** @type {HTMLElement} */ (node).dataset.i18n);
  }
  for (const node of document.querySelectorAll('[data-i18n-label]')) {
    node.setAttribute('aria-label', t(/** @type {HTMLElement} */ (node).dataset.i18nLabel));
  }
}

function render() {
  const state = game.getState();
  ui.main.dataset.phase = state.phase;
  ui.main.dataset.turn = state.turn;
  drawEnemySea(state);
  drawPlayerSea(state);
  renderStatus(state);
  renderCounts(state);
  if (state.phase !== 'setup') {
    renderFleet(ui.enemyFleet, state.enemy.ships, t, false);
    renderFleet(ui.playerFleet, state.player.ships, t, true);
  }
  renderLog(ui.log, state.log, t, state.log.length > shownShots);
  shownShots = state.log.length;
  setup.update(state, t);
  ui.start.classList.toggle('is-waiting', state.unplaced.length > 0);
  renderSettings();
  renderRules(state.settings);
  renderResult(state);
  renderNewGame();
}

/**
 * @param {import('./game.js').GameState} state
 */
function drawEnemySea(state) {
  const water = knownWater(state.enemy, state.settings.touching);
  const marks = state.enemy.marks;
  enemyView.draw({
    marks,
    ships: state.enemy.ships
      .filter((ship) => Number.isInteger(ship.row))
      .map((ship) => ({ ...ship, look: ship.sunk ? 'wreck' : 'revealed' })),
    water,
    aim: showAim && state.phase === 'battle' ? aim : -1,
    last: lastShot(state.log, 'player'),
    label: t('boardEnemy'),
    cellLabel: (index) => describeCell(index, marks[index], water.has(index), null),
  });
}

/**
 * @param {import('./game.js').GameState} state
 */
function drawPlayerSea(state) {
  const owners = new Map();
  for (const ship of state.player.ships) {
    for (const cell of shipCells(/** @type {import('./fleet.js').Ship} */ (ship))) owners.set(cell, ship.id);
  }
  const marks = state.player.marks;
  const common = {
    marks,
    label: t('boardPlayer'),
    cellLabel: (index) => describeCell(index, marks[index], false, owners.get(index) ?? null),
  };
  if (state.phase === 'setup') {
    playerView.draw({ ...common, ...setup.picture(state) });
    return;
  }
  playerView.draw({
    ...common,
    ships: state.player.ships.map((ship) => ({ ...ship, look: ship.sunk ? 'wreck' : 'own' })),
    last: lastShot(state.log, 'enemy'),
  });
}

/**
 * Accessible name of a cell: "C5", then what is known about it.
 * @param {number} index
 * @param {number} mark
 * @param {boolean} clear Known to be empty water.
 * @param {string|null} shipId Your ship on it, if any.
 * @returns {string}
 */
function describeCell(index, mark, clear, shipId) {
  const parts = [cellName(index)];
  if (shipId) parts.push(t('cellShip', { ship: t(`ship_${shipId}`) }));
  if (mark === MARK.MISS) parts.push(t('markMiss'));
  else if (mark === MARK.HIT) parts.push(t('markHit'));
  else if (mark === MARK.SUNK) parts.push(t('markSunk'));
  else if (clear) parts.push(t('markWater'));
  return parts.join(', ');
}

/**
 * @param {readonly import('./game.js').LogEntry[]} log
 * @param {'player'|'enemy'} shooter
 * @returns {number} Cell of that side's latest shot, -1 before its first one.
 */
function lastShot(log, shooter) {
  for (let n = log.length - 1; n >= 0; n -= 1) {
    if (log[n].shooter === shooter) return toIndex(log[n].row, log[n].col);
  }
  return -1;
}

/**
 * @param {import('./game.js').GameState} state
 */
function renderStatus(state) {
  ui.pill.className = `pill pill--${state.phase === 'battle' ? state.turn : state.phase}`;
  ui.pill.textContent = pillText(state);
  const salvoTurn = state.phase === 'battle' && state.turn === 'player' && state.settings.salvo;
  ui.shots.hidden = !salvoTurn;
  ui.shots.textContent = salvoTurn ? t('shotsLeft', { count: state.shotsLeft }) : '';
  ui.message.textContent = notice ? noticeText(notice) : promptText(state);
}

/**
 * @param {import('./game.js').GameState} state
 * @returns {string}
 */
function pillText(state) {
  if (state.phase === 'setup') return t('pillSetup');
  if (state.phase === 'over') return t('pillOver');
  return state.turn === 'player' ? t('pillYou') : t('pillEnemy');
}

/**
 * @param {Notice} shown
 * @returns {string}
 */
function noticeText({ key, params = {} }) {
  const values = { ...params };
  if (values.ship) values.ship = t(`ship_${values.ship}`);
  return t(key, values);
}

/**
 * What to do next, when no event has something to say.
 * @param {import('./game.js').GameState} state
 * @returns {string}
 */
function promptText(state) {
  if (state.phase === 'over') return state.winner === 'player' ? t('winTitle') : t('loseTitle');
  if (state.phase === 'battle') return state.turn === 'player' ? t('promptFire') : t('enemyAiming');
  if (state.unplaced.length === 0) return t('fleetReady');
  const selected = FLEET.find((type) => type.id === setup.selected() && state.unplaced.includes(type.id));
  return selected
    ? t('placeSelected', { ship: t(`ship_${selected.id}`), size: selected.size })
    : t('placeShips', { count: state.unplaced.length });
}

/**
 * @param {import('./game.js').GameState} state
 */
function renderCounts(state) {
  const total = FLEET.length;
  const afloat = (sea) => sea.ships.filter((ship) => !ship.sunk).length;
  ui.playerCount.textContent = state.phase === 'setup'
    ? t('placedCount', { count: total - state.unplaced.length, total })
    : t('afloatCount', { count: afloat(state.player), total });
  ui.enemyCount.textContent = t('afloatCount', { count: afloat(state.enemy), total });
}

function renderSettings() {
  for (const input of aiInputs) input.checked = input.value === settings.ai;
  ui.salvo.checked = settings.salvo;
  ui.touching.checked = settings.touching;
  ui.aiHint.textContent = t(`aiHint_${settings.ai}`);
}

/**
 * One line with the rules of the game being played.
 * @param {import('./game.js').Settings} rules
 */
function renderRules(rules) {
  ui.rules.textContent = [
    t('rulesAi', { level: t(`ai_${rules.ai}`) }),
    rules.salvo ? t('rulesSalvo') : t('rulesSingle'),
    rules.touching ? t('rulesTouch') : t('rulesApart'),
  ].join(' · ');
}

/**
 * @param {import('./game.js').GameState} state
 */
function renderResult(state) {
  ui.result.hidden = state.phase !== 'over';
  if (state.phase !== 'over') return;
  const won = state.winner === 'player';
  const stats = shotStats(state.log, 'player');
  const params = { shots: stats.shots, accuracy: stats.accuracy };
  ui.result.classList.toggle('is-win', won);
  ui.resultTitle.textContent = won ? t('winTitle') : t('loseTitle');
  ui.resultText.textContent = won ? t('winText', params) : t('loseText', params);
  ui.resultRecord.textContent = t('record', record);
}

function renderNewGame() {
  ui.newGame.textContent = confirming ? t('confirmNew') : t('newGame');
  ui.newGame.classList.toggle('is-confirming', confirming);
}

/* ---------- input ---------- */

/** Taps, clicks and keys on the enemy waters. */
function bindEnemySea() {
  const board = enemyView.element;
  board.addEventListener('pointerdown', (event) => {
    pressedCell = event.isPrimary && event.button === 0 ? enemyView.cellAt(event.clientX, event.clientY) : -1;
  });
  board.addEventListener('pointerup', (event) => {
    const index = enemyView.cellAt(event.clientX, event.clientY);
    const tapped = event.isPrimary && index >= 0 && index === pressedCell;
    pressedCell = -1;
    if (!tapped) return;
    showAim = false;
    playerFire(index);
  });
  board.addEventListener('pointercancel', () => {
    pressedCell = -1;
  });
  board.addEventListener('keydown', aimWithKeys);
  board.addEventListener('focus', () => {
    if (!board.matches(':focus-visible')) return;
    showAim = true;
    drawEnemySea(game.getState());
  });
  board.addEventListener('blur', () => {
    showAim = false;
    drawEnemySea(game.getState());
  });
}

/**
 * Arrows move the aim, Enter or Space fires.
 * @param {KeyboardEvent} event
 */
function aimWithKeys(event) {
  if (event.altKey || event.ctrlKey || event.metaKey || game.getState().phase !== 'battle') return;
  const fire = event.key === 'Enter' || event.key === ' ';
  if (!fire && !isArrowKey(event.key)) return;
  event.preventDefault();
  showAim = true;
  if (fire) {
    playerFire(aim);
    return;
  }
  aim = stepCursor(aim, event.key);
  drawEnemySea(game.getState());
}

/**
 * Keys pressed while nothing has focus go to the sea of the current phase,
 * so arrows work at once without tabbing to a board first.
 * @param {KeyboardEvent} event
 */
function keyFromPage(event) {
  if (event.target !== document.body || event.altKey || event.ctrlKey || event.metaKey) return;
  const { phase } = game.getState();
  if (!PAGE_KEYS[phase]?.has(event.key)) return;
  event.preventDefault();
  const board = phase === 'battle' ? enemyView.element : playerView.element;
  board.focus();
  board.dispatchEvent(new KeyboardEvent('keydown', { key: event.key, bubbles: true, cancelable: true }));
}

function bindControls() {
  ui.newGame.addEventListener('click', pressNewGame);
  ui.lang.addEventListener('click', toggleLanguage);
  ui.rotate.addEventListener('click', () => setup.rotate());
  ui.random.addEventListener('click', () => setup.randomize());
  ui.clear.addEventListener('click', () => setup.clear());
  ui.start.addEventListener('click', startBattle);
  ui.playAgain.addEventListener('click', newGame);
  for (const input of aiInputs) {
    input.addEventListener('change', () => changeSettings({ ai: /** @type {any} */ (input.value) }));
  }
  ui.salvo.addEventListener('change', () => changeSettings({ salvo: ui.salvo.checked }));
  ui.touching.addEventListener('change', () => changeSettings({ touching: ui.touching.checked }));
  document.addEventListener('keydown', keyFromPage);
  bindEnemySea();
}

/** Starts the page: the demo position, a saved battle, or a new setup. */
function boot() {
  bindControls();
  translatePage();
  if (demo) {
    game = createDemoGame();
    aim = DEMO_AIM;
    showAim = true;
  } else {
    const saved = fromSaved(store.get('game', null));
    if (saved) ({ game, seed } = saved);
  }
  const latest = game.getState().log.at(-1);
  if (latest) notice = shotNotice(latest);
  render();
  queueEnemy();
}

boot();
