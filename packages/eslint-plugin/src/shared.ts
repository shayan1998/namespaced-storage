import type { Rule } from 'eslint';
import type { CallExpression, Node } from 'estree';

/** The package whose factories these rules are about. */
export const PACKAGE = 'namespaced-storage';

/** The three factories. A namespace is only ever created by one of these. */
export const FACTORIES = ['createLocalStorage', 'createSessionStorage', 'createMemoryStorage'];

/**
 * Tracks which local names in this file actually came from `namespaced-storage`, so a rule fires
 * on the package's factories rather than on anything that happens to share their name. A project
 * that re-exports a factory through its own module is invisible to this, which is the trade the
 * rules make for never crying wolf (ADR-024).
 */
export interface FactoryTracker {
  /** Visitors to spread into the rule's returned object. */
  visitors: Rule.RuleListener;
  /** The factory this call resolves to, or `undefined` when it is not one of ours. */
  factoryOf(node: CallExpression): string | undefined;
}

export function trackFactories(): FactoryTracker {
  /** local name → imported factory name, from `import { createLocalStorage as make }`. */
  const named = new Map<string, string>();
  /** local names bound by `import * as nss from 'namespaced-storage'`. */
  const namespaces = new Set<string>();

  return {
    visitors: {
      ImportDeclaration(node) {
        if (node.source.value !== PACKAGE) return;
        for (const specifier of node.specifiers) {
          if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            FACTORIES.includes(specifier.imported.name)
          ) {
            named.set(specifier.local.name, specifier.imported.name);
          } else if (specifier.type === 'ImportNamespaceSpecifier') {
            namespaces.add(specifier.local.name);
          }
        }
      },
    },

    factoryOf(node) {
      const callee: Node = node.callee as Node;
      if (callee.type === 'Identifier') return named.get(callee.name);
      if (
        callee.type === 'MemberExpression' &&
        !callee.computed &&
        callee.object.type === 'Identifier' &&
        namespaces.has(callee.object.name) &&
        callee.property.type === 'Identifier' &&
        FACTORIES.includes(callee.property.name)
      ) {
        return callee.property.name;
      }
      return undefined;
    },
  };
}

/** The string a node holds, for a plain literal or a template with nothing interpolated. */
export function staticString(node: Node | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (node.type === 'Literal') return typeof node.value === 'string' ? node.value : undefined;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
}

/**
 * A small glob, so `allowInFiles` and the file convention read the way a developer expects:
 * `**` crosses directories, `*` and `?` stay inside one segment. Implemented here rather than
 * pulled in, because a lint plugin with a dependency tree is a lint plugin people skip.
 */
function globToRegExp(pattern: string): RegExp {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\/|\*\*|\*|\?/g, (token) => {
      if (token === '**/') return '(?:[^/]*\\/)*';
      if (token === '**') return '.*';
      if (token === '*') return '[^/]*';
      return '[^/]';
    });
  return new RegExp(`^${source}$`);
}

export function matchesAny(filename: string, patterns: readonly string[]): boolean {
  const path = filename.replace(/\\/g, '/');
  return patterns.some((pattern) => globToRegExp(pattern).test(path));
}

/** ESLint's stand-in when it is linting text rather than a file on disk. */
export function isVirtualFile(filename: string): boolean {
  return filename === '<input>' || filename === '<text>';
}

export function docsUrl(rule: string): string {
  return `https://github.com/shayan1998/namespaced-storage/blob/main/packages/eslint-plugin/README.md#${rule}`;
}
