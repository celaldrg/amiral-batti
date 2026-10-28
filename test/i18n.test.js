import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { FLEET } from '../src/fleet.js';
import { AI_LEVELS } from '../src/ai.js';
import { LANGUAGES, STRINGS, normalizeLanguage, translate } from '../src/i18n.js';

const ROOT = new URL('../', import.meta.url);
const SRC = new URL('src/', ROOT);
const OUTCOMES = ['miss', 'hit', 'sunk'];

/** Keys the code builds at run time: prefix -> every value that completes it. */
const FAMILIES = {
  ship_: FLEET.map((type) => type.id),
  ai_: AI_LEVELS,
  aiHint_: AI_LEVELS,
  err_: ['touch', 'overlap', 'bounds', 'incomplete', 'repeat', 'turn'],
  res_: OUTCOMES,
  you_: OUTCOMES,
  enemy_: OUTCOMES,
};
const familyKeys = Object.entries(FAMILIES).flatMap(([prefix, values]) => values.map((value) => prefix + value));

const html = readFileSync(new URL('index.html', ROOT), 'utf8');
const code = readdirSync(SRC)
  .filter((name) => name.endsWith('.js'))
  .map((name) => readFileSync(new URL(name, SRC), 'utf8'))
  .join('\n');

function captures(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

function placeholders(text) {
  return captures(text, /\{(\w+)\}/g).sort();
}

/** Keys written out in full: t('key'), notices { key: 'key' } and data-i18n attributes. */
const literalKeys = new Set([
  ...captures(code, /(?:\bt\(|\bkey: )'([A-Za-z_]+)'/g),
  ...captures(html, /data-i18n(?:-label)?="([A-Za-z_]+)"/g),
]);

describe('string tables', () => {
  it('has English first, then Turkish', () => {
    assert.deepEqual(LANGUAGES, ['en', 'tr']);
    assert.deepEqual(Object.keys(STRINGS), [...LANGUAGES]);
  });

  it('gives Turkish every English key except the English-only singular forms', () => {
    const missing = Object.keys(STRINGS.en).filter((key) => !Object.hasOwn(STRINGS.tr, key));
    const extra = Object.keys(STRINGS.tr).filter((key) => !Object.hasOwn(STRINGS.en, key));
    assert.deepEqual(missing.sort(), ['placeShips_one', 'shotsLeft_one']);
    assert.deepEqual(extra, []);
  });

  it('uses the same parameters in both languages', () => {
    for (const [key, text] of Object.entries(STRINGS.tr)) {
      assert.deepEqual(placeholders(text), placeholders(STRINGS.en[key]), key);
    }
  });

  it('has no empty strings', () => {
    for (const lang of LANGUAGES) {
      for (const [key, text] of Object.entries(STRINGS[lang])) {
        assert.ok(typeof text === 'string' && text.trim().length > 0, `${lang}.${key}`);
      }
    }
  });

  it('gives each singular form a plural with the same parameters plus count', () => {
    for (const key of Object.keys(STRINGS.en).filter((name) => name.endsWith('_one'))) {
      const plural = STRINGS.en[key.slice(0, -'_one'.length)];
      assert.ok(plural, key);
      assert.deepEqual(placeholders(plural).filter((name) => name !== 'count'), placeholders(STRINGS.en[key]), key);
    }
  });
});

describe('translate', () => {
  it('fills in parameters', () => {
    assert.equal(translate('en', 'placedCount', { count: 3, total: 5 }), '3/5 placed');
    assert.equal(translate('tr', 'err_repeat', { cell: 'B7' }), 'B7 karesine zaten ateş ettin.');
    assert.equal(translate('en', 'enemy_hit', { ship: 'Frigate', cell: 'H5' }), 'The computer hit your Frigate at H5.');
  });

  it('uses the singular form only when count is 1', () => {
    assert.equal(translate('en', 'shotsLeft', { count: 1 }), '1 shot left');
    assert.equal(translate('en', 'shotsLeft', { count: 2 }), '2 shots left');
    assert.equal(translate('en', 'shotsLeft', { count: 0 }), '0 shots left');
    assert.equal(translate('tr', 'shotsLeft', { count: 1 }), '1 atış kaldı');
  });

  it('falls back to English, then to the key itself', () => {
    assert.equal(translate('de', 'newGame'), 'New game');
    assert.equal(translate('tr', 'shotsLeft_one'), '1 shot left');
    assert.equal(translate('tr', 'noSuchKey'), 'noSuchKey');
  });

  it('leaves unknown parameters as written', () => {
    assert.equal(translate('en', 'err_repeat'), 'You already fired at {cell}.');
    assert.equal(translate('en', 'err_repeat', { other: 'A1' }), 'You already fired at {cell}.');
  });

  it('accepts only supported languages and defaults to English', () => {
    assert.equal(normalizeLanguage('tr'), 'tr');
    assert.equal(normalizeLanguage('en'), 'en');
    for (const value of [null, undefined, '', 'de', 'TR', 42, {}]) assert.equal(normalizeLanguage(value), 'en');
  });
});

describe('keys used by the page', () => {
  it('finds the keys written in the code and in index.html', () => {
    assert.ok(literalKeys.size > 50, `only ${literalKeys.size} keys found`);
  });

  it('has a string for every key written in the code or the page', () => {
    assert.deepEqual([...literalKeys].filter((key) => !Object.hasOwn(STRINGS.en, key)), []);
  });

  it('has a string in both languages for every key built at run time', () => {
    const missing = familyKeys.filter((key) => !LANGUAGES.every((lang) => Object.hasOwn(STRINGS[lang], key)));
    assert.deepEqual(missing, []);
  });

  it('builds keys only from known prefixes', () => {
    for (const prefix of captures(code, /`([A-Za-z]+_)\$\{/g)) assert.ok(Object.hasOwn(FAMILIES, prefix), prefix);
  });

  it('uses every string', () => {
    const used = (key) => literalKeys.has(key)
      || familyKeys.includes(key)
      || (key.endsWith('_one') && literalKeys.has(key.slice(0, -'_one'.length)));
    assert.deepEqual(Object.keys(STRINGS.en).filter((key) => !used(key)), []);
  });

  it('ships the English strings in index.html, so nothing changes when the script starts', () => {
    for (const [, key, text] of html.matchAll(/\bdata-i18n="(\w+)"[^>]*>([^<]*)</g)) {
      assert.equal(text.trim(), STRINGS.en[key], key);
    }
    for (const [tag, key] of html.matchAll(/<[^>]*\bdata-i18n-label="(\w+)"[^>]*>/g)) {
      assert.equal(tag.match(/\baria-label="([^"]*)"/)?.[1], STRINGS.en[key], key);
    }
  });
});
