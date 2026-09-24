# Next.js and SSR

Nothing in this library crashes without `window`. A store declared at module scope is safe to
import from a server component, a client component, a route handler or `middleware`: construction
never touches `window`, and the availability probe is guarded and memoised per runtime.

- [`src/basket.storage.ts`](src/basket.storage.ts) — declared once, imported everywhere.
- [`src/BasketCount.tsx`](src/BasketCount.tsx) — the one rule worth knowing.

## On the server

- Reads return defaults, writes go to a per-process memory adapter, and nothing throws.
- `basket.available` is `false`, and `onError` fires once with `STORAGE_UNAVAILABLE`. That is
  expected during a render, not an incident — filter it, as the example does, or set
  `fallback: 'noop'` if you would rather writes went nowhere at all.

## Hydration

The server rendered without storage, so **the first client render must agree with it**. Read in an
effect, not during render:

```tsx
const [count, setCount] = useState<number | undefined>(undefined);
useEffect(() => setCount(basket.get('count')), []);
```

Reading during render gives the server `0` and the client `7`, and React reports a mismatch. This
is the same rule every storage-backed UI follows; the library does not have a way around it,
because there is not one.

## What about `useSyncExternalStore`?

It works, and the [React example](../react) shows the hook — pass a server snapshot of `undefined`
for exactly the reason above.
