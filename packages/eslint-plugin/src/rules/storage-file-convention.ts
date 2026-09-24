import type { Rule } from 'eslint';
import { docsUrl, isVirtualFile, matchesAny, trackFactories } from '../shared.js';

const DEFAULT_PATTERNS = [
  '**/*.storage.ts',
  '**/*.storage.tsx',
  '**/*.storage.js',
  '**/*.storage.jsx',
  '**/*.storage.mts',
  '**/*.storage.mjs',
];

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Keep store declarations in a *.storage.ts file beside the feature that owns them',
      recommended: false,
      url: docsUrl('storage-file-convention'),
    },
    schema: [
      {
        type: 'object',
        properties: {
          patterns: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      convention:
        '{{factory}} belongs in a *.storage.ts file next to the feature that owns it, so the ' +
        'inventory stays discoverable without a central registry.',
    },
  },

  create(context) {
    const patterns =
      ((context.options[0] ?? {}) as { patterns?: string[] }).patterns ?? DEFAULT_PATTERNS;

    // Linting a string rather than a file: there is no filename to have an opinion about.
    if (isVirtualFile(context.filename) || matchesAny(context.filename, patterns)) return {};

    const tracker = trackFactories();

    return {
      ...tracker.visitors,

      CallExpression(node) {
        const factory = tracker.factoryOf(node);
        if (factory !== undefined) {
          context.report({ node, messageId: 'convention', data: { factory } });
        }
      },
    };
  },
};

export default rule;
