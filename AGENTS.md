# Working in this repository

An agent picking up work here should read, in order:

1. [.claude/docs/PLAN.md](.claude/docs/PLAN.md) — the problem, the API, the storage format, the
   architecture, the milestones and the quality bar.
2. [.claude/docs/DECISIONS.md](.claude/docs/DECISIONS.md) — the ADR log. Every non-obvious choice
   is there with the alternative that lost.
3. [CLAUDE.md](CLAUDE.md) — the non-negotiables and the current status.

**Change the documents before the code.** A design change updates PLAN.md first and adds an ADR;
the code follows.

```bash
pnpm check   # typecheck + lint + test + build — everything CI runs
pnpm size    # the size budgets, which are part of the design
```

Using the library rather than working on it? Read
[the skill](packages/core/skill/SKILL.md) instead — it is written for exactly that.
