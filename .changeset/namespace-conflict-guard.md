---
'namespaced-storage': minor
---

Creating the same namespace twice is now caught, with both call sites named.

The guard throws outside production and reports through `onError` inside it, so a genuine bug is
loud in development without ever white-screening a live page. `strict: true` forces the throw
anywhere, `strict: false` turns it off for deliberate second instances.

`localStorage` and `sessionStorage` may each hold a namespace of the same name, a memory fallback
does not change a namespace's identity, and `child()` is never registered. Tests should call the
new `resetNamespaceRegistry()` export in their setup.
