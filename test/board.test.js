import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MARK, afloatCount, createBoard, fireAt, isDefeated, viewOf } from '../src/board.js';
import { FLEET, shipCells, toIndex } from '../src/fleet.js';

/** One ship on every other row, all at the left edge. */
const SHIPS = FLEET.map((type, n) => ({ id: type.id, size: type.size, row: n * 2, col: 0, vertical: false }));
const cellsOf = (id) => shipCells(SHIPS.find((ship) => ship.id === id));

describe('board: hit, miss, sunk and defeat', () => {
  it('records a miss on open water', () => {
    const board = createBoard(SHIPS);
    assert.deepEqual(fireAt(board, toIndex(1, 0)), { result: 'miss', shipId: null });
    assert.equal(board.marks[toIndex(1, 0)], MARK.MISS);
  });

  it('records hits, then sinks a ship when its last cell is hit', () => {
    const board = createBoard(SHIPS);
    const [first, second, third] = cellsOf('corvette');
    assert.deepEqual(fireAt(board, first), { result: 'hit', shipId: 'corvette' });
    assert.deepEqual(fireAt(board, third), { result: 'hit', shipId: 'corvette' });
    assert.equal(board.marks[first], MARK.HIT);
    assert.equal(board.marks[second], MARK.NONE);
    assert.deepEqual(fireAt(board, second), { result: 'sunk', shipId: 'corvette' });
    for (const cell of cellsOf('corvette')) assert.equal(board.marks[cell], MARK.SUNK);
  });

  it('refuses a second shot at the same cell and cells off the sea', () => {
    const board = createBoard(SHIPS);
    fireAt(board, 55);
    assert.throws(() => fireAt(board, 55), RangeError);
    fireAt(board, cellsOf('patrol')[0]);
    assert.throws(() => fireAt(board, cellsOf('patrol')[0]), RangeError);
    for (const index of [-1, 100, 2.5, Number.NaN]) assert.throws(() => fireAt(board, index), RangeError);
  });

  it('counts the ships afloat and detects a defeated fleet', () => {
    const board = createBoard(SHIPS);
    const allCells = SHIPS.flatMap((ship) => shipCells(ship));
    assert.equal(afloatCount(board), 5);
    for (const cell of cellsOf('patrol')) fireAt(board, cell);
    assert.equal(afloatCount(board), 4);
    const rest = allCells.filter((cell) => board.marks[cell] === MARK.NONE);
    for (const cell of rest.slice(0, -1)) fireAt(board, cell);
    assert.equal(isDefeated(board), false, 'one cell is still afloat');
    assert.equal(afloatCount(board), 1);
    assert.equal(fireAt(board, rest.at(-1)).result, 'sunk');
    assert.equal(isDefeated(board), true);
  });

  it('gives a shooter the marks and remaining sizes, never ship positions', () => {
    const board = createBoard(SHIPS);
    for (const cell of cellsOf('gunboat')) fireAt(board, cell);
    fireAt(board, cellsOf('flagship')[0]);
    const view = viewOf(board);
    assert.deepEqual(Object.keys(view).sort(), ['marks', 'remaining']);
    assert.deepEqual(view.remaining, [5, 4, 3, 2]);
    assert.equal(view.marks[cellsOf('flagship')[0]], MARK.HIT);
    assert.equal(view.marks[cellsOf('gunboat')[1]], MARK.SUNK);
  });

  it('copies the fleet it is given', () => {
    const ships = SHIPS.map((ship) => ({ ...ship }));
    const board = createBoard(ships);
    ships[0].row = 9;
    assert.equal(board.ships[0].row, 0);
  });
});
