Self-hosted Notion alternative. Block-based document editor with sharing and commenting. Single binary, no cloud dependency.

## Why

To stop paying Notion and handing them our data.

## Features

- 13 block types: paragraph, H1-H3, bullet/numbered lists, to-dos, toggles (collapsible with nested children), quotes, code, callouts, dividers, images
- Markdown shortcuts (`# `, `- `, `> `, etc.) and slash command menu (`/`)
- Drag-and-drop block reordering, auto-save
- Select text (even across blocks) to comment, with yellow inline highlights
- Threaded comment replies, resolve button to dismiss
- Named share links ("Juan", "Boss") - read-only content, recipients can comment
- Single admin key auth, no user accounts

## How to Run

```bash
[ -d data ] || cp -r dummy_data data
cd code && go mod tidy && go build -o notion-clone .
ADMIN_KEY=your-key ./notion-clone
```

Env vars: `ADMIN_KEY`, `PORT` (default 8080), `DB_PATH` (default ../data/data.db), `UPLOAD_DIR` (default ../data/uploads).

## Rebuilding with AI

`code/` is AI-generated and disposable. To regenerate it:

```bash
claude --dangerously-skip-permissions --verbose -p "Think very carefully and be extremely thorough. Generate the complete code/ directory. Read README.md, DESIGN_DECISIONS.md, AI_REBUILD_NOTES.md, AGENTS.md and run sqlite3 dummy_data/data.db '.schema'. Build and verify it compiles."
```

To switch models or architectures, delete `code/` and regenerate.

`data/` is gitignored — it's your production database and uploads. Back it up. Never commit it.

`dummy_data/` has example seed data. Copy it to `data/` to get started: `cp -r dummy_data data`.
