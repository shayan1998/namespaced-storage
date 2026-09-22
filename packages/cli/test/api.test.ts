import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as api from '../src/index.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nss-api-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const DECLARATION = `import { createLocalStorage } from 'namespaced-storage';
export const basket = createLocalStorage('basket');
`;

describe('the package surface', () => {
  it('exports the pieces a build script would reach for', () => {
    expect(Object.keys(api).sort()).toEqual([
      'findDuplicates',
      'findSourceFiles',
      'formatDocs',
      'formatJson',
      'formatReport',
      'readSource',
      'run',
      'scan',
      'scanSource',
    ]);
  });

  it('scans a directory through the exported function', () => {
    writeFileSync(join(root, 'basket.storage.ts'), DECLARATION);

    const result = api.scan(root);
    expect(result.declarations[0]?.namespace).toBe('basket');
    expect(api.formatReport(result)).toContain('1 namespace');
  });
});

describe('the parts the happy path does not reach', () => {
  it('writes the file itself when nothing else is handed the job', () => {
    writeFileSync(join(root, 'basket.storage.ts'), DECLARATION);
    const target = join(root, 'nested/deeper/storage.md');
    const out: string[] = [];

    const code = api.run(['docs', root, '-o', target], {
      out: (t) => out.push(t),
      error: () => {},
    });

    expect(code).toBe(0);
    expect(readFileSync(target, 'utf8')).toContain('| `basket` |');
  });

  it('walks past a file it cannot read', () => {
    writeFileSync(join(root, 'basket.storage.ts'), DECLARATION);
    // A symlink to nothing: listed as a file, unreadable when opened.
    symlinkSync(join(root, 'gone.ts'), join(root, 'broken.ts'));

    expect(api.scan(root).declarations).toHaveLength(1);
  });

  it('renders a namespace with no declared keys', () => {
    writeFileSync(join(root, 'basket.storage.ts'), DECLARATION);

    expect(api.formatDocs(api.scan(root))).toContain('| `basket` | local | — | — | — |');
  });

  it('reads a ttl written as a sum, and gives up on one it cannot work out', () => {
    const source = (ttl: string) =>
      `import { createLocalStorage } from 'namespaced-storage';\ncreateLocalStorage('a', { ttl: ${ttl} });`;

    const ttlOf = (expression: string) =>
      api.scanSource('a.ts', source(expression)).declarations[0]?.ttl;

    expect(ttlOf('60_000 + 500')).toBe(60_500);
    expect(ttlOf('(30 * 1000)')).toBe(30_000);
    expect(ttlOf('60_000 - 500')).toBeUndefined();
    expect(ttlOf('base * 2')).toBeUndefined();
  });

  it('types a default it has never seen before as unknown', () => {
    const { declarations } = api.scanSource(
      'a.ts',
      "import { createLocalStorage } from 'namespaced-storage';\n" +
        "createLocalStorage('a', { defaults: { weird: someCall(), nothing: null, big: 1n } });",
    );

    expect(declarations[0]?.keys.map((k) => k.type)).toEqual(['unknown', 'null', 'bigint']);
  });

  it('reads a single-value literal schema and an empty enum', () => {
    const { declarations } = api.scanSource(
      'a.ts',
      "import { createLocalStorage } from 'namespaced-storage';\n" +
        "createLocalStorage('a', { schema: { mode: t.literal('dark'), empty: t.enum([]) } });",
    );

    expect(declarations[0]?.keys.map((k) => k.type)).toEqual(["'dark'", 'enum']);
  });
});
