import type { Rule } from 'eslint';
import type { Node, ObjectExpression, Property } from 'estree';
import { docsUrl, staticString, trackFactories } from '../shared.js';

/** Every store method whose first argument is a key. */
const KEY_METHODS = [
  'set',
  'get',
  'has',
  'remove',
  'meta',
  'ttl',
  'trySet',
  'subscribe',
  'setItem',
  'getItem',
  'removeItem',
];

const RESERVED = '__nss';

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Reject storage keys that start with the reserved __nss prefix',
      recommended: true,
      url: docsUrl('no-reserved-key'),
    },
    schema: [],
    messages: {
      reserved:
        "'{{key}}' starts with '__nss', which namespaced-storage reserves for its own " +
        'bookkeeping. Pick another key.',
    },
  },

  create(context) {
    const tracker = trackFactories();

    const check = (node: Node | undefined, key: string | undefined): void => {
      if (node === undefined || key === undefined || !key.startsWith(RESERVED)) return;
      context.report({ node: node as Rule.Node, messageId: 'reserved', data: { key } });
    };

    /** `defaults` and `schema` declare keys too, and that is where a reserved one hides longest. */
    const checkDeclaration = (value: Node): void => {
      if (value.type !== 'ObjectExpression') return;
      for (const property of (value as ObjectExpression).properties) {
        if (property.type !== 'Property') continue;
        const name = property.computed
          ? staticString(property.key as Node)
          : keyName(property as Property);
        check(property.key as Node, name);
      }
    };

    return {
      ...tracker.visitors,

      CallExpression(node) {
        if (tracker.factoryOf(node) !== undefined) {
          const options = node.arguments[1];
          if (options?.type === 'ObjectExpression') {
            for (const property of options.properties) {
              if (
                property.type === 'Property' &&
                !property.computed &&
                (keyName(property) === 'defaults' || keyName(property) === 'schema')
              ) {
                checkDeclaration(property.value as Node);
              }
            }
          }
          return;
        }

        // Any `<something>.set('__nss…')`: the prefix belongs to this package wherever it appears.
        const callee = node.callee as Node;
        if (
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.property.type === 'Identifier' &&
          KEY_METHODS.includes(callee.property.name)
        ) {
          const first = node.arguments[0] as Node | undefined;
          check(first, staticString(first));
        }
      },
    };
  },
};

function keyName(property: Property): string | undefined {
  if (property.key.type === 'Identifier') return property.key.name;
  return staticString(property.key as Node);
}

export default rule;
