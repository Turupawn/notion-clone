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
On the shared page, when a user with comment access selects text, a small floating "Comment" button must appear near the selection (above or below the highlighted text). This is NOT the same as the fixed 💬 icon or the "Comments" header button - it's a separate element that appears only when text is selected. Implementation: listen for `mouseup` on the document, `setTimeout(10)`, check `window.getSelection().toString().trim()`, if non-empty position a `position:fixed` button near `range.getBoundingClientRect()`. The button's click must use `onmousedown` + `e.preventDefault()` (not onclick) to preserve the selection. On click, open the comment sidebar with the selected text as the quote. Access is now checked via `key_type` (`editor` or `commenter`), not `can_comment`.

## Live code highlighting without cursor jump
Applying `hljs.highlight()` replaces `innerHTML` of the code block, which destroys the cursor position. The old fix was to skip the active block, but this means no live highlighting while typing. **Fix**: before highlighting, insert a zero-width marker (`\u200B`) at the cursor, read `innerText` to get the character offset (including `\n`), remove the marker, apply hljs, then walk the text nodes to restore the cursor at the same offset. Call `highlightCodeBlocks()` from `handleInput` when `type === 'code'` and from `updateCursorBlock` when the cursor changes blocks.

## Code block content must use innerText, not textContent
`textContent` on a `<code>` element with contenteditable `<div>`/`<br>` children loses line breaks — everything joins into one line. **Fix**: use `innerText` both when saving code blocks (in `collectBlocks`) and when extracting text for highlighting. `innerText` preserves `\n` from visual line breaks.

## Polling re-renders destroy editor state
The 3s polling interval calls `renderPage()`/`renderEditor()` which rebuilds the entire DOM, wiping cursor position and any in-progress edits. **Fix**: for editor modes, skip polling entirely when the user has focus inside the editor (`document.activeElement.closest('#blocks-container')`). In shared editor mode, polling must never re-render blocks — only update `shareData.comments` and `shareData.page` metadata.

## Nested blocks need depth-based indentation, not a single CSS class
All blocks are flat siblings in the DOM. The `toggle-child` / `shared-toggle-child` class only adds one level of padding (24px). For multi-level nesting (e.g. bullet inside bullet inside bullet), a single class gives the same indentation at every depth. **Fix**: calculate the block's nesting depth by walking the parent chain, and set `data-depth="N"` on the element. CSS selectors `[data-depth="2"]`, `[data-depth="3"]`, etc. apply increasing padding. The `getBlockDepth(parentId)` helper counts ancestors from a given parent up.

## Links in contenteditable are not clickable by default
Clicking an `<a href>` inside a `contenteditable` div places the cursor instead of navigating. The browser treats it as text editing. **Fix**: intercept clicks on `a[href]` in `handleEditorClick` and call `window.open(link.href, '_blank')`. Also add `cursor: pointer` CSS for links inside `.block-content` / `.shared-block-content`.

## Empty blocks need `<br>` for arrow key navigation
In a single `contenteditable` container, an empty `<div class="block-content"></div>` has zero height from the browser's perspective. Arrow keys skip over it entirely — the cursor jumps from the block above to the block below. **Fix**: use `ensureBR(el)` to guarantee every empty `.block-content` has `<br>` inside. On save, `cleanContent(html)` strips lone `<br>` so it doesn't pollute the database.

## Placeholder text must not affect cursor position
The placeholder ("Type '/' for commands...") is rendered via CSS `::before` pseudo-element. Two problems: (1) it must only show on the block that has the cursor, not all empty blocks, and (2) it must not push the cursor to the right. **Fix**: (1) track which block has the cursor via `document.addEventListener('selectionchange', updateCursorBlock)` which toggles a `has-cursor` class on the active `.block-wrapper`. CSS shows the placeholder only on `.block-wrapper.has-cursor > .block-content`. (2) The `::before` must be `position: absolute` so it doesn't participate in text flow. Blocks with `<br>` inside are not CSS `:empty`, so use an additional `.is-empty` class toggled by `ensureBR()` and `handleInput()`.

## rebuildBlock must handle math blocks specially
Same pattern as code blocks below: when a block is converted to `math` via `$$` shortcut or slash command, `rebuildBlock()` must create the dual-div structure (`.math-preview` + `.math-input`) with focus/blur handlers. If it falls through to the generic `else` branch, the math block renders as raw HTML with no KaTeX.

## applySlashItem must save slashBlockId before hideSlashMenu
`hideSlashMenu()` sets `slashBlockId = null`. If `applySlashItem` calls `hideSlashMenu()` first and then tries to use `slashBlockId` to find the wrapper, it always gets null and silently returns. **Fix**: save `slashBlockId` to a local variable before calling `hideSlashMenu()`. Affects both app.js and shared.js.

## Block handle must be absolutely positioned, not a flex item
If `.block-handle` is a flex item inside `.block-wrapper`, it takes 24px of space and pushes list numbers and other prefix elements to the right. Worse, `padding-left` on nested blocks (`data-depth`) must account for the handle's space, or nested children shift left instead of right. **Fix**: make `.block-handle` `position: absolute; left: 0` and add `padding-left: 28px` to `.block-wrapper` so the handle sits in the padding area without affecting flex layout. Nesting depth padding must start from 28px base (52px, 76px, 100px, 124px for depths 1–4).

## Bullet marker must use ::after, not ::before
The placeholder ("Type '/' for commands...") uses `::before` on `.block-content`. The bullet marker (`•`) also used `::before`. When a bullet block is empty and has cursor, the placeholder has higher CSS specificity and overrides the bullet — so the bullet disappears until the user types something. **Fix**: use `::after` for the bullet marker. Both pseudo-elements can coexist since `::before` and `::after` are independent.

## Toggle must create child blocks on Enter and arrow click
Pressing Enter inside a toggle block must create a child paragraph (with `parentBlockId` set to the toggle's ID), not a sibling. Clicking the ▶ arrow to expand an empty toggle must also create an empty child block and focus it. Without this, toggles are useless — the user has no way to add content inside. Both `createBlockEl` and `rebuildBlock` toggle click handlers need this logic, in both app.js and shared.js.

## SQLite date format needs T separator for JavaScript
Go stores dates as `"2006-01-02 15:04:05"` (space-separated). JavaScript's `new Date()` needs ISO format with `T`. **Fix**: `formatTime` must do `dateStr.replace(' ', 'T') + 'Z'` before parsing. Without this, dates show as "Invalid Date". Affects both app.js and shared.js.

## Polling must not wipe the new-comment form
The 3-second polling interval calls `renderComments()` which rebuilds `comments-list` innerHTML. If the user is writing a new comment (inline form), the form gets destroyed. **Fix**: skip `renderComments()` during polling if `.new-comment-form` exists in the DOM.

## applyCommentHighlights must handle all comments, not just shared
`applyCommentHighlights` originally only applied text-match highlights for `author_type === 'share'` comments. But admin comments also lose their `<mark>` tags when block IDs change (bulk save sets `block_id` to NULL via FK cascade). **Fix**: apply highlights for ANY comment that has `highlighted_text` and no existing `<mark>` in the DOM, regardless of `author_type`.

## New comment mark ID mismatch after API response
When creating a comment, the `<mark>` gets a client-generated ID. After the API returns the server ID, the original `mark` DOM reference may be stale (if blocks were re-rendered by polling/auto-save). **Fix**: search the DOM for the mark by client ID (`document.querySelector('mark[data-comment-id="' + clientId + '"]')`) before updating to the server ID.

## rebuildBlock must handle code blocks specially
When a block is converted to `code` via markdown shortcut (```) or slash command, it goes through `rebuildBlock()`, not `createBlockEl()`. If `rebuildBlock` doesn't add the language `<select>` dropdown, newly created code blocks won't have it. This was missed initially because code blocks fell through to the generic `else` branch. **Fix**: add an explicit `else if (type === 'code')` branch in `rebuildBlock` in both app.js and shared.js.
