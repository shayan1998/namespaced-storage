# Vanilla TypeScript

The shape of a store, and the four things you get for free: namespacing, real types, codecs that
return a `Date` as a `Date`, and cross-tab updates.

- [`src/basket.storage.ts`](src/basket.storage.ts) — the declaration. One per feature, exported,
  named `*.storage.ts` so the ESLint rule and `nss scan` can find it.
- [`src/main.ts`](src/main.ts) — reading, writing, clearing, and reacting to another tab.

```html
<p id="basket"></p>
<button id="add">Add</button>
<button id="empty">Empty</button>
<script type="module" src="./src/main.ts"></script>
```

Point any bundler at `src/main.ts`. Nothing here needs configuration: the package ships ESM and
CJS, sets `sideEffects: false`, and has no runtime dependencies.

Storage writes `basket:count`, `basket:items` and `basket:lastOpened` — and `basket.clear()` only
ever removes those.
