/**
 * Ship drawings: a rounded steel hull with a deck, a bridge and turrets,
 * built from SVG elements. Colours come from style.css, so the same drawing
 * serves your ships, wrecks, revealed ships and placement previews.
 * @module hull
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @param {string} name
 * @param {Record<string, string|number>} [attributes]
 * @returns {SVGElement}
 */
function svgElement(name, attributes = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

/**
 * Outline of a hull `length` units long and 100 units wide, bow at the left.
 * @param {number} length
 * @returns {string}
 */
function bodyPath(length) {
  const end = length - 4;
  return `M4 50C14 30 34 18 70 18H${end - 14}Q${end} 18 ${end} 32V68Q${end} 82 ${end - 14} 82`
    + 'H70C34 82 14 70 4 50Z';
}

/**
 * The deck: a lighter band inside the outline.
 * @param {number} length
 * @returns {string}
 */
function deckPath(length) {
  const end = length - 14;
  return `M20 50C28 37 44 30 72 30H${end - 8}Q${end} 30 ${end} 38V62Q${end} 70 ${end - 8} 70`
    + 'H72C44 70 28 63 20 50Z';
}

/**
 * A hatch on the bow, the bridge mid-ship and a turret on every other cell,
 * guns pointing away from the bridge.
 * @param {number} size
 * @returns {SVGElement[]}
 */
function fittings(size) {
  const bridge = Math.max(1, Math.floor(size / 2));
  const parts = [svgElement('circle', { class: 'hull-hatch', cx: 56, cy: 50, r: 6 })];
  for (let cell = 1; cell < size; cell += 1) {
    const x = cell * 100 + 50;
    if (cell === bridge) {
      parts.push(
        svgElement('rect', { class: 'hull-bridge', x: x - 26, y: 34, width: 52, height: 32, rx: 9 }),
        svgElement('circle', { class: 'hull-mast', cx: x - 6, cy: 50, r: 6 }),
      );
    } else {
      const gunX = cell < bridge ? x - 36 : x;
      parts.push(
        svgElement('rect', { class: 'hull-gun', x: gunX, y: 46, width: 36, height: 8, rx: 4 }),
        svgElement('circle', { class: 'hull-turret', cx: x, cy: 50, r: 13 }),
      );
    }
  }
  return parts;
}

/**
 * Draws a ship `size` cells long, bow first: horizontal ships point left,
 * vertical ones point up, matching the bow at (row, col).
 * @param {number} size
 * @param {boolean} vertical
 * @returns {SVGSVGElement}
 */
export function createHull(size, vertical) {
  const length = size * 100;
  const svg = svgElement('svg', {
    class: 'hull',
    viewBox: vertical ? `0 0 100 ${length}` : `0 0 ${length} 100`,
    'aria-hidden': 'true',
    focusable: 'false',
  });
  // Swapping x and y turns the horizontal drawing into a vertical one.
  const group = svgElement('g', vertical ? { transform: 'matrix(0 1 1 0 0 0)' } : {});
  group.append(
    svgElement('path', { class: 'hull-body', d: bodyPath(length) }),
    svgElement('path', { class: 'hull-deck', d: deckPath(length) }),
    ...fittings(size),
  );
  svg.append(group);
  return /** @type {SVGSVGElement} */ (svg);
}
