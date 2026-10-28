/**
 * Side panels next to the seas: the fleet status lists and the log of
 * recent shots. Both are rebuilt from the game state on every render.
 * @module panels
 */
import { FLEET, toIndex } from './fleet.js';
import { cellName } from './coords.js';
import { element } from './dom.js';

/** Shots listed in the log, newest first. */
const LOG_LENGTH = 12;

/**
 * @typedef {(key: string, params?: Record<string, string|number>) => string} Translate
 */

/**
 * Lists the ships of one side with a square per cell and their state.
 * @param {HTMLElement} list An empty or previously rendered list element.
 * @param {import('./game.js').ShipState[]} ships
 * @param {Translate} t
 * @param {boolean} showHits True for your own fleet, whose hits you know.
 */
export function renderFleet(list, ships, t, showHits) {
  const items = FLEET.map((type) => {
    const ship = ships.find((candidate) => candidate.id === type.id);
    const hits = ship?.sunk ? type.size : (showHits && ship?.hits) || 0;
    const item = element('li', 'fleet-item');
    item.classList.toggle('is-sunk', Boolean(ship?.sunk));
    item.classList.toggle('is-hit', !ship?.sunk && hits > 0);
    const pips = element('span', 'fleet-pips');
    pips.setAttribute('aria-hidden', 'true');
    for (let n = 0; n < type.size; n += 1) pips.append(element('span', n < hits ? 'pip is-hit' : 'pip'));
    item.append(pips, element('span', 'fleet-name', t(`ship_${type.id}`)), element('span', 'fleet-state', shipState(ship, hits, type.size, t)));
    return item;
  });
  list.replaceChildren(...items);
}

/**
 * @param {import('./game.js').ShipState|undefined} ship
 * @param {number} hits Known hits.
 * @param {number} size
 * @param {Translate} t
 * @returns {string}
 */
function shipState(ship, hits, size, t) {
  if (ship?.sunk) return t('stateSunk');
  return hits > 0 ? t('stateHits', { hits, size }) : t('stateAfloat');
}

/**
 * Shows the latest shots, newest first.
 * @param {HTMLElement} list
 * @param {readonly import('./game.js').LogEntry[]} log
 * @param {Translate} t
 * @param {boolean} fresh True when the newest entry was just added: it animates in.
 */
export function renderLog(list, log, t, fresh) {
  if (log.length === 0) {
    list.replaceChildren(element('li', 'log-empty', t('logEmpty')));
    return;
  }
  const items = log.slice(-LOG_LENGTH).reverse().map((entry, n) => {
    const item = element('li', `log-entry log--${entry.shooter} is-${entry.result}`);
    if (fresh && n === 0) item.classList.add('is-fresh');
    const who = entry.shooter === 'player' ? t('whoYou') : t('whoEnemy');
    const ship = entry.shipId ? t(`ship_${entry.shipId}`) : '';
    item.append(
      element('span', 'log-who', who),
      element('span', 'log-cell', cellName(toIndex(entry.row, entry.col))),
      element('span', 'log-result', t(`res_${entry.result}`, { ship })),
    );
    return item;
  });
  list.replaceChildren(...items);
}
