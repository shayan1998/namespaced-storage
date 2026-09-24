import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from '../src/cli.js';

let root: string;

const write = (file: string, contents: string): void => {
  const full = join(root, file);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents, 'utf8');
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nss-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

interface Run {
  code: number;
  out: string;
  error: string;
  files: Record<string, string>;
}

function cli(...argv: string[]): Run {
  const out: string[] = [];
  const error: string[] = [];
  const files: Record<string, string> = {};

  const code = run(argv, {
    out: (text) => out.push(text),
    error: (text) => error.push(text),
    write: (file, contents) => {
      files[file] = contents;
    },
  });

  return { code, out: out.join('\n'), error: error.join('\n'), files };
}

const BASKET = `import { createLocalStorage } from 'namespaced-storage';

export const basket = createLocalStorage('basket', {
  owner: 'team-checkout',
  description: 'Shopping basket, survives reload',
  defaults: { count: 0, items: [] as BasketItem[] },
});
`;

const AUTH = `import { createSessionStorage, t } from 'namespaced-storage';

export const auth = createSessionStorage('auth', {
  owner: 'team-identity',
  ttl: 15 * 60_000,
  schema: { token: t.string(), refreshAt: t.date() },
});
`;

describe('nss scan', () => {
  it('lists every namespace with its backend, owner, file and key count', () => {
    write('src/features/basket/basket.storage.ts', BASKET);
    write('src/features/auth/auth.storage.ts', AUTH);

    const result = cli('scan', root);

    expect(result.code).toBe(0);
    expect(result.out).toContain('2 namespaces across 2 files');
    expect(result.out).toContain('auth');
    expect(result.out).toContain('team-checkout');
    expect(result.out).toContain('2 keys');
  });

  it('says so, and cleanly, when there is nothing to report', () => {
    write('src/app.ts', 'export const x = 1;\n');

    const result = cli('scan', root);

    expect(result.code).toBe(0);
    expect(result.out).toContain('0 namespaces');
  });

  it('fails the build on a namespace claimed twice, naming both sites', () => {
    write('src/features/basket/cart.storage.ts', BASKET.replace(/'basket'/, "'cart'"));
    write('src/legacy/cart.ts', BASKET.replace(/'basket'/, "'cart'"));

    const result = cli('scan', root);

    expect(result.code).toBe(1);
    expect(result.out).toContain('duplicate namespace "cart"');
    expect(result.out).toMatch(/src\/features\/basket\/cart\.storage\.ts:3:\d+/);
    expect(result.out).toMatch(/src\/legacy\/cart\.ts:3:\d+/);
  });

  it('fails on a namespace it cannot read from source', () => {
    write(
      'src/app.ts',
      "import { createLocalStorage } from 'namespaced-storage';\ncreateLocalStorage(name);\n",
    );

    const result = cli('scan', root);

    expect(result.code).toBe(1);
    expect(result.out).toContain('not a string literal');
  });

  it('never walks into node_modules, dist or .git', () => {
    write('node_modules/some-package/index.ts', BASKET);
    write('dist/basket.storage.js', BASKET);
    write('src/basket.storage.ts', BASKET);

    expect(cli('scan', root).out).toContain('1 namespace across 1 file');
  });

  it('skips what --ignore names', () => {
    write('src/basket.storage.ts', BASKET);
    write('legacy/basket.storage.ts', BASKET.replace('basket', 'old'));

    expect(cli('scan', root, '--ignore', 'legacy').out).toContain('1 namespace');
    expect(cli('scan', root, '--ignore=legacy').out).toContain('1 namespace');
  });
});

describe('nss scan --json', () => {
  it('emits a manifest a CI job can read', () => {
    write('src/features/auth/auth.storage.ts', AUTH);

    const result = cli('scan', root, '--json');
    const manifest = JSON.parse(result.out) as {
      version: number;
      namespaces: Array<Record<string, unknown>>;
    };

    expect(manifest.version).toBe(1);
    expect(manifest.namespaces).toHaveLength(1);
    expect(manifest.namespaces[0]).toMatchObject({
      namespace: 'auth',
      backend: 'session',
      owner: 'team-identity',
      ttl: 900_000,
      file: 'src/features/auth/auth.storage.ts',
      keys: [
        { name: 'token', type: 'string', source: 'schema' },
        { name: 'refreshAt', type: 'Date', source: 'schema' },
      ],
    });
  });

  it('carries the problems too, so CI does not have to parse the human report', () => {
    write('a.storage.ts', BASKET);
    write('b.storage.ts', BASKET);

    const result = cli('scan', root, '--json');
    const manifest = JSON.parse(result.out) as { problems: Array<{ kind: string }> };

    expect(result.code).toBe(1);
    expect(manifest.problems[0]?.kind).toBe('duplicate');
  });
});

describe('nss docs', () => {
  it('writes the markdown inventory', () => {
    write('src/features/basket/basket.storage.ts', BASKET);
    write('src/features/auth/auth.storage.ts', AUTH);

    const result = cli('docs', root, '-o', 'docs/storage.md');
    const markdown = result.files['docs/storage.md'] ?? '';

    expect(result.code).toBe(0);
    expect(result.out).toContain('Wrote 2 namespaces to docs/storage.md');
    expect(markdown).toContain('| namespace | storage | owner | keys | description |');
    expect(markdown).toContain(
      '| `auth` | session | team-identity | `token: string`, `refreshAt: Date` |',
    );
    expect(markdown).toContain('Shopping basket, survives reload');
    expect(markdown).toContain('Do not edit by hand');
  });

  it('prints to stdout without -o', () => {
    write('src/basket.storage.ts', BASKET);

    expect(cli('docs', root).out).toContain('# Storage inventory');
  });

  it('is honest about an empty codebase', () => {
    expect(cli('docs', root).out).toContain('No namespaces found.');
  });
});

describe('the command line itself', () => {
  it('shows help, and exits 2 when asked for nothing at all', () => {
    expect(cli('--help').code).toBe(0);
    expect(cli('--help').out).toContain('nss scan');

    const nothing = cli();
    expect(nothing.code).toBe(2);
    expect(nothing.out).toContain('Usage');
  });

  it('prints its version', () => {
    expect(cli('--version').out).toBe('0.1.0');
  });

  it('refuses a command or an option it does not know', () => {
    expect(cli('inventory').code).toBe(2);
    expect(cli('inventory').error).toContain('Unknown command "inventory"');
    expect(cli('scan', '--deep').code).toBe(2);
    expect(cli('scan', '--deep').error).toContain('Unknown option "--deep"');
  });

  it('accepts a single file as the path', () => {
    write('src/basket.storage.ts', BASKET);

    expect(cli('scan', join(root, 'src/basket.storage.ts')).out).toContain('1 namespace');
  });

  it('says nothing is there rather than throwing at a path that does not exist', () => {
    const result = cli('scan', join(root, 'nowhere'));

    expect(result.code).toBe(0);
    expect(result.out).toContain('0 namespaces');
  });
});
