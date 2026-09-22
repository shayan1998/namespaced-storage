import type { Rule } from 'eslint';
import type { Node } from 'estree';
import { docsUrl, staticString, trackFactories } from '../shared.js';

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require the namespace passed to a store factory to be a string literal',
      recommended: true,
      url: docsUrl('require-namespace-literal'),
    },
    schema: [],
    messages: {
      literal:
        "The namespace passed to {{factory}} must be a string literal, so 'nss scan' can build " +
        'the inventory without running your app.',
      missing: "{{factory}} needs a namespace: {{factory}}('feature').",
    },
  },

  create(context) {
    const tracker = trackFactories();

    return {
      ...tracker.visitors,

      CallExpression(node) {
        const factory = tracker.factoryOf(node);
        if (factory === undefined) return;

        const first = node.arguments[0];
        if (first === undefined) {
          context.report({ node, messageId: 'missing', data: { factory } });
          return;
        }

        if (staticString(first as Node) === undefined) {
          context.report({ node: first as Rule.Node, messageId: 'literal', data: { factory } });
        }
      },
    };
  },
};

export default rule;
