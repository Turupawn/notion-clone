# Agent Instructions

## After every change

1. **Design decision?** (new pattern, architectural choice, non-obvious "why") → Add/update/remove entry in `DESIGN_DECISIONS.md`
2. **Bug fix?** (something broke and we learned why) → Add entry to `AI_REBUILD_NOTES.md`: what went wrong, why, the fix
3. **Neither?** → Don't touch the docs

Keep entries concise. One paragraph max each. Remove obsolete entries.

## Code conventions

Refer to `DESIGN_DECISIONS.md` for architectural choices and `AI_REBUILD_NOTES.md` for known pitfalls.

## When generating code/

Write a `code/GENERATED_BY` file with your model name and the date. One line, e.g. `Claude Opus 4.6 — 2026-04-07`.
