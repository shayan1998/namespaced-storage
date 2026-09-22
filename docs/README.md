# Documentation

- [README](../README.md) — the library, feature by feature, with examples.
- [Errors](errors.md) — every error, when it fires, and which ones to handle.
- [Migrating from raw storage](migrating-from-raw-storage.md) — the mechanical port.
- [llms.txt](llms.txt) — the index an assistant should read first.
- [The AI skill](../packages/core/skill/SKILL.md) — also shipped inside the package, so consumers
  can copy it into their own `.claude/skills/`.
- Examples: [vanilla TypeScript](../examples/vanilla-ts), [React](../examples/react),
  [Next.js and SSR](../examples/next-ssr).

Every page here is plain markdown with no site-generator syntax, so pointing VitePress, Astro or
Docusaurus at this directory is a configuration change rather than a rewrite.
