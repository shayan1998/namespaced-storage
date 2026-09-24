import { RuleTester } from 'eslint';
import rule from '../src/rules/no-direct-storage.js';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

ruleTester.run('no-direct-storage', rule, {
  valid: [
    "import { createLocalStorage } from 'namespaced-storage'; createLocalStorage('basket');",
    // A local of the same name is someone else's variable, not the global.
    "function read(localStorage) { return localStorage.getItem('a'); }",
    "const localStorage = new Map(); localStorage.get('a');",
    // A property that merely shares the name.
    "adapter.localStorage.getItem('a');",
    {
      code: "sessionStorage.getItem('a');",
      options: [{ allow: ['sessionStorage'] }],
    },
    {
      code: "localStorage.getItem('a');",
      filename: 'src/adapters/web-storage.ts',
      options: [{ allowInFiles: ['**/adapters/*.ts'] }],
    },
    // Computed with something only the runtime knows: a lint rule does not get to guess.
    'window[key].getItem(k);',
    // A private field is not a property name anyone can reach from outside.
    'class Store { #localStorage; read() { return this.#localStorage; } }',
    {
      code: "localStorage.getItem('a');",
      filename: 'src/app2.ts',
      options: [{ allowInFiles: ['src/app?.ts'] }],
    },
    // Cookies are opt-in: this package does not own them yet.
    "document.cookie = 'a=1';",
  ],

  invalid: [
    {
      code: "localStorage.getItem('count');",
      errors: [{ messageId: 'direct', data: { name: 'localStorage' } }],
    },
    {
      code: "window.localStorage.setItem('a', 'b');",
      errors: [{ messageId: 'direct', data: { name: 'window.localStorage' } }],
    },
    {
      code: 'globalThis.sessionStorage.clear();',
      errors: [{ messageId: 'direct', data: { name: 'globalThis.sessionStorage' } }],
    },
    {
      code: "self.localStorage.removeItem('a');",
      errors: [{ messageId: 'direct', data: { name: 'self.localStorage' } }],
    },
    {
      code: "window['localStorage'].getItem('a');",
      errors: [{ messageId: 'direct', data: { name: 'window.localStorage' } }],
    },
    {
      code: "localStorage.getItem('a'); sessionStorage.setItem('b', 'c');",
      errors: 2,
    },
    {
      code: "document.cookie = 'a=1';",
      options: [{ cookies: true }],
      errors: [{ messageId: 'cookie' }],
    },
    {
      // The allowlist covers one global, not the other.
      code: "sessionStorage.getItem('a'); localStorage.getItem('b');",
      options: [{ allow: ['sessionStorage'] }],
      errors: [{ messageId: 'direct', data: { name: 'localStorage' } }],
    },
    {
      code: "localStorage.getItem('a');",
      filename: 'src/app.ts',
      options: [{ allowInFiles: ['**/adapters/*.ts'] }],
      errors: 1,
    },
  ],
});
