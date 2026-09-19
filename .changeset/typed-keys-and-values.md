---
'namespaced-storage': minor
---

Keys and values can now be typed, with no DSL to learn.

Pass a plain `defaults` object: its types become the key types, and each read returns a clone of
the fallback when the key has never been written. For keys with no sensible default, or data that
must be validated, pass `schema` — either the built-in `t.*` builders or any Standard Schema
validator (Zod 3.24+, Valibot, ArkType), with no peer dependency and nothing extra in the bundle
for users who skip it.

Both options may declare the same key: the schema validates, the default is the fallback, and a
default contradicting its own schema is rejected at construction. Writes validate and throw
`ValidationError`; reads follow the new `onInvalid` policy and fall back to the default.
