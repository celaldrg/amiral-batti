/**
 * The only module that touches localStorage. Every access sits in
 * try/catch: private browsing, blocked site data or a full quota must never
 * break the game, they only mean nothing is remembered.
 * @module storage
 */

/**
 * @typedef {object} Store
 * @property {(key: string, fallback: unknown) => unknown} get The saved JSON value, or fallback.
 * @property {(key: string, value: unknown) => boolean} set False when nothing could be saved.
 * @property {(key: string) => void} remove
 */

/**
 * Creates a JSON store whose keys all start with `prefix`.
 * @param {string} prefix
 * @param {() => (Storage | null | undefined)} [backend] Returns the storage
 *   to use; the browser's localStorage by default. Only called inside try.
 * @returns {Store}
 */
export function createStore(prefix, backend = () => globalThis.localStorage) {
  return {
    get(key, fallback) {
      try {
        const raw = backend()?.getItem(prefix + key);
        return raw === null || raw === undefined ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        const storage = backend();
        if (!storage) return false;
        storage.setItem(prefix + key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        backend()?.removeItem(prefix + key);
      } catch {
        // Storage is unavailable, so there is nothing to remove.
      }
    },
  };
}
