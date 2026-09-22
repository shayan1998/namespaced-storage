# eslint-plugin-namespaced-storage

Four rules that keep browser storage behind a namespaced store, so a codebase cannot drift back to
raw `localStorage` one component at a time.

```bash
npm install -D eslint-plugin-namespaced-storage
```

Zero runtime dependencies. ESLint 9 or newer, flat config or eslintrc.

## Setup

```js
// eslint.config.js
import nss from 'eslint-plugin-namespaced-storage';

export default [nss.configs.recommended];
```

`configs.strict` adds the file convention as a warning. For a project still on eslintrc:

```json
{
  "plugins": ["namespaced-storage"],
  "extends": ["plugin:namespaced-storage/legacy-recommended"]
}
```

The flat configs are under the plain names because flat config is what ESLint 9 runs; the eslintrc
shapes are prefixed `legacy-`.

## What it looks like

```
/src/features/basket/CartBadge.tsx
  12:15  error  Direct use of 'localStorage' is not allowed. Create a namespaced store instead:
                createLocalStorage('feature').       namespaced-storage/no-direct-storage

/src/legacy/bootstrap.ts
  31:9   error  The namespace passed to createLocalStorage must be a string literal, so 'nss scan'
                can build the inventory without running your app.
                                              namespaced-storage/require-namespace-literal

✖ 2 problems (2 errors, 0 warnings)
```

## Rules

|                                                           | recommended | strict |
| --------------------------------------------------------- | ----------- | ------ |
| [`no-direct-storage`](#no-direct-storage)                 | error       | error  |
| [`require-namespace-literal`](#require-namespace-literal) | error       | error  |
| [`no-reserved-key`](#no-reserved-key)                     | error       | error  |
| [`storage-file-convention`](#storage-file-convention)     | —           | warn   |

Three of the four only fire on calls that resolve to an **import from `namespaced-storage`** — a
function of your own that happens to be called `createLocalStorage` is none of their business. The
trade is that a factory re-exported through your own module is invisible to them.

### no-direct-storage

Bans `localStorage` and `sessionStorage`, however they are reached: bare, or through `window`,
`globalThis` or `self`, in dot or bracket form. The global is resolved through scope, so a local
variable or a parameter of the same name is left alone.

```ts
localStorage.getItem('count'); // ✗
window.localStorage.setItem('a', 'b'); // ✗
globalThis['sessionStorage'].clear(); // ✗

basket.get('count'); // ✓
function read(localStorage) {} // ✓ — yours, not the global
```

| option         | default |                                                          |
| -------------- | ------- | -------------------------------------------------------- |
| `allow`        | `[]`    | global names to keep allowing, e.g. `['sessionStorage']` |
| `allowInFiles` | `[]`    | globs where raw access is fine — an adapter, a polyfill  |
| `cookies`      | `false` | also ban `document.cookie`                               |

```js
{
  rules: {
    'namespaced-storage/no-direct-storage': [
      'error',
      { allowInFiles: ['**/adapters/*.ts'], cookies: true },
    ],
  },
}
```

### require-namespace-literal

The namespace must be a string literal — `nss scan` builds the inventory by reading your source,
not by running it, so a computed namespace is invisible to every tool that wants to tell you what
the app persists.

```ts
createLocalStorage('basket'); // ✓
createLocalStorage(`basket`); // ✓
createLocalStorage(name); // ✗
createLocalStorage(`basket-${id}`); // ✗
createLocalStorage(); // ✗
```

### no-reserved-key

Keys beginning with `__nss` belong to the library — that is where the namespace's own version
record lives. The rule covers both the call sites and the declarations:

```ts
basket.set('__nssMeta', 1); // ✗
createLocalStorage('basket', { defaults: { __nssCount: 0 } }); // ✗
```

A dynamic key is left to the runtime guard, which throws `InvalidKeyError`.

### storage-file-convention

Store declarations belong in a `*.storage.ts` file next to the feature that owns them, which is
what makes a central registry unnecessary. Warning-level, and only in `configs.strict`.

```ts
// src/features/basket/basket.storage.ts ✓
// src/features/basket/CartBadge.tsx      ✗
export const basket = createLocalStorage('basket');
```

| option     | default                                          |                                 |
| ---------- | ------------------------------------------------ | ------------------------------- |
| `patterns` | `['**/*.storage.ts', … .tsx/.js/.jsx/.mts/.mjs]` | globs a declaration may live in |

Reading a store is unaffected — only the factory call is.

## License

MIT
