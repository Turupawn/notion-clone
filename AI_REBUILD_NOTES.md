# Pitfalls - What Went Wrong and How to Avoid It

Things that broke during development. If you're rebuilding this, don't repeat these mistakes.

## SQLite concurrency
Two concurrent writes (page title + block save) cause SQLITE_BUSY. **Fix**: `busy_timeout(5000)` pragma + `SetMaxOpenConns(1)`.

## Non-breaking spaces
contenteditable inserts `\u00a0` instead of regular spaces. Regex patterns like `/^# $/` won't match. **Fix**: normalize with `.replace(/\u00a0/g, ' ')` before matching.

## Heading handle alignment
If a heading block has `margin-top` on the inner element, the drag handle sits above the text. **Fix**: put the margin on the outer wrapper, not the inner block.

## Cursor after Enter
After DOM changes, `setCursorToBlock()` might not work because the container lost focus. **Fix**: focus the container first, then set the selection range inside the target block. Use `requestAnimationFrame` to wait for browser layout.

## Admin comments fail with FK constraint
Block IDs change on every bulk save. If an admin comment references a `block_id` that was just re-created with a new ID, the FK constraint fails. **Fix**: either use `ON DELETE SET NULL` for the comment's `block_id` FK, or verify the block_id exists before inserting (set to NULL if not found).

## Shared page: text selection must show floating comment button
On the shared page, when a user with `can_comment=1` selects text, a small floating "Comment" button must appear near the selection (above or below the highlighted text). This is NOT the same as the fixed 💬 icon or the "Comments" header button - it's a separate element that appears only when text is selected. Implementation: listen for `mouseup` on the document, `setTimeout(10)`, check `window.getSelection().toString().trim()`, if non-empty position a `position:fixed` button near `range.getBoundingClientRect()`. The button's click must use `onmousedown` + `e.preventDefault()` (not onclick) to preserve the selection. On click, open the comment sidebar with the selected text as the quote.
