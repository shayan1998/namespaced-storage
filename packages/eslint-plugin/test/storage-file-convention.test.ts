import { RuleTester } from 'eslint';
import rule from '../src/rules/storage-file-convention.js';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

const imported = "import { createLocalStorage } from 'namespaced-storage';\n";

ruleTester.run('storage-file-convention', rule, {
  valid: [
    {
      code: `${imported}export const basket = createLocalStorage('basket');`,
      filename: 'src/features/basket/basket.storage.ts',
    },
    {
      code: `${imported}export const basket = createLocalStorage('basket');`,
      filename: 'src/features/basket/basket.storage.js',
    },
    {
      // Linting a string, not a file: there is no filename to have an opinion about.
      code: `${imported}createLocalStorage('basket');`,
    },
    {
      code: `${imported}createLocalStorage('basket');`,
      filename: 'src/state/basket.store.ts',
      options: [{ patterns: ['**/*.store.ts'] }],
    },
    {
      // Reading a store is exactly what every other file should be doing.
      code: "import { basket } from './basket.storage.js'; basket.get('count');",
      filename: 'src/features/basket/CartBadge.tsx',
    },
  ],

  invalid: [
    {
      code: `${imported}export const basket = createLocalStorage('basket');`,
      filename: 'src/features/basket/CartBadge.tsx',
      errors: [{ messageId: 'convention', data: { factory: 'createLocalStorage' } }],
    },
    {
      code: "import * as nss from 'namespaced-storage'; nss.createSessionStorage('auth');",
      filename: 'src/app.ts',
      errors: [{ messageId: 'convention', data: { factory: 'createSessionStorage' } }],
    },
    {
      code: `${imported}createLocalStorage('basket');`,
      filename: 'src/features/basket/basket.storage.ts',
      options: [{ patterns: ['**/*.store.ts'] }],
      errors: 1,
    },
  ],
});
