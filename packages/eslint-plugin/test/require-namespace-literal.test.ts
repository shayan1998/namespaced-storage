import { RuleTester } from 'eslint';
import rule from '../src/rules/require-namespace-literal.js';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

const imported = "import { createLocalStorage } from 'namespaced-storage';\n";

ruleTester.run('require-namespace-literal', rule, {
  valid: [
    `${imported}createLocalStorage('basket');`,
    `${imported}createLocalStorage(\`basket\`);`,
    `${imported}createLocalStorage('basket', { version: 2 });`,
    "import * as nss from 'namespaced-storage'; nss.createSessionStorage('auth');",
    // Not this package's factory: a same-named function of your own is none of our business.
    "import { createLocalStorage } from './my-own-helpers.js'; createLocalStorage(name);",
    'createLocalStorage(name);',
    // A namespace import used for something else entirely.
    "import * as nss from 'namespaced-storage'; nss.t.string();",
  ],

  invalid: [
    {
      code: `${imported}createLocalStorage(name);`,
      errors: [{ messageId: 'literal', data: { factory: 'createLocalStorage' } }],
    },
    {
      code: `${imported}createLocalStorage(\`basket-\${id}\`);`,
      errors: [{ messageId: 'literal' }],
    },
    {
      code: `${imported}createLocalStorage();`,
      errors: [{ messageId: 'missing', data: { factory: 'createLocalStorage' } }],
    },
    {
      // Renamed on import, still the same factory.
      code: "import { createLocalStorage as make } from 'namespaced-storage'; make(name);",
      errors: [{ messageId: 'literal', data: { factory: 'createLocalStorage' } }],
    },
    {
      code: "import * as nss from 'namespaced-storage'; nss.createMemoryStorage(name);",
      errors: [{ messageId: 'literal', data: { factory: 'createMemoryStorage' } }],
    },
  ],
});
