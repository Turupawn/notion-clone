// --- State ---
const token = window.location.pathname.split('/shared/')[1];
let shareData = null; // { page, blocks, comments, share }
let pendingCommentData = null;

const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => [...(el || document).querySelectorAll(s)];

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  loadSharedPage();
  bindEvents();
});

function bindEvents() {
  $('#shared-comments-btn').onclick = toggleCommentsSidebar;
  $('#close-comments-btn').onclick = () => { $('#comments-sidebar').style.display = 'none'; };
  $('#cancel-comment-btn').onclick = cancelComment;
  $('#submit-comment-btn').onclick = submitComment;

  // Text selection for comments
  document.addEventListener('mouseup', handleTextSelection);
  $('#floating-comment-btn').addEventListener('mousedown', e => e.preventDefault());
  $('#floating-comment-btn').addEventListener('click', startCommentFromSelection);
}

// --- Load ---
async function loadSharedPage() {
  const res = await fetch(`/api/shared/${token}`);
  if (!res.ok) {
    document.body.innerHTML = '<div style="padding:40px;text-align:center;color:#787774;">Page not found or link is invalid.</div>';
    return;
  }
  shareData = await res.json();
  renderPage();
}

function renderPage() {
  const { page, blocks, comments, share } = shareData;
  document.title = page.title + ' — Shared';
  $('#shared-icon').textContent = page.icon || '📄';
  $('#shared-title').textContent = page.title;

  renderBlocks(blocks);
  applySharedHighlights(comments);

  // Hide comment button if can't comment
  if (!share.can_comment) {
    $('#floating-comment-btn').remove();
  }
}

function renderBlocks(blocks) {
  const container = $('#shared-content');
  container.innerHTML = '';
  blocks.forEach(b => {
    const el = createBlockEl(b);
    container.appendChild(el);
  });
}

function createBlockEl(block) {
  const div = document.createElement('div');
  div.className = 'shared-block';
  div.dataset.blockId = block.id;
  div.dataset.type = block.type;

  if (block.parent_block_id) {
    div.className += ' shared-toggle-child';
    div.dataset.parent = block.parent_block_id;
  }

  let props = {};
  try { props = JSON.parse(block.properties || '{}'); } catch(e) {}

  const type = block.type;

  if (type === 'divider') {
    const hr = document.createElement('hr');
    hr.className = 'divider-line';
    div.appendChild(hr);
    return div;
  }

  if (type === 'image') {
    const img = document.createElement('img');
    img.src = props.src || '';
    img.alt = block.content || '';
    div.appendChild(img);
    return div;
  }

  if (type === 'bullet_list' || type === 'numbered_list' || type === 'todo' || type === 'toggle') {
    const row = document.createElement('div');
    row.className = 'shared-block-row';

    if (type === 'bullet_list') {
      const marker = document.createElement('span');
      marker.className = 'list-marker';
      marker.textContent = '•';
      row.appendChild(marker);
    } else if (type === 'numbered_list') {
      const marker = document.createElement('span');
      marker.className = 'list-marker';
      marker.textContent = '1.';
      row.appendChild(marker);
    } else if (type === 'todo') {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'todo-checkbox';
      cb.checked = !!props.checked;
      cb.disabled = true;
      if (props.checked) div.classList.add('checked');
      row.appendChild(cb);
    } else if (type === 'toggle') {
      const arrow = document.createElement('span');
      arrow.className = 'toggle-arrow expanded';
      arrow.textContent = '▶';
      arrow.onclick = () => toggleToggle(div);
      row.appendChild(arrow);
    }

    const content = document.createElement('div');
    content.className = 'shared-block-content';
    content.innerHTML = block.content || '';
    row.appendChild(content);
    div.appendChild(row);
    return div;
  }

  // Simple blocks
  const content = document.createElement('div');
  content.className = 'shared-block-content';
  content.innerHTML = block.content || '';
  div.appendChild(content);
  return div;
}

function toggleToggle(blockEl) {
  const arrow = $('.toggle-arrow', blockEl);
  const blockId = blockEl.dataset.blockId;
  const expanded = arrow.classList.toggle('expanded');
  $$(`[data-parent="${blockId}"]`).forEach(child => {
    child.classList.toggle('collapsed', !expanded);
  });
}

// Renumber lists
(function renumberLists() {
  setTimeout(() => {
    const blocks = $$('#shared-content > .shared-block');
    let num = 0;
    blocks.forEach(b => {
      if (b.dataset.type === 'numbered_list' && !b.dataset.parent) {
        num++;
        const marker = $('.list-marker', b);
        if (marker) marker.textContent = num + '.';
      } else if (b.dataset.type !== 'numbered_list') {
        num = 0;
      }
    });
  }, 0);
})();

// --- Shared Comment Highlights ---
function applySharedHighlights(comments) {
  // Admin comments already have <mark> tags in the HTML
  // For shared-user comments, do text-match highlighting
  comments.forEach(c => {
    if (c.author_type === 'share' && c.highlighted_text && !c.resolved && !c.parent_comment_id) {
      const blocks = $$('.shared-block-content');
      for (const block of blocks) {
        const idx = block.innerHTML.indexOf(c.highlighted_text);
        if (idx !== -1) {
          // Only highlight if not already inside a mark
          const before = block.innerHTML.substring(0, idx);
          if (!before.match(/<mark[^>]*>$/)) {
            block.innerHTML = before +
              `<mark class="shared-mark" data-comment-id="${c.id}">${c.highlighted_text}</mark>` +
              block.innerHTML.substring(idx + c.highlighted_text.length);
          }
          break;
        }
      }
    }
  });

  // Bind click on marks to scroll to comment in sidebar
  $$('mark.comment-mark, mark.shared-mark').forEach(mark => {
    mark.addEventListener('click', () => {
      showCommentsSidebar();
      highlightCommentInSidebar(mark.dataset.commentId);
    });
  });
}

// --- Text Selection ---
function handleTextSelection() {
  if (!shareData?.share?.can_comment) return;
  const btn = $('#floating-comment-btn');
  if (!btn) return;

  setTimeout(() => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text) { btn.style.display = 'none'; return; }

    let node = sel.anchorNode;
    let inContent = false;
    while (node) {
      if (node.id === 'shared-content') { inContent = true; break; }
      node = node.parentElement;
    }
    if (!inContent) { btn.style.display = 'none'; return; }

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    btn.style.display = 'block';
    btn.style.left = (rect.left + rect.width / 2 - 30) + 'px';
    btn.style.top = (rect.top - 32) + 'px';
  }, 10);
}

function startCommentFromSelection() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const text = sel.toString().trim();
  if (!text) return;

  // Find which block
  let node = sel.getRangeAt(0).startContainer;
  let block = null;
  while (node) {
    if (node.nodeType === 1 && node.classList?.contains('shared-block')) {
      block = node; break;
    }
    node = node.parentElement;
  }

  pendingCommentData = {
    highlightedText: text,
    blockId: block?.dataset.blockId || null,
  };

  sel.removeAllRanges();
  $('#floating-comment-btn').style.display = 'none';

  showCommentsSidebar();
  showNewCommentBox(text);
}

// --- Comments Sidebar ---
function toggleCommentsSidebar() {
  const sidebar = $('#comments-sidebar');
  if (sidebar.style.display === 'none') {
    showCommentsSidebar();
  } else {
    sidebar.style.display = 'none';
  }
}

function showCommentsSidebar() {
  $('#comments-sidebar').style.display = 'flex';
  if (shareData) renderComments(shareData.comments);
}

function renderComments(comments) {
  const list = $('#comments-list');
  list.innerHTML = '';

  const threads = [];
  const replyMap = {};
  comments.forEach(c => {
    if (!c.parent_comment_id) {
      threads.push(c);
    } else {
      if (!replyMap[c.parent_comment_id]) replyMap[c.parent_comment_id] = [];
      replyMap[c.parent_comment_id].push(c);
    }
  });

  if (threads.length === 0) {
    list.innerHTML = '<div style="padding:16px;color:var(--color-text-muted);font-size:13px;">No comments yet</div>';
    return;
  }

  threads.forEach(thread => {
    const threadEl = document.createElement('div');
    threadEl.className = 'comment-thread' + (thread.resolved ? ' resolved' : '');
    threadEl.dataset.commentId = thread.id;

    threadEl.appendChild(createCommentItemEl(thread, true));

    const replies = replyMap[thread.id] || [];
    replies.forEach(reply => {
      threadEl.appendChild(createCommentItemEl(reply, false));
    });

    list.appendChild(threadEl);
  });
}

function createCommentItemEl(comment, isTopLevel) {
  const div = document.createElement('div');
  div.className = 'comment-item' + (isTopLevel ? '' : ' reply');
  div.dataset.commentId = comment.id;

  let html = '';
  if (comment.highlighted_text && isTopLevel) {
    html += `<div class="comment-quote">"${escHtml(comment.highlighted_text)}"</div>`;
  }
  html += `<div class="comment-author">${escHtml(comment.author_name)}</div>`;
  html += `<div class="comment-text">${escHtml(comment.content)}</div>`;
  html += `<div class="comment-meta">${formatDate(comment.created_at)}</div>`;

  if (isTopLevel && shareData?.share?.can_comment) {
    html += '<div class="comment-actions">';
    html += `<button class="comment-action-btn reply-btn" data-id="${comment.id}">Reply</button>`;
    html += '</div>';
  }

  div.innerHTML = html;

  // Bind reply
  const replyBtn = div.querySelector('.reply-btn');
  if (replyBtn) {
    replyBtn.onclick = () => {
      pendingCommentData = { highlightedText: '', blockId: null };
      showNewCommentBox('', comment.id);
    };
  }

  return div;
}

function highlightCommentInSidebar(commentId) {
  const el = $(`.comment-thread[data-comment-id="${commentId}"], .comment-item[data-comment-id="${commentId}"]`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('highlight-flash');
    setTimeout(() => el.classList.remove('highlight-flash'), 1500);
  }
}

// --- New Comment ---
function showNewCommentBox(quote, parentCommentId) {
  const box = $('#new-comment-box');
  box.style.display = 'block';
  $('#new-comment-quote').textContent = quote || '';
  $('#new-comment-input').value = '';
  $('#new-comment-input').dataset.parentCommentId = parentCommentId || '';
  setTimeout(() => $('#new-comment-input').focus(), 50);
}

function cancelComment() {
  $('#new-comment-box').style.display = 'none';
  pendingCommentData = null;
}

async function submitComment() {
  const content = $('#new-comment-input').value.trim();
  if (!content) return;
  const parentCommentId = $('#new-comment-input').dataset.parentCommentId || null;

  const body = {
    content,
    highlighted_text: pendingCommentData?.highlightedText || '',
    block_id: pendingCommentData?.blockId || null,
    parent_comment_id: parentCommentId || null,
  };

  const res = await fetch(`/api/shared/${token}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    alert('Failed to post comment');
    return;
  }

  const comment = await res.json();
  pendingCommentData = null;
  $('#new-comment-box').style.display = 'none';

  // Refresh comments
  shareData.comments.push(comment);
  renderComments(shareData.comments);
}

// --- Utilities ---
function escHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr + (dateStr.includes('Z') ? '' : 'Z'));
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return dateStr;
  }
}
