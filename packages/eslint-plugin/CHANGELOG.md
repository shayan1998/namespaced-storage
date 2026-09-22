# eslint-plugin-namespaced-storage

## 1.0.0

### Major Changes

- **1.0.** Four rules that keep browser storage behind a namespaced store, with flat and eslintrc
  configs and zero runtime dependencies.

  `no-direct-storage` bans `localStorage` and `sessionStorage` however they are reached, resolving
  the global through scope so a local of the same name is left alone. `require-namespace-literal`
  keeps the namespace readable by `nss scan`. `no-reserved-key` covers call sites and the
  `defaults`/`schema` declarations. `storage-file-convention` keeps declarations in `*.storage.ts`.

  Every rule but `no-direct-storage` fires only on calls that resolve to an import from
  `namespaced-storage`, so a function of your own with the same name is never reported.
