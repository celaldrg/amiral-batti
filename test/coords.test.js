import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bowFor, cellName, columnName, isArrowKey, middleOf, segmentAt, shipAt, stepCursor,
} from '../src/coords.js';
import { FLEET, SIZE, shipCells, toIndex } from '../src/fleet.js';

describe('cell names', () => {
  it('uses column letters A-J and row numbers 1-10', () => {
    assert.equal(columnName(0), 'A');
    assert.equal(columnName(9), 'J');
    assert.equal(cellName(toIndex(0, 0)), 'A1');
    assert.equal(cellName(toIndex(4, 2)), 'C5');
    assert.equal(cellName(toIndex(9, 9)), 'J10');
  });

  it('gives every cell a different name', () => {
    const names = new Set(Array.from({ length: SIZE * SIZE }, (_, index) => cellName(index)));
    assert.equal(names.size, SIZE * SIZE);
  });
});

describe('keyboard cursor', () => {
  it('moves one cell per arrow key', () => {
    const start = toIndex(4, 4);
    assert.equal(stepCursor(start, 'ArrowUp'), toIndex(3, 4));
    assert.equal(stepCursor(start, 'ArrowDown'), toIndex(5, 4));
    assert.equal(stepCursor(start, 'ArrowLeft'), toIndex(4, 3));
    assert.equal(stepCursor(start, 'ArrowRight'), toIndex(4, 5));
  });

  it('stops at the edges and ignores other keys', () => {
    assert.equal(stepCursor(toIndex(0, 0), 'ArrowUp'), toIndex(0, 0));
    assert.equal(stepCursor(toIndex(0, 0), 'ArrowLeft'), toIndex(0, 0));
    assert.equal(stepCursor(toIndex(9, 9), 'ArrowDown'), toIndex(9, 9));
    assert.equal(stepCursor(toIndex(9, 9), 'ArrowRight'), toIndex(9, 9));
    assert.equal(stepCursor(toIndex(2, 3), 'Enter'), toIndex(2, 3));
    assert.equal(isArrowKey('ArrowUp'), true);
    assert.equal(isArrowKey('w'), false);
    assert.equal(isArrowKey('toString'), false);
  });
});

describe('pointing at a cell to place a ship', () => {
  it('holds ships by their middle segment', () => {
    assert.deepEqual(FLEET.map((type) => middleOf(type.size)), [2, 1, 1, 1, 0]);
  });

  it('puts the anchor segment on the cell', () => {
    assert.deepEqual(bowFor(5, false, toIndex(3, 4), 2), { row: 3, col: 2 });
    assert.deepEqual(bowFor(4, true, toIndex(5, 7), 1), { row: 4, col: 7 });
    assert.deepEqual(bowFor(2, false, toIndex(6, 6), 0), { row: 6, col: 6 });
  });

  it('pulls a ship that would stick out back onto the sea', () => {
    assert.deepEqual(bowFor(5, false, toIndex(0, 9), 2), { row: 0, col: 5 });
    assert.deepEqual(bowFor(5, false, toIndex(0, 0), 2), { row: 0, col: 0 });
    assert.deepEqual(bowFor(4, true, toIndex(9, 0), 1), { row: 6, col: 0 });
    assert.deepEqual(bowFor(3, true, toIndex(0, 3), 2), { row: 0, col: 3 });
    for (let index = 0; index < SIZE * SIZE; index += 1) {
      for (const vertical of [false, true]) {
        const { row, col } = bowFor(5, vertical, index, 2);
        const end = vertical ? row + 4 : col + 4;
        assert.ok(row >= 0 && col >= 0 && end < SIZE, `cell ${index} keeps the ship on the sea`);
      }
    }
  });

  it('finds the ship on a cell and the segment that was grabbed', () => {
    const ships = [
      { id: 'frigate', size: 4, row: 2, col: 3, vertical: false },
      { id: 'patrol', size: 2, row: 6, col: 8, vertical: true },
    ];
    assert.equal(shipAt(ships, toIndex(2, 5))?.id, 'frigate');
    assert.equal(shipAt(ships, toIndex(7, 8))?.id, 'patrol');
    assert.equal(shipAt(ships, toIndex(3, 3)), null);
    assert.deepEqual(shipCells(ships[0]).map((cell) => segmentAt(ships[0], cell)), [0, 1, 2, 3]);
    assert.equal(segmentAt(ships[1], toIndex(7, 8)), 1);
  });
});
