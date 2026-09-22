# Errors

Every error extends `NamespacedStorageError` and carries a stable `.code`, plus `.namespace` and
`.key` where they apply. Branch on the code, never on the message.

```ts
import { NamespacedStorageError, StorageQuotaError } from 'namespaced-storage';

try {
  basket.set('items', items);
} catch (error) {
  if (error instanceof StorageQuotaError) tellTheUserToFreeSomething();
  else if (error instanceof NamespacedStorageError) report(error.code);
  else throw error;
}
```

`onError` is called for **every** error, including the ones that are reported rather than thrown —
a corrupt value, a conflict in production, a migration that could not record its version. Wire it
to your error reporter once, per store.

| error                     | code                  | thrown? | what it means                                                     |
| ------------------------- | --------------------- | ------- | ----------------------------------------------------------------- |
| `StorageUnavailableError` | `STORAGE_UNAVAILABLE` | no¹     | no `window`, private mode, or a cookie-blocked iframe             |
| `StorageQuotaError`       | `QUOTA_EXCEEDED`      | yes     | the backend is full; normalised across browsers                   |
| `NamespaceConflictError`  | `NAMESPACE_CONFLICT`  | dev²    | two places created the same namespace                             |
| `InvalidNamespaceError`   | `INVALID_NAMESPACE`   | yes     | a namespace, prefix or child segment outside `[A-Za-z0-9_.-]`     |
| `InvalidKeyError`         | `INVALID_KEY`         | yes     | an empty key, or one starting with the reserved `__nss`           |
| `InvalidOptionsError`     | `INVALID_OPTIONS`     | yes     | options that contradict each other, or that this build cannot run |
| `SerializationError`      | `SERIALIZE`           | yes     | a value that cannot be stored — a cycle, a function               |
| `DecodeError`             | `DECODE`              | no³     | stored data that will not parse                                   |
| `ValidationError`         | `VALIDATION`          | mixed⁴  | a value that fails its schema; carries `.issues`                  |
| `SubscriberError`         | `SUBSCRIBER`          | no      | one of your listeners threw; the others still ran                 |
| `MigrationError`          | `MIGRATION`           | yes⁵    | a migration threw, returned the wrong shape, or could not write   |

1. Reported through `onError`, then the `fallback` policy applies — `'memory'` by default, so the
   app keeps working and `store.available` is `false`. `fallback: 'throw'` makes it throw.
2. Throws outside production, reports inside it. `strict: true` always throws, `false` disables the
   guard (ADR-020).
3. Follows `onCorrupt`: `'ignore'` (default, reads as the default value), `'remove'`, `'throw'`.
4. Always throws on a **write**. On a **read** it follows `onInvalid`, which defaults to `'ignore'`
   — stale data reads as the default rather than crashing a render (ADR-016).
5. Reported and thrown, with the version left where it was, so the next load tries again. The one
   exception is a version stamp that could not be written after a successful migration: that is
   reported only (ADR-022).

## The ones worth handling

**`StorageQuotaError`** is the only error a healthy app hits in production. Use `trySet` wherever
the value is user-sized:

```ts
const result = drafts.trySet(id, body);
if (!result.ok) showBanner('Your draft could not be saved — storage is full.');
```

**`StorageUnavailableError`** is normal, not exceptional: a server render, a private window, an
embedded iframe with cookies blocked. The default memory fallback is usually the right answer; read
`store.available` if the UI should say something.

**`NamespaceConflictError`** names both call sites. The fix is almost always to import the store
that already exists rather than to create a second one.
