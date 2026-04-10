# Design Decisions

Things a rebuilder can't figure out from the code or the database alone.

## Architecture

- Go backend + vanilla JS frontend + SQLite. No frameworks, no build step. Static files (`static/`) and HTML templates (`templates/`) are served from disk so CSS/JS/HTML changes take effect on browser refresh without recompiling the Go binary. Only `.go` file changes require recompilation. The binary runs from `code/` directory (`ADMIN_KEY=test ./notion-clone`).
- Auth is a single admin key (env var). No user accounts, no sessions. Shares authenticate via unique tokens. Keep it simple.
- `app.js` (admin editor) and `shared.js` (shared page editor) have parallel implementations. Any bug fix or feature change in one almost always needs the same change in the other.

## Block content is HTML

Block `content` is raw HTML, not markdown. The editor uses `contenteditable` divs. Whatever the browser produces is what gets saved.

## Comment creation flow

When the user selects text, a floating "Comment" button appears near the selection. Clicking it wraps the text in `<mark>` tags, opens the comments panel, and shows an inline form (textarea + Cancel/Comment buttons) at the top of the panel. No `prompt()` dialogs. The selection must be preserved across the button click (use `onmousedown` + `preventDefault`). Clicking a `<mark>` highlight scrolls to the corresponding comment thread; clicking a comment's quote scrolls to the highlight in the editor. On shared pages, the same UX applies for users with `can_comment=1` or `key_type=editor/commenter`.

## Comments panel UX

The comments panel is a right sidebar with no title header — just a close button. Comments render as floating bubble cards (white background, subtle shadow, no borders). They are ordered by block position in the document, not by creation date. Resolved comments show at reduced opacity with a "Resolved" label. The panel auto-opens when navigating to a page that has comments.

## Comment highlights live in the HTML

When an admin creates a comment by selecting text, the selection gets wrapped in `<mark class="comment-mark" data-comment-id="xxx">` directly in the block's HTML content. These tags are saved to the database. However, since blocks are bulk-saved with new IDs, comment `block_id` becomes NULL (FK cascade). On page load, `applyCommentHighlights()` scans ALL comments with `highlighted_text` that don't already have a `<mark>` in the DOM, and applies text-match highlights as a fallback — regardless of `author_type`.

## Images and files are relative paths

Image blocks store `{"src":"/uploads/filename.jpeg"}` and file blocks store `{"src":"/uploads/file.pdf","filename":"file.pdf"}` in properties. The `uploads/` directory is served statically. Paths must be relative, not absolute URLs, so the app works on any domain. The upload handler returns the original filename alongside the generated path so file blocks can display a meaningful name.

## Admin vs shared-user comments

Admin comments have `share_id = NULL` and `author_type = 'admin'`. Shared-user comments reference a `share_id` to identify who wrote them (the share's `alias` field). The SQL query uses a LEFT JOIN on shares to get the alias, with COALESCE to 'Admin' for null share_id.

## Nested pages via parent_id

Pages have a `parent_id` FK referencing `pages(id) ON DELETE CASCADE`. The sidebar renders a recursive tree. Expand/collapse state is persisted in `localStorage` (`expanded_pages` key). The "+" button on hover creates a child page by passing `parent_id` in the POST body. `page_link` blocks (type `page_link`, properties `{"page_id":"xxx"}`) are shortcuts/links to other pages, distinct from child pages — a child lives in the tree hierarchy, a page_link is just a block that navigates on click.

## Table block stores data in properties JSON

Table blocks use `properties.rows` as a 2D array: `[["H1","H2"],["C1","C2"]]`. First row is headers (`<th>`), rest are data (`<td>`). Each cell is individually `contenteditable="true"` while the block wrapper is `contenteditable="false"`. Table controls (add/delete row/column) are buttons outside the `<table>` element. Data is extracted from the DOM on save by walking `<tr>`/`<td>` elements.

## Share key_type replaces can_comment

The `shares` table has a `key_type` column: `'editor'`, `'viewer'`, or `'commenter'`. This replaces the old `can_comment` boolean for access control (though `can_comment` is kept for backwards compatibility and set automatically from `key_type`). Editor keys grant full page editing via shared token — the shared.js detects `key_type=editor` and enables contenteditable, slash commands, drag-and-drop, and auto-save through dedicated `/api/shared/{token}/page`, `/api/shared/{token}/blocks`, and `/api/shared/{token}/upload` endpoints. These endpoints validate the token's `key_type` server-side.

## Page action buttons are text, not emojis

Share and Comments buttons in the page header use text labels with subtle styling (small font, muted color) instead of emoji icons. Only the delete button keeps the 🗑️ emoji. This avoids the garish look of multiple colored emojis in the header.

## Formatting is keyboard-only, no toolbar

Bold (Ctrl+B), italic (Ctrl+I), strikethrough (Ctrl+Shift+X), and inline code (Ctrl+E) are only available via keyboard shortcuts. The only floating button on text selection is "Comment". Strikethrough uses `document.execCommand('strikeThrough')`. Inline code wraps selection in `<code class="inline-code">`. If the selection is a subset of an existing code span, it splits: before stays code, selection becomes plain, after stays code. This is a deliberate UX choice — no formatting toolbar.

## Code blocks have language metadata

Code blocks store `{"language":"javascript"}` (or empty for auto-detect) in properties. A `<select>` dropdown above the code block lets you pick the language. highlight.js (loaded via CDN) applies syntax coloring in all views — admin, shared editor, and read-only. The highlighting skips the code block the cursor is currently in to avoid cursor jumps (see AI_REBUILD_NOTES). If the CDN is unavailable, code renders plain — it's a progressive enhancement. The `rebuildBlock` function (used when converting blocks via markdown/slash commands) must also create the language selector — otherwise newly created code blocks won't have it.

## All views poll for updates

All views (admin, shared editor, viewer, commenter) poll the page every 3 seconds and compare `page.updated_at`. If changed, the view re-renders. For editor views (admin and shared editor), polling is skipped when: (1) there's a pending auto-save (`autoSaveTimer` active), or (2) the user has focus inside the editor. In shared editor mode, polling only updates comments/page metadata — it never re-renders blocks, to avoid cursor disruption.

## beforeunload saves pending changes

Both admin and shared editor register a `beforeunload` handler that flushes any pending auto-save. This prevents data loss when closing the tab during the 1-second debounce window.

## Emoji picker and page link search are modal popups

Both use clickable UI (not `prompt()`) — the emoji picker is a fixed-position grid that appears near the icon button, the page link search is a modal overlay with a text filter. Both close on outside click or Escape.

## Sub-bullet indentation via Tab/Shift+Tab

List blocks (bullet_list, numbered_list, todo) support nesting up to 4 levels deep: Tab makes the current list item a child of the previous sibling block (sets `parent_block_id`), Shift+Tab moves to the grandparent (or root if at level 1). Children render indented via the same `toggle-child` CSS class used for toggle children (`padding-left: 24px`). Nested numbered lists restart numbering from 1 within each parent group. Depth is calculated by walking the parent chain.

## Page drag-and-drop in sidebar

Pages have a `position` column (INTEGER, default 0) for ordering. The sidebar page items are draggable. Drop zones are divided into thirds: top = insert above (same parent), middle = make child, bottom = insert below. The `PUT /api/pages/{id}/move` endpoint accepts `parent_id` and `position`. Pages are ordered by `position ASC, updated_at DESC`. When dropping a page as a child, the parent auto-expands in the sidebar.

## LaTeX math blocks via KaTeX

Block type `math` stores raw LaTeX in `content`. KaTeX is loaded via CDN (CSS + JS). In the editor, the block has two child divs: `.math-preview` (rendered KaTeX, `contentEditable=false`) and `.math-input` (raw LaTeX, editable). On focus the preview hides and input shows; on blur, KaTeX renders and preview shows while input hides. In read-only shared view, only the rendered KaTeX is shown. The `$$` markdown shortcut creates a math block. If KaTeX CDN fails, raw LaTeX text is displayed as fallback.

## Internal page links in block content

`<a data-page-link="pageId">` tags inside block HTML content are clickable links to other pages. In the admin editor, clicking navigates via `selectPage()`. In shared views (both editor and read-only), clicking redirects to `/?page=pageId`. The admin app checks for a `?page=` URL parameter on load and navigates to that page, then cleans up the URL. This is distinct from `page_link` blocks (which are entire blocks that link to a page) — internal page links are inline within any block's text content.

## Regular links open in new tab on click

Because the editor uses `contenteditable`, clicking `<a href>` links normally just places the cursor. The `handleEditorClick` function intercepts clicks on `<a[href]>` elements and opens them in a new tab via `window.open(href, '_blank')`. This applies in admin editor and shared editor mode. The shared read-only view also has this handler for consistency.

## Last page restored on reload

The admin editor saves `currentPageId` to `localStorage` (`last_page_id` key) on every `selectPage()`. On init, if there's no `?page=` URL parameter, the stored page is reopened automatically. The page must still exist in `allPages` — stale IDs are ignored.

## Sidebar page search

The sidebar has a search input above the page list. When the search field is non-empty, the tree view is replaced with a flat filtered list of all pages whose title matches the query (case-insensitive). Clearing the search restores the full tree. The search input triggers on every keystroke via `oninput`.

## Empty blocks contain `<br>`, placeholders are cursor-tracked

Empty `.block-content` divs contain `<br>` so the browser can place the cursor there with arrow keys. `ensureBR(el)` adds it, `cleanContent(html)` strips it on save. Placeholder text ("Type '/' for commands...") only appears on the block with the cursor — tracked via `selectionchange` event toggling `has-cursor` class on the wrapper. The `::before` pseudo-element is `position: absolute` to avoid pushing the cursor. Blocks with `<br>` aren't CSS `:empty`, so an `is-empty` class is used instead.

## Blocks are bulk-saved

Every save deletes ALL blocks for the page and re-inserts with fresh IDs. This means:
- Block IDs change every save
- Toggle children reference parents via `parent_block_id` - old IDs must be remapped to new IDs before insert
- The Go `saveBlocks` function topologically sorts blocks so parents are inserted before children (FK constraint). The client may send blocks in any order.
- Comment `block_id` uses `ON DELETE SET NULL` so comments survive block re-creation

## Single contenteditable container

The `blocks-container` div is the single `contenteditable` element. Individual block divs are NOT contenteditable. This enables native cross-block text selection (needed for cross-block comments). Block handles are `contenteditable="false"`. All keyboard/input events are handled via delegation on the container, using `window.getSelection().anchorNode` to determine which block the cursor is in.
