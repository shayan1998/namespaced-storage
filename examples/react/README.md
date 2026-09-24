# React

A store already satisfies `useSyncExternalStore`: it has `subscribe(key, listener)` and a
synchronous `get(key)`. The hook is eight lines, and there is no provider, no context and no second
copy of the state.

- [`src/use-store.ts`](src/use-store.ts) — the hook.
- [`src/BasketBadge.tsx`](src/BasketBadge.tsx) — a component reading and writing one key.
- [`src/basket.storage.ts`](src/basket.storage.ts) — the declaration, unchanged from the vanilla
  example. A store is not a React thing.

Two windows of the app stay in step without any extra work: `subscribe` covers this tab and the
others, and the event says which.

**Concurrent-safe.** `get` returns a clone of the default and a freshly decoded value, so a
component can never mutate what the next read returns.

**The server snapshot returns `undefined`.** Storage does not exist during a server render, so the
honest snapshot is "nothing yet", and the first client render agrees with the server. Reading real
values on the server and pretending otherwise is what produces a hydration mismatch.
