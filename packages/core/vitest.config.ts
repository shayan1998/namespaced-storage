import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // Type-only modules: no runtime to cover.
      exclude: ['src/types.ts', 'src/adapters/types.ts', 'src/typing/infer.ts'],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
