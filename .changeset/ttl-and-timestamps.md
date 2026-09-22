---
'namespaced-storage': minor
---

Keys can expire, and can record when they were written.

`set(key, value, { ttl })` gives one key a lifetime; `ttl` on the store gives every key the same
one. Expiry is checked on access rather than by a timer, so nothing depends on the tab staying
open: `get` and `has` collect a dead entry as they pass it, while `keys()`, `size` and `entries()`
hide it without writing. A key with a default falls back to that default once it expires.

`timestamps: true` records `createdAt` and `updatedAt`. New readers: `meta(key)` and `ttl(key)`.
