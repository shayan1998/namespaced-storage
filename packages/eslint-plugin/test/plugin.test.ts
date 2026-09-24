import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import plugin, { configs, rules } from '../src/index.js';

const RULE_NAMES = [
  'no-direct-storage',
  'no-reserved-key',
  'require-namespace-literal',
  'storage-file-convention',
];

/** Lints a snippet through a real Linter, so a broken config shape cannot pass unnoticed. */
function lint(code: string, config: Linter.Config, filename = 'src/app.ts'): Linter.LintMessage[] {
  return new Linter().verify(
    code,
    [
      // Flat config needs something to match the file before any config applies to it.
      {
        files: ['**/*.{js,jsx,ts,tsx}'],
        languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
      },
      config,
    ],
    filename,
  );
}

describe('the plugin object', () => {
  it('exports every rule, and nothing that is not a rule', () => {
    expect(Object.keys(rules).sort()).toEqual(RULE_NAMES);
    expect(plugin.rules).toBe(rules);
  });

  it('names itself, so flat config can report which plugin a rule came from', () => {
    expect(plugin.meta?.name).toBe('eslint-plugin-namespaced-storage');
    expect(plugin.meta?.version).toBe('0.1.0');
  });

  it.each(RULE_NAMES)('gives %s docs, a schema and messages', (name) => {
    const meta = rules[name]?.meta;
    expect(meta?.docs?.description).toBeTruthy();
    expect(meta?.docs?.url).toContain(name);
    expect(meta?.schema).toBeDefined();
    expect(Object.keys(meta?.messages ?? {}).length).toBeGreaterThan(0);
  });
});

describe('the recommended config', () => {
  it('turns the three core rules into errors and leaves the convention alone', () => {
    expect(configs.recommended.rules).toEqual({
      'namespaced-storage/no-direct-storage': 'error',
      'namespaced-storage/require-namespace-literal': 'error',
      'namespaced-storage/no-reserved-key': 'error',
    });
  });

  it('actually runs, end to end', () => {
    const messages = lint("localStorage.getItem('count');", configs.recommended);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.ruleId).toBe('namespaced-storage/no-direct-storage');
    expect(messages[0]?.severity).toBe(2);
    expect(messages[0]?.message).toContain('createLocalStorage');
  });

  it('catches all three in one pass', () => {
    const code = [
      "import { createLocalStorage } from 'namespaced-storage';",
      'export const basket = createLocalStorage(name);',
      "basket.set('__nssCount', 1);",
      'localStorage.clear();',
    ].join('\n');

    expect(
      lint(code, configs.recommended)
        .map((m) => m.ruleId)
        .sort(),
    ).toEqual([
      'namespaced-storage/no-direct-storage',
      'namespaced-storage/no-reserved-key',
      'namespaced-storage/require-namespace-literal',
    ]);
  });

  it('says nothing about code that already uses a store', () => {
    const code = [
      "import { createLocalStorage } from 'namespaced-storage';",
      "export const basket = createLocalStorage('basket', { defaults: { count: 0 } });",
      "basket.set('count', 1);",
    ].join('\n');

    expect(lint(code, configs.recommended, 'src/basket.storage.ts')).toEqual([]);
  });
});

describe('the strict config', () => {
  it('adds the file convention as a warning', () => {
    const code = [
      "import { createLocalStorage } from 'namespaced-storage';",
      "export const basket = createLocalStorage('basket');",
    ].join('\n');

    const messages = lint(code, configs.strict, 'src/app.ts');
    expect(messages).toHaveLength(1);
    expect(messages[0]?.ruleId).toBe('namespaced-storage/storage-file-convention');
    expect(messages[0]?.severity).toBe(1);
  });

  it('is quiet once the declaration lives where it belongs', () => {
    const code = [
      "import { createLocalStorage } from 'namespaced-storage';",
      "export const basket = createLocalStorage('basket');",
    ].join('\n');

    expect(lint(code, configs.strict, 'src/features/basket/basket.storage.ts')).toEqual([]);
  });
});

describe('the eslintrc configs', () => {
  it('name the plugin as a string, the way the old config format wants', () => {
    expect(configs['legacy-recommended'].plugins).toEqual(['namespaced-storage']);
    expect(configs['legacy-recommended'].rules).toEqual(configs.recommended.rules);
    expect(configs['legacy-strict'].rules).toEqual(configs.strict.rules);
  });

  it('are reachable from the plugin object too, as eslintrc resolves them', () => {
    expect(plugin.configs?.['legacy-recommended']).toBe(configs['legacy-recommended']);
  });
});
