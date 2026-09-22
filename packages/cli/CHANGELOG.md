# nss

## 1.0.0

### Major Changes

- **1.0.** `nss scan` reads your source and tells you what the app stores, who owns it, what each key
  holds, and whether two places claim the same namespace. `--json` emits a manifest for CI;
  `nss docs -o storage.md` writes the committed, reviewable inventory.

  Syntax only — no type checker, no `tsconfig`, no module resolution — so it works on a repository
  that does not compile. A duplicate namespace exits 1, which catches the collision a central
  registry file could never see across packages of a monorepo. A namespace that is not a string
  literal is reported rather than skipped: one no tool can read is one no tool can protect.
