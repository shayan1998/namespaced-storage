---
'namespaced-storage': minor
---

`subscribe` watches a key, or the whole namespace, in this tab and in others.

The native `storage` event never fires in the tab that made the change, so local writes are
emitted alongside it and each event is tagged `source: 'local' | 'remote'`. Values arrive decoded,
`oldValue` included — it is free on an event and still never written to disk.

A subscriber that throws is reported as `SubscriberError` and skipped, never taking down the other
subscribers or the write. A value that fails to decode or validate arrives as `undefined` and is
reported. A foreign `clear()` reaches whole-namespace subscribers as `key: null`, and per-key
subscribers as their own key.
