# nss

The inventory for [`namespaced-storage`](https://github.com/shayan1998/namespaced-storage): what
this codebase stores, who owns it, and whether two places quietly claim the same namespace.

```bash
npm install --save-dev @namespaced-storage/cli
npx nss scan
```

The package is scoped (`@namespaced-storage/cli`) but the binary it installs is `nss` — once it's a
devDependency, `npx nss` and any `nss` in a `package.json` script resolve to it directly. To run it
without installing anything first, name the package explicitly: `npx -p @namespaced-storage/cli nss scan`.

```
namespaced-storage · 3 namespaces across 3 files · 214 files scanned

  auth    session  team-identity   src/features/auth/auth.storage.ts       2 keys
  basket  local    team-checkout   src/features/basket/basket.storage.ts   2 keys
  ui      local    team-platform   src/shared/ui/ui.storage.ts             3 keys
```

There is no registry file to keep in sync — stores are declared next to the feature that owns them,
and this reads them back out of the source.

## Commands

| command                      |                                              |
| ---------------------------- | -------------------------------------------- |
| `nss scan [path]`            | the human report                             |
| `nss scan --json`            | a manifest for CI, or for your own tooling   |
| `nss docs [path] -o FILE.md` | the committed, reviewable markdown inventory |

| option           |                                           |
| ---------------- | ----------------------------------------- |
| `-o, --out FILE` | write to a file instead of stdout         |
| `--ignore NAME`  | skip a directory or file name; repeatable |
| `-h, --help`     |                                           |
| `-v, --version`  |                                           |

`node_modules`, `dist`, `build`, `coverage`, `out`, `.next`, `.turbo` and `.git` are never walked.

## What it catches

```
✖ duplicate namespace "cart" on localStorage
    src/features/basket/basket.storage.ts:4:22
    src/legacy/cart/store.ts:11:18

✖ 1 problem
```

Exit code `1`, so CI fails. This is the check a central registry file could never do: the two
declarations can live in different packages of a monorepo and still collide at runtime, because
they collide in one browser's `localStorage`.

It also fails on a namespace that is not a string literal — `createLocalStorage(name)` is invisible
to anything that reads source rather than running it, so it can never appear in the inventory.

A namespace on `localStorage` and one on `sessionStorage` may share a name: that is two different
stores, exactly as the runtime registry has it.

## In CI

With `@namespaced-storage/cli` already a devDependency, the install step your job already runs
(`npm ci`, `pnpm install`, …) puts `nss` on the local `PATH`:

```yaml
- run: npx nss scan
```

Or commit the inventory and let review notice when it changes:

```yaml
- run: npx nss docs -o docs/storage.md
- run: git diff --exit-code docs/storage.md
```

```md
| namespace | storage | owner         | keys                                   | description              |
| --------- | ------- | ------------- | -------------------------------------- | ------------------------ |
| `auth`    | session | team-identity | `token: string`, `refreshAt: Date`     | Short-lived access token |
| `basket`  | local   | team-checkout | `count: number`, `items: BasketItem[]` | Survives reload          |
```

`owner` and `description` come from the store's own options; the keys and their types come from
`defaults` and `schema`. A `t.*` schema is read back in the words a reader would use —
`t.array(t.string()).optional()` becomes `string[] | undefined`.

## As a library

```ts
import { scan, formatJson } from '@namespaced-storage/cli';

const result = scan('src');
if (result.problems.length > 0) process.exit(1);
```

`scanSource(file, source)` does the same for one file's text, with no filesystem involved.

## How it reads your code

Syntax only: one `ts.createSourceFile` per file, no type checker, no `tsconfig`, no module
resolution. It works on a repository that does not compile, and it only follows calls that resolve
to an import from `namespaced-storage` — a function of your own with the same name is not yours to
report on.

`typescript` is a peer dependency, so the CLI borrows the compiler your project already has rather
than shipping a second copy of it.

## License

MIT
