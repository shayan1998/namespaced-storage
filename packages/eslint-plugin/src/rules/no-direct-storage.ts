import type { Rule } from 'eslint';
import type { Identifier, MemberExpression, Node } from 'estree';
import { docsUrl, matchesAny, staticString } from '../shared.js';

interface Options {
  /** Global names to keep allowing, e.g. `['sessionStorage']`. */
  allow: string[];
  /** Globs where raw access is fine — an adapter, a polyfill, a test helper. */
  allowInFiles: string[];
  /** Also ban `document.cookie`. Off by default: this package does not own cookies yet. */
  cookies: boolean;
}

const STORAGES = ['localStorage', 'sessionStorage'];
/** Objects a global can be reached through. `self` covers workers. */
const HOSTS = ['window', 'globalThis', 'self'];

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Ban direct use of localStorage and sessionStorage outside a namespaced store',
      recommended: true,
      url: docsUrl('no-direct-storage'),
    },
    schema: [
      {
        type: 'object',
        properties: {
          allow: { type: 'array', items: { type: 'string' } },
          allowInFiles: { type: 'array', items: { type: 'string' } },
          cookies: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      direct:
        "Direct use of '{{name}}' is not allowed. Create a namespaced store instead: " +
        "createLocalStorage('feature').",
      cookie: "Direct use of 'document.cookie' is not allowed. Keep it behind a named module.",
    },
  },

  create(context) {
    const options = (context.options[0] ?? {}) as Partial<Options>;
    const allow = options.allow ?? [];
    const cookies = options.cookies ?? false;
    const banned = STORAGES.filter((name) => !allow.includes(name));

    if (matchesAny(context.filename, options.allowInFiles ?? [])) return {};

    const report = (node: Node, name: string): void => {
      context.report({ node: node as Rule.Node, messageId: 'direct', data: { name } });
    };

    /** The property being read, whether it was written `a.b` or `a['b']`. */
    const propertyName = (node: MemberExpression): string | undefined =>
      node.computed
        ? staticString(node.property as Node)
        : node.property.type === 'Identifier'
          ? node.property.name
          : undefined;

    return {
      MemberExpression(node) {
        const property = propertyName(node);
        if (property === undefined) return;

        if (
          node.object.type === 'Identifier' &&
          HOSTS.includes(node.object.name) &&
          banned.includes(property)
        ) {
          report(node, `${node.object.name}.${property}`);
          return;
        }

        if (
          cookies &&
          property === 'cookie' &&
          node.object.type === 'Identifier' &&
          node.object.name === 'document'
        ) {
          context.report({ node, messageId: 'cookie' });
        }
      },

      // Bare `localStorage.getItem(…)`. Resolved through scope rather than matched by text, so a
      // local variable or parameter of the same name is left alone.
      Program(node) {
        const scope = context.sourceCode.getScope(node);

        const reportReference = (reference: { identifier: Identifier }): void => {
          const identifier = reference.identifier;
          if (!banned.includes(identifier.name)) return;
          // `window.localStorage` is a property, never a reference, so this cannot double-report.
          report(identifier, identifier.name);
        };

        // Declared by the environment (`globals`), so resolved but with no definition in this file.
        for (const variable of scope.variables) {
          if (variable.defs.length === 0) variable.references.forEach(reportReference);
        }
        // Not declared anywhere ESLint can see — the usual case in a plain module.
        scope.through.forEach(reportReference);
      },
    };
  },
};

export default rule;
