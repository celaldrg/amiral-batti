/**
 * Seeded pseudo-random numbers. Every random choice in the game goes through
 * an Rng created here, so one seed fully determines a game.
 * @module rng
 */

/**
 * A random source returning floats in [0, 1).
 * @typedef {() => number} Rng
 */

/**
 * Creates a deterministic generator (mulberry32).
 * @param {number} seed Any number; its low 32 bits are used.
 * @returns {Rng}
 */
export function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derives an independent seed from a base seed and a salt, so a single game
 * seed can feed several random streams that do not influence each other.
 * @param {number} seed
 * @param {number} salt
 * @returns {number} Unsigned 32-bit integer.
 */
export function deriveSeed(seed, salt) {
  let hash = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

/**
 * Returns a uniformly chosen element of a non-empty array.
 * @template T
 * @param {Rng} rng
 * @param {readonly T[]} items
 * @returns {T}
 */
export function pick(rng, items) {
  return items[Math.floor(rng() * items.length)];
}

/**
 * Shuffles an array in place (Fisher-Yates) and returns it.
 * @template T
 * @param {Rng} rng
 * @param {T[]} items
 * @returns {T[]}
 */
export function shuffle(rng, items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
