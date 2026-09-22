import type { ESLint, Linter, Rule } from 'eslint';
import noDirectStorage from './rules/no-direct-storage.js';
import noReservedKey from './rules/no-reserved-key.js';
import requireNamespaceLiteral from './rules/require-namespace-literal.js';
import storageFileConvention from './rules/storage-file-convention.js';

const NAME = 'namespaced-storage';

export const rules: Record<string, Rule.RuleModule> = {
  'no-direct-storage': noDirectStorage,
  'no-reserved-key': noReservedKey,
  'require-namespace-literal': requireNamespaceLiteral,
  'storage-file-convention': storageFileConvention,
};

/** Kept in step with package.json by hand; ESLint only uses it in cache keys and error text. */
const VERSION = '0.1.0';

const plugin: ESLint.Plugin = {
  meta: { name: `eslint-plugin-${NAME}`, version: VERSION },
  rules,
};

const recommendedRules: Linter.RulesRecord = {
  [`${NAME}/no-direct-storage`]: 'error',
  [`${NAME}/require-namespace-literal`]: 'error',
  [`${NAME}/no-reserved-key`]: 'error',
};

const strictRules: Linter.RulesRecord = {
  ...recommendedRules,
  [`${NAME}/storage-file-convention`]: 'warn',
};

/**
 * Flat config under the plain names, eslintrc under `legacy-`: flat is what ESLint 9 runs, and a
 * project still on eslintrc is the one that knows it needs the older shape (ADR-024).
 */
export interface LegacyConfig {
  plugins: string[];
  rules: Linter.RulesRecord;
}

export interface Configs {
  recommended: Linter.Config;
  strict: Linter.Config;
  'legacy-recommended': LegacyConfig;
  'legacy-strict': LegacyConfig;
}

export const configs: Configs = {
  recommended: {
    name: `${NAME}/recommended`,
    plugins: { [NAME]: plugin },
    rules: recommendedRules,
  },

  strict: {
    name: `${NAME}/strict`,
    plugins: { [NAME]: plugin },
    rules: strictRules,
  },

  'legacy-recommended': {
    plugins: [NAME],
    rules: recommendedRules,
  },

  'legacy-strict': {
    plugins: [NAME],
    rules: strictRules,
  },
};

plugin.configs = { ...configs };

export default plugin;
