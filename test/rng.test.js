import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, deriveSeed, pick, shuffle } from '../src/rng.js';

const take = (rng, count) => Array.from({ length: count }, () => rng());
const range = (count) => Array.from({ length: count }, (_, i) => i);

describe('rng', () => {
  it('repeats the same sequence for the same seed', () => {
    assert.deepEqual(take(createRng(42), 50), take(createRng(42), 50));
  });

  it('gives different sequences for different seeds', () => {
    assert.notDeepEqual(take(createRng(1), 10), take(createRng(2), 10));
  });

  it('returns floats in [0, 1) with a mean close to 0.5', () => {
    const values = take(createRng(7), 20000);
    for (const value of values) assert.ok(value >= 0 && value < 1, `out of range: ${value}`);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    assert.ok(Math.abs(mean - 0.5) < 0.01, `mean ${mean}`);
  });

  it('derives repeatable, distinct seeds from one seed', () => {
    assert.equal(deriveSeed(5, 1), deriveSeed(5, 1));
    assert.equal(new Set(range(50).map((salt) => deriveSeed(5, salt))).size, 50);
    assert.notEqual(deriveSeed(5, 1), deriveSeed(6, 1));
  });

  it('shuffles into a permutation, the same way for the same seed', () => {
    const shuffled = shuffle(createRng(3), range(30));
    assert.deepEqual([...shuffled].sort((a, b) => a - b), range(30));
    assert.notDeepEqual(shuffled, range(30));
    assert.deepEqual(shuffled, shuffle(createRng(3), range(30)));
  });

  it('picks every element of a list eventually', () => {
    const rng = createRng(9);
    const seen = new Set(range(100).map(() => pick(rng, ['a', 'b', 'c'])));
    assert.deepEqual([...seen].sort(), ['a', 'b', 'c']);
  });
});
