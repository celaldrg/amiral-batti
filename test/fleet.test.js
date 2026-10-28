import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FLEET, SIZE, allPlacements, checkPlacement, haloCells, isOnSea, neighbors,
  randomFleet, shipCells, toCell, toIndex, validateFleet,
} from '../src/fleet.js';
import { createRng } from '../src/rng.js';

const ship = (id, size, row, col, vertical = false) => ({ id, size, row, col, vertical });
const sorted = (cells) => [...cells].sort((a, b) => a - b);

/** A legal fleet: one ship on every other row, all at the left edge. */
const ROWS_FLEET = FLEET.map((type, n) => ship(type.id, type.size, n * 2, 0));

/** Checks a fleet against the rules without using the code under test. */
function assertLegalFleet(ships, touching) {
  assert.deepEqual(ships.map((s) => [s.id, s.size]), FLEET.map((t) => [t.id, t.size]));
  const owner = new Map();
  for (const s of ships) {
    for (let k = 0; k < s.size; k += 1) {
      const row = s.row + (s.vertical ? k : 0);
      const col = s.col + (s.vertical ? 0 : k);
      assert.ok(row >= 0 && row < SIZE && col >= 0 && col < SIZE, `${s.id} leaves the sea`);
      assert.ok(!owner.has(`${row},${col}`), `${s.id} overlaps another ship`);
      owner.set(`${row},${col}`, s.id);
    }
  }
  assert.equal(owner.size, 17);
  if (!touching) assert.equal(touchingPairs(owner), 0, 'ships touch');
}

/** Number of neighbouring cell pairs (sides or corners) that belong to different ships. */
function touchingPairs(owner) {
  let pairs = 0;
  for (const [key, id] of owner) {
    const [row, col] = key.split(',').map(Number);
    for (const dr of [-1, 0, 1]) {
      for (const dc of [-1, 0, 1]) {
        const other = owner.get(`${row + dr},${col + dc}`);
        if (other !== undefined && other !== id) pairs += 1;
      }
    }
  }
  return pairs;
}

function ownerMap(ships) {
  const owner = new Map();
  for (const s of ships) {
    for (const cell of shipCells(s)) {
      const { row, col } = toCell(cell);
      owner.set(`${row},${col}`, s.id);
    }
  }
  return owner;
}

describe('fleet definition and geometry', () => {
  it('has five ships of 5, 4, 3, 3 and 2 cells (17 in total)', () => {
    assert.deepEqual(FLEET.map((type) => type.size), [5, 4, 3, 3, 2]);
    assert.equal(new Set(FLEET.map((type) => type.id)).size, 5);
    assert.ok(Object.isFrozen(FLEET) && Object.isFrozen(FLEET[0]));
  });

  it('converts between (row, col) and cell indices', () => {
    assert.equal(toIndex(3, 7), 37);
    assert.deepEqual(toCell(37), { row: 3, col: 7 });
    assert.deepEqual(toCell(toIndex(9, 0)), { row: 9, col: 0 });
  });

  it('knows which cells are on the sea', () => {
    assert.ok(isOnSea(0, 0) && isOnSea(9, 9));
    for (const [row, col] of [[-1, 0], [0, -1], [10, 0], [0, 10], [1.5, 2], [Number.NaN, 0]]) {
      assert.equal(isOnSea(row, col), false, `${row},${col}`);
    }
  });

  it('lists neighbours with or without corners', () => {
    assert.deepEqual(sorted(neighbors(0)), [1, 10]);
    assert.deepEqual(sorted(neighbors(0, true)), [1, 10, 11]);
    assert.deepEqual(sorted(neighbors(55)), [45, 54, 56, 65]);
    assert.equal(neighbors(55, true).length, 8);
    assert.deepEqual(sorted(neighbors(99, true)), [88, 89, 98]);
  });

  it('computes the cells of horizontal and vertical ships', () => {
    assert.deepEqual(shipCells(ship('corvette', 3, 2, 3)), [23, 24, 25]);
    assert.deepEqual(shipCells(ship('corvette', 3, 2, 3, true)), [23, 33, 43]);
  });

  it('computes the halo around a ship, clipped to the sea', () => {
    assert.deepEqual(sorted(haloCells(shipCells(ship('patrol', 2, 0, 0)))), [2, 10, 11, 12]);
    assert.equal(haloCells(shipCells(ship('corvette', 3, 4, 4))).length, 12);
  });

  it('enumerates every position of a ship on an empty sea', () => {
    assert.equal(allPlacements(5).length, 2 * 10 * 6);
    assert.equal(allPlacements(2).length, 2 * 10 * 9);
    for (const spot of allPlacements(4)) {
      assert.equal(checkPlacement([], { id: 'x', size: 4, ...spot }), null);
      assert.ok(spot.halo.every((cell) => !spot.cells.includes(cell)));
    }
    assert.equal(allPlacements(3), allPlacements(3), 'cached');
  });
});

describe('placement validation', () => {
  const frigate = ship('frigate', 4, 2, 2); // cells (2,2) to (2,5)

  it('rejects ships that leave the sea', () => {
    for (const candidate of [
      ship('patrol', 2, 0, 9),
      ship('patrol', 2, 9, 0, true),
      ship('patrol', 2, -1, 0),
      ship('patrol', 2, 0, -1),
      ship('flagship', 5, 0, 6),
      ship('flagship', 5, 6, 0, true),
      ship('patrol', 2, 1.5, 0),
    ]) {
      assert.equal(checkPlacement([], candidate), 'bounds', JSON.stringify(candidate));
    }
    assert.equal(checkPlacement([], ship('flagship', 5, 0, 5)), null);
    assert.equal(checkPlacement([], ship('flagship', 5, 5, 0, true)), null);
  });

  it('rejects overlapping ships', () => {
    assert.equal(checkPlacement([frigate], ship('patrol', 2, 1, 3, true)), 'overlap');
    assert.equal(checkPlacement([frigate], ship('corvette', 3, 2, 5)), 'overlap');
    assert.equal(checkPlacement([frigate], ship('patrol', 2, 1, 3, true), { touching: true }), 'overlap');
  });

  it('rejects ships touching by a side, an end or a corner', () => {
    assert.equal(checkPlacement([frigate], ship('patrol', 2, 3, 2)), 'touch'); // side by side
    assert.equal(checkPlacement([frigate], ship('patrol', 2, 2, 6)), 'touch'); // end to end
    assert.equal(checkPlacement([frigate], ship('patrol', 2, 3, 6)), 'touch'); // corner
    assert.equal(checkPlacement([frigate], ship('patrol', 2, 0, 1, true)), 'touch'); // corner above
    assert.equal(checkPlacement([frigate], ship('patrol', 2, 4, 2)), null); // one row of water between
    assert.equal(checkPlacement([frigate], ship('patrol', 2, 2, 7)), null); // one cell of water between
  });

  it('lets ships touch when the setting allows it', () => {
    const rules = { touching: true };
    assert.equal(checkPlacement([frigate], ship('patrol', 2, 3, 2), rules), null);
    assert.equal(checkPlacement([frigate], ship('patrol', 2, 2, 6), rules), null);
    assert.equal(checkPlacement([frigate], ship('patrol', 2, 3, 6), rules), null);
    assert.equal(checkPlacement([frigate], ship('patrol', 2, 9, 9), rules), 'bounds');
  });

  it('validates a complete fleet', () => {
    assert.deepEqual(validateFleet(ROWS_FLEET), { ok: true });
    assert.deepEqual(validateFleet(ROWS_FLEET.slice(1)).reason, 'composition');
    assert.deepEqual(validateFleet([...ROWS_FLEET.slice(0, 4), { ...ROWS_FLEET[3] }]).reason, 'composition');
    assert.deepEqual(validateFleet([...ROWS_FLEET.slice(0, 4), { ...ROWS_FLEET[4], size: 3 }]).reason, 'composition');
    assert.deepEqual(validateFleet([...ROWS_FLEET, ship('extra', 2, 9, 8)]).reason, 'composition');
  });

  it('reports which ship breaks the rules', () => {
    const touchingFleet = ROWS_FLEET.map((s) => (s.id === 'frigate' ? { ...s, row: 1 } : s));
    assert.deepEqual(validateFleet(touchingFleet), { ok: false, reason: 'touch', id: 'frigate' });
    assert.deepEqual(validateFleet(touchingFleet, { touching: true }), { ok: true });
    const outside = ROWS_FLEET.map((s) => (s.id === 'patrol' ? { ...s, col: 9 } : s));
    assert.deepEqual(validateFleet(outside), { ok: false, reason: 'bounds', id: 'patrol' });
    const overlapping = ROWS_FLEET.map((s) => (s.id === 'patrol' ? { ...s, row: 0, col: 3 } : s));
    assert.deepEqual(validateFleet(overlapping, { touching: true }), { ok: false, reason: 'overlap', id: 'patrol' });
  });
});

describe('random fleets', () => {
  it('1000 seeded fleets follow the rules when ships may not touch', () => {
    for (let seed = 0; seed < 1000; seed += 1) {
      const ships = randomFleet(createRng(seed));
      assertLegalFleet(ships, false);
      assert.deepEqual(validateFleet(ships), { ok: true }, `seed ${seed}`);
    }
  });

  it('1000 seeded fleets follow the rules when ships may touch', () => {
    let fleetsWithContact = 0;
    for (let seed = 0; seed < 1000; seed += 1) {
      const ships = randomFleet(createRng(seed), { touching: true });
      assertLegalFleet(ships, true);
      assert.deepEqual(validateFleet(ships, { touching: true }), { ok: true }, `seed ${seed}`);
      if (touchingPairs(ownerMap(ships)) > 0) fleetsWithContact += 1;
    }
    assert.ok(fleetsWithContact > 100, `only ${fleetsWithContact} fleets had touching ships`);
  });

  it('is repeatable for a seed and varied across seeds', () => {
    assert.deepEqual(randomFleet(createRng(123)), randomFleet(createRng(123)));
    const layouts = new Set();
    for (let seed = 0; seed < 1000; seed += 1) layouts.add(JSON.stringify(randomFleet(createRng(seed))));
    assert.ok(layouts.size >= 995, `only ${layouts.size} distinct layouts`);
  });
});
