---
'namespaced-storage': minor
---

Initial release: the namespacing core (M1).

- `createLocalStorage` / `createSessionStorage` / `createMemoryStorage`
- Automatic key prefixing; `clear()` is scoped to the namespace and never calls native `clear()`
- Nested namespaces via `child()`
- Automatic JSON serialization, stored in the plain shape so pre-existing raw data stays readable
- SSR-safe and hostile-environment-safe: blocked iframes, Safari private mode and missing `window`
  fall back to memory instead of throwing
- Typed errors (`StorageQuotaError`, `StorageUnavailableError`, `DecodeError`, …) and `trySet()`
- Configurable `fallback`, `onCorrupt`, `onError`, `prefix` and `separator`
