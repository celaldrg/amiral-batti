import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/storage.js';

/** A minimal Storage stand-in backed by a Map. */
function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

describe('storage helper', () => {
  it('saves and reads JSON values under a prefix', () => {
    const storage = memoryStorage();
    const store = createStore('game:', () => storage);
    assert.equal(store.set('settings', { ai: 'hard' }), true);
    assert.deepEqual(store.get('settings', null), { ai: 'hard' });
    assert.deepEqual([...storage.data.keys()], ['game:settings']);
    store.remove('settings');
    assert.equal(store.get('settings', 'none'), 'none');
  });

  it('returns the fallback for missing or unreadable values', () => {
    const storage = memoryStorage();
    storage.setItem('game:broken', '{not json');
    const store = createStore('game:', () => storage);
    assert.equal(store.get('missing', 7), 7);
    assert.equal(store.get('broken', 'fallback'), 'fallback');
  });

  it('never throws when storage is blocked or full', () => {
    const blocked = createStore('game:', () => {
      throw new Error('SecurityError: access denied');
    });
    assert.equal(blocked.get('lang', 'en'), 'en');
    assert.equal(blocked.set('lang', 'tr'), false);
    assert.doesNotThrow(() => blocked.remove('lang'));

    const full = createStore('game:', () => ({
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => { throw new Error('QuotaExceededError'); },
    }));
    assert.equal(full.set('game', { big: true }), false);
    assert.doesNotThrow(() => full.remove('game'));
  });

  it('works without any storage at all', () => {
    const none = createStore('game:', () => undefined);
    assert.equal(none.get('lang', 'en'), 'en');
    assert.equal(none.set('lang', 'tr'), false);
    assert.doesNotThrow(() => none.remove('lang'));
  });
});
