# Design Decisions

Things a rebuilder can't figure out from the code or the database alone.

## Architecture

- Go backend + vanilla JS frontend + SQLite. No frameworks, no build step. Single binary serves everything.
- Auth is a single admin key (env var). No user accounts, no sessions. Shares authenticate via unique tokens. Keep it simple.

## Block content is HTML

Block `content` is raw HTML, not markdown. The editor uses `contenteditable` divs. Whatever the browser produces is what gets saved.

## Comment creation flow

Both the admin editor and the shared page have the same commenting UX: when the user selects text, a floating "Comment" button appears near the selection. Clicking it opens the comments panel in a right sidebar and wraps the selected text in `<mark>` tags. The selection must be preserved across the button click (use `onmousedown` + `preventDefault` on the button, or save the Range). On the shared page, the floating button and sidebar must also work - shared users with `can_comment=1` can select text, click the floating button, and post comments. Clicking a `<mark>` highlight in the content should scroll to and highlight the corresponding comment thread in the sidebar.

## Comment highlights live in the HTML

When an admin creates a comment by selecting text, the selection gets wrapped in `<mark class="comment-mark" data-comment-id="xxx">` directly in the block's HTML content. These tags are saved to the database. This is intentional - the browser's contenteditable preserves inline elements through edits (splitting, adding spaces, merging), so the highlight survives text changes.

Shared-user comments can't do this (read-only view), so they store the quoted text in `highlighted_text` and the editor applies text-match highlights on load as a fallback.

## Images are relative paths

Image blocks store `{"src":"/uploads/filename.jpeg"}` in properties. The `uploads/` directory is served statically. Paths must be relative, not absolute URLs, so the app works on any domain.

## Admin vs shared-user comments

Admin comments have `share_id = NULL` and `author_type = 'admin'`. Shared-user comments reference a `share_id` to identify who wrote them (the share's `alias` field). The SQL query uses a LEFT JOIN on shares to get the alias, with COALESCE to 'Admin' for null share_id.

## Blocks are bulk-saved

Every save deletes ALL blocks for the page and re-inserts with fresh IDs. This means:
- Block IDs change every save
- Toggle children reference parents via `parent_block_id` - old IDs must be remapped to new IDs before insert
- Parents must be inserted before children (FK constraint)
- Comment `block_id` uses `ON DELETE SET NULL` so comments survive block re-creation

## Single contenteditable container

The `blocks-container` div is the single `contenteditable` element. Individual block divs are NOT contenteditable. This enables native cross-block text selection (needed for cross-block comments). Block handles are `contenteditable="false"`. All keyboard/input events are handled via delegation on the container, using `window.getSelection().anchorNode` to determine which block the cursor is in.
