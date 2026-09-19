---
'namespaced-storage': minor
---

Values that JSON cannot represent now survive a round trip, at any depth.

`Date`, `Map`, `Set`, `BigInt`, `RegExp`, `NaN`, `±Infinity` and nested `undefined` are restored as
themselves rather than degrading into strings, `{}` or `null`. Types are recorded out of band as
paths, so the stored payload stays a faithful copy of the value and nothing is injected into user
data.

Keys that need none of this still store plain JSON, so existing raw data keeps working and anything
else reading the key is unaffected.
