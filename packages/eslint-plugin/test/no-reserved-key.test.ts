import { RuleTester } from 'eslint';
import rule from '../src/rules/no-reserved-key.js';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

const imported = "import { createLocalStorage } from 'namespaced-storage';\n";

ruleTester.run('no-reserved-key', rule, {
  valid: [
    "basket.set('count', 1);",
    "basket.get('__ns');",
    "basket.subscribe('items', () => {});",
    `${imported}createLocalStorage('basket', { defaults: { count: 0 } });`,
    `${imported}createLocalStorage('basket', { schema: { token: t.string() } });`,
    // A dynamic key is a job for the runtime guard, not a lint rule guessing.
    'basket.set(key, 1);',
    `${imported}createLocalStorage('basket', { defaults: { ...base, count: 0 } });`,
    `${imported}createLocalStorage('basket', { defaults: base });`,
    `${imported}createLocalStorage('basket', { defaults: { [key]: 0 } });`,
    `${imported}createLocalStorage('basket');`,
  ],

  invalid: [
    {
      code: "basket.set('__nssMeta', 1);",
      errors: [{ messageId: 'reserved', data: { key: '__nssMeta' } }],
    },
    {
      code: "basket.get('__nss:meta');",
      errors: [{ messageId: 'reserved', data: { key: '__nss:meta' } }],
    },
    {
      code: 'basket.removeItem(`__nssThing`);',
      errors: [{ messageId: 'reserved' }],
    },
    {
      code: `${imported}createLocalStorage('basket', { defaults: { __nssCount: 0 } });`,
      errors: [{ messageId: 'reserved', data: { key: '__nssCount' } }],
    },
    {
      code: `${imported}createLocalStorage('basket', { schema: { '__nssToken': t.string() } });`,
      errors: [{ messageId: 'reserved', data: { key: '__nssToken' } }],
    },
    {
      code: `${imported}createLocalStorage('basket', { defaults: { ['__nssX']: 0 } });`,
      errors: [{ messageId: 'reserved', data: { key: '__nssX' } }],
    },
  ],
});
