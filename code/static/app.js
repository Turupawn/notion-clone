// --- State ---
let adminKey = localStorage.getItem('admin_key') || '';
let currentPageId = null;
let autoSaveTimer = null;
let slashState = null; // { blockEl, startOffset }
let dragState = null;  // { el, startY }
let pendingCommentData = null; // { highlightedText, blockId, range }

const SLASH_ITEMS = [
  { type: 'paragraph', label: 'Text', icon: 'Aa' },
  { type: 'heading1', label: 'Heading 1', icon: 'H1' },
  { type: 'heading2', label: 'Heading 2', icon: 'H2' },
  { type: 'heading3', label: 'Heading 3', icon: 'H3' },
  { type: 'bullet_list', label: 'Bullet List', icon: '•' },
  { type: 'numbered_list', label: 'Numbered List', icon: '1.' },
  { type: 'todo', label: 'To-do', icon: '☑' },
  { type: 'toggle', label: 'Toggle', icon: '▶' },
  { type: 'quote', label: 'Quote', icon: '"' },
  { type: 'code', label: 'Code', icon: '</>' },
  { type: 'callout', label: 'Callout', icon: '💡' },
  { type: 'divider', label: 'Divider', icon: '—' },
  { type: 'image', label: 'Image', icon: '🖼' },
];
let slashActiveIndex = 0;
let filteredSlashItems = [];

// --- API ---
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'X-Admin-Key': adminKey },
  };
  if (body && !(body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (body instanceof FormData) {
    opts.body = body;
  }
  const res = await fetch(path, opts);
  if (res.status === 401) {
    adminKey = '';
    localStorage.removeItem('admin_key');
    showLogin();
    return null;
  }
  return res.json();
}

// --- DOM helpers ---
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => [...(el || document).querySelectorAll(s)];

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  if (!adminKey) {
    showLogin();
  } else {
    showApp();
  }
  bindEvents();
});

function showLogin() {
  $('#login-overlay').style.display = 'flex';
  $('#app').style.display = 'none';
  setTimeout(() => $('#login-key').focus(), 50);
}

function showApp() {
  $('#login-overlay').style.display = 'none';
  $('#app').style.display = 'flex';
  loadPages();
}

// --- Events ---
function bindEvents() {
  // Login
  $('#login-btn').onclick = doLogin;
  $('#login-key').onkeydown = e => { if (e.key === 'Enter') doLogin(); };

  // Sidebar
  $('#new-page-btn').onclick = createPage;

  // Topbar
  $('#page-title').oninput = () => scheduleAutoSave();
  $('#icon-btn').onclick = pickIcon;
  $('#share-btn').onclick = openShareModal;
  $('#comments-btn').onclick = toggleCommentsSidebar;
  $('#delete-page-btn').onclick = deletePage;

  // Editor container
  const container = $('#blocks-container');
  container.addEventListener('input', handleInput);
  container.addEventListener('keydown', handleKeyDown);
  container.addEventListener('click', handleEditorClick);
  container.addEventListener('dragstart', handleDragStart);
  container.addEventListener('dragover', handleDragOver);
  container.addEventListener('drop', handleDrop);
  container.addEventListener('dragend', handleDragEnd);

  // Text selection for comments
  document.addEventListener('mouseup', handleTextSelection);

  // Floating comment button
  $('#floating-comment-btn').addEventListener('mousedown', e => {
    e.preventDefault(); // preserve selection
  });
  $('#floating-comment-btn').addEventListener('click', startCommentFromSelection);

  // Comments sidebar
  $('#close-comments-btn').onclick = () => {
    $('#comments-sidebar').style.display = 'none';
  };
  $('#cancel-comment-btn').onclick = cancelComment;
  $('#submit-comment-btn').onclick = submitComment;

  // Share modal
  $('#close-share-modal').onclick = () => { $('#share-modal').style.display = 'none'; };
  $('#share-modal').onclick = e => { if (e.target === $('#share-modal')) $('#share-modal').style.display = 'none'; };
  $('#create-share-btn').onclick = createShare;

  // Slash menu
  document.addEventListener('click', e => {
    if (slashState && !$('#slash-menu').contains(e.target)) hideSlashMenu();
  });

  // Image upload
  $('#image-upload').onchange = handleImageUpload;
}

function doLogin() {
  const key = $('#login-key').value.trim();
  if (!key) return;
  adminKey = key;
  localStorage.setItem('admin_key', key);
  showApp();
}

// --- Pages ---
async function loadPages() {
  const pages = await api('GET', '/api/pages');
  if (!pages) return;
  renderPageList(pages);
}

function renderPageList(pages) {
  const list = $('#page-list');
  list.innerHTML = '';
  pages.forEach(p => {
    const div = document.createElement('div');
    div.className = 'page-item' + (p.id === currentPageId ? ' active' : '');
    div.innerHTML = `<span class="page-item-icon">${p.icon || '📄'}</span>${escHtml(p.title)}`;
    div.onclick = () => selectPage(p.id);
    list.appendChild(div);
  });
}

async function selectPage(id) {
  if (autoSaveTimer) { clearTimeout(autoSaveTimer); await saveAll(); }
  currentPageId = id;
  const data = await api('GET', `/api/pages/${id}`);
  if (!data) return;
  renderEditor(data.page, data.blocks);
  loadPages(); // refresh sidebar active state
}

function renderEditor(page, blocks) {
  $('#empty-state').style.display = 'none';
  $('#page-editor').style.display = 'flex';
  $('#page-title').value = page.title;
  $('#icon-btn').textContent = page.icon || '📄';
  renderBlocks(blocks);
}

async function createPage() {
  const page = await api('POST', '/api/pages', { title: '', icon: '' });
  if (!page) return;
  await loadPages();
  selectPage(page.id);
}

async function deletePage() {
  if (!currentPageId) return;
  if (!confirm('Delete this page?')) return;
  await api('DELETE', `/api/pages/${currentPageId}`);
  currentPageId = null;
  $('#page-editor').style.display = 'none';
  $('#empty-state').style.display = 'flex';
  $('#comments-sidebar').style.display = 'none';
  loadPages();
}

function pickIcon() {
  const icons = ['📄','📘','📋','🎨','📝','📊','🚀','💡','🔧','📦','🎯','🏠','⭐','📌','🔑','🗂'];
  const icon = prompt('Pick an icon:\n' + icons.join(' '), $('#icon-btn').textContent);
  if (icon !== null) {
    $('#icon-btn').textContent = icon || '📄';
    scheduleAutoSave();
  }
}

// --- Block Rendering ---
function renderBlocks(blocks) {
  const container = $('#blocks-container');
  container.innerHTML = '';
  if (!blocks || blocks.length === 0) {
    const el = createBlockEl({ id: tempId(), type: 'paragraph', content: '', properties: '{}' });
    container.appendChild(el);
    return;
  }
  blocks.forEach(b => {
    const el = createBlockEl(b);
    container.appendChild(el);
  });
}

function tempId() {
  return 'tmp_' + Math.random().toString(36).substr(2, 12);
}

function createBlockEl(block) {
  const wrapper = document.createElement('div');
  wrapper.className = 'block-wrapper';
  if (block.parent_block_id) {
    wrapper.className += ' toggle-child';
    wrapper.dataset.parent = block.parent_block_id;
    // Check if parent toggle is collapsed
    const parentEl = $(`[data-block-id="${block.parent_block_id}"]`);
    if (parentEl) {
      const arrow = $('.toggle-arrow', parentEl);
      if (arrow && !arrow.classList.contains('expanded')) {
        wrapper.classList.add('collapsed');
      }
    }
  }
  wrapper.dataset.blockId = block.id;
  wrapper.dataset.type = block.type;

  // Handle
  const handle = document.createElement('div');
  handle.className = 'block-handle';
  handle.contentEditable = 'false';
  handle.draggable = true;
  handle.innerHTML = '<svg viewBox="0 0 10 20"><circle cx="3" cy="4" r="1.2"/><circle cx="7" cy="4" r="1.2"/><circle cx="3" cy="10" r="1.2"/><circle cx="7" cy="10" r="1.2"/><circle cx="3" cy="16" r="1.2"/><circle cx="7" cy="16" r="1.2"/></svg>';
  wrapper.appendChild(handle);

  const type = block.type;
  let props = {};
  try { props = JSON.parse(block.properties || '{}'); } catch(e) {}

  if (type === 'divider') {
    wrapper.contentEditable = 'false';
    const hr = document.createElement('hr');
    hr.className = 'divider-line';
    wrapper.appendChild(hr);
    return wrapper;
  }

  if (type === 'image') {
    const content = document.createElement('div');
    content.className = 'block-content';
    content.contentEditable = 'false';
    const img = document.createElement('img');
    img.src = props.src || '';
    img.alt = block.content || '';
    content.appendChild(img);
    wrapper.appendChild(content);
    return wrapper;
  }

  // Types with row layout: bullet, numbered, todo, toggle
  if (type === 'bullet_list' || type === 'numbered_list' || type === 'todo' || type === 'toggle') {
    const row = document.createElement('div');
    row.className = 'block-row';

    if (type === 'bullet_list') {
      const marker = document.createElement('span');
      marker.className = 'list-marker';
      marker.contentEditable = 'false';
      marker.textContent = '•';
      row.appendChild(marker);
    } else if (type === 'numbered_list') {
      const marker = document.createElement('span');
      marker.className = 'list-marker';
      marker.contentEditable = 'false';
      marker.textContent = '1.';
      row.appendChild(marker);
    } else if (type === 'todo') {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'todo-checkbox';
      cb.contentEditable = 'false';
      cb.checked = !!props.checked;
      if (props.checked) wrapper.classList.add('checked');
      cb.onchange = () => {
        wrapper.classList.toggle('checked', cb.checked);
        scheduleAutoSave();
      };
      row.appendChild(cb);
    } else if (type === 'toggle') {
      const arrow = document.createElement('span');
      arrow.className = 'toggle-arrow expanded';
      arrow.contentEditable = 'false';
      arrow.textContent = '▶';
      arrow.onclick = () => toggleToggle(wrapper);
      row.appendChild(arrow);
    }

    const content = document.createElement('div');
    content.className = 'block-content';
    content.innerHTML = block.content || '';
    setPlaceholder(content, type);
    row.appendChild(content);
    wrapper.appendChild(row);
    return wrapper;
  }

  // Simple block types: paragraph, heading, quote, code, callout
  const content = document.createElement('div');
  content.className = 'block-content';
  content.innerHTML = block.content || '';
  setPlaceholder(content, type);
  wrapper.appendChild(content);
  return wrapper;
}

function setPlaceholder(el, type) {
  const placeholders = {
    paragraph: "Type '/' for commands...",
    heading1: 'Heading 1',
    heading2: 'Heading 2',
    heading3: 'Heading 3',
    quote: 'Quote',
    code: 'Code',
    callout: 'Callout',
    bullet_list: 'List item',
    numbered_list: 'List item',
    todo: 'To-do',
    toggle: 'Toggle',
  };
  if (placeholders[type]) el.setAttribute('data-placeholder', placeholders[type]);
}

function toggleToggle(wrapperEl) {
  const arrow = $('.toggle-arrow', wrapperEl);
  const blockId = wrapperEl.dataset.blockId;
  const expanded = arrow.classList.toggle('expanded');
  $$(`[data-parent="${blockId}"]`).forEach(child => {
    child.classList.toggle('collapsed', !expanded);
  });
}

function renumberLists() {
  const wrappers = $$('#blocks-container > .block-wrapper');
  let num = 0;
  wrappers.forEach(w => {
    if (w.dataset.type === 'numbered_list' && !w.dataset.parent) {
      num++;
      const marker = $('.list-marker', w);
      if (marker) marker.textContent = num + '.';
    } else if (w.dataset.type !== 'numbered_list') {
      num = 0;
    }
  });
}

// --- Block Data Extraction ---
function getBlocksData() {
  const blocks = [];
  const wrappers = $$('#blocks-container > .block-wrapper');

  // Calculate positions
  let topPos = 0;
  const childPos = {};

  wrappers.forEach(w => {
    const type = w.dataset.type;
    const parentId = w.dataset.parent || '';
    let content = '';
    let props = '{}';

    if (type === 'divider') {
      content = '';
    } else if (type === 'image') {
      const img = $('img', w);
      content = img ? img.alt : '';
      props = JSON.stringify({ src: img ? img.getAttribute('src') : '' });
    } else if (type === 'todo') {
      const cb = $('.todo-checkbox', w);
      content = $('.block-content', w)?.innerHTML || '';
      props = JSON.stringify({ checked: cb ? cb.checked : false });
    } else {
      content = $('.block-content', w)?.innerHTML || '';
    }

    let position;
    if (!parentId) {
      position = topPos++;
    } else {
      if (!(parentId in childPos)) childPos[parentId] = 0;
      position = childPos[parentId]++;
    }

    blocks.push({
      client_id: w.dataset.blockId,
      type,
      content,
      properties: props,
      position,
      parent_client_id: parentId,
    });
  });

  return blocks;
}

// --- Save ---
function scheduleAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => saveAll(), 1000);
}

async function saveAll() {
  if (!currentPageId) return;
  autoSaveTimer = null;

  const title = $('#page-title').value;
  const icon = $('#icon-btn').textContent;

  await Promise.all([
    api('PUT', `/api/pages/${currentPageId}`, { title, icon, cover_image: '' }),
    api('PUT', `/api/pages/${currentPageId}/blocks`, { blocks: getBlocksData() }),
  ]);

  renumberLists();
  loadPages();
}

// --- Input Handling ---
function handleInput(e) {
  const block = getCurrentBlock();
  if (!block) return;

  // Check markdown shortcuts
  if (block.dataset.type === 'paragraph') {
    const contentEl = $('.block-content', block);
    if (contentEl) {
      const text = contentEl.textContent.replace(/\u00a0/g, ' ');
      if (checkMarkdownShortcut(block, contentEl, text)) return;
    }
  }

  // Check slash command
  if (slashState) {
    updateSlashFilter();
  } else {
    const contentEl = $('.block-content', getCurrentBlock());
    if (contentEl) {
      const text = contentEl.textContent;
      const match = text.match(/(?:^|\s)\/([a-z0-9]*)$/i);
      if (match) {
        const offset = text.lastIndexOf('/');
        slashState = { blockEl: getCurrentBlock(), slashOffset: offset };
        slashActiveIndex = 0;
        showSlashMenu();
        updateSlashFilter();
      }
    }
  }

  scheduleAutoSave();
}

function checkMarkdownShortcut(block, contentEl, text) {
  const shortcuts = [
    { re: /^# $/, type: 'heading1' },
    { re: /^## $/, type: 'heading2' },
    { re: /^### $/, type: 'heading3' },
    { re: /^- $/, type: 'bullet_list' },
    { re: /^\* $/, type: 'bullet_list' },
    { re: /^1\. $/, type: 'numbered_list' },
    { re: /^\[\] $/, type: 'todo' },
    { re: /^\[ \] $/, type: 'todo' },
    { re: /^> $/, type: 'quote' },
    { re: /^```$/, type: 'code' },
    { re: /^---$/, type: 'divider' },
  ];

  for (const s of shortcuts) {
    if (s.re.test(text)) {
      convertBlock(block, s.type);
      if (s.type !== 'divider') {
        const newContent = $('.block-content', block);
        if (newContent) {
          newContent.innerHTML = '';
          setCursorToBlock(block, true);
        }
      }
      scheduleAutoSave();
      return true;
    }
  }
  return false;
}

function handleKeyDown(e) {
  // Slash menu navigation
  if (slashState) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      slashActiveIndex = Math.min(slashActiveIndex + 1, filteredSlashItems.length - 1);
      renderSlashItems();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      slashActiveIndex = Math.max(slashActiveIndex - 1, 0);
      renderSlashItems();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredSlashItems.length > 0) {
        executeSlashCommand(filteredSlashItems[slashActiveIndex].type);
      }
      hideSlashMenu();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hideSlashMenu();
      return;
    }
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    handleEnter(e);
    return;
  }

  if (e.key === 'Backspace') {
    handleBackspace(e);
    return;
  }

  if (e.key === 'Tab') {
    const block = getCurrentBlock();
    if (block && block.dataset.type === 'code') {
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
    }
    return;
  }
}

function handleEnter(e) {
  const block = getCurrentBlock();
  if (!block) return;
  e.preventDefault();

  const type = block.dataset.type;

  // Divider/image: just create a paragraph after
  if (type === 'divider' || type === 'image') {
    insertBlockAfter(block, 'paragraph', '');
    return;
  }

  const contentEl = $('.block-content', block);
  if (!contentEl) return;

  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);

  // If toggle block and cursor is in the title, create a child block
  if (type === 'toggle') {
    const text = contentEl.textContent;
    // If at end or content is not empty, create child
    const afterRange = document.createRange();
    afterRange.setStart(range.endContainer, range.endOffset);
    afterRange.setEndAfter(contentEl.lastChild || contentEl);
    const afterFrag = afterRange.extractContents();
    const afterHTML = fragmentToHTML(afterFrag);

    // Create child paragraph
    const childEl = createBlockEl({
      id: tempId(), type: 'paragraph', content: afterHTML, properties: '{}',
      parent_block_id: block.dataset.blockId,
    });
    childEl.classList.add('toggle-child');
    childEl.dataset.parent = block.dataset.blockId;

    // Insert after last child of this toggle, or right after the toggle
    const children = $$(`[data-parent="${block.dataset.blockId}"]`);
    const lastChild = children.length > 0 ? children[children.length - 1] : block;
    lastChild.after(childEl);

    // Ensure toggle is expanded
    const arrow = $('.toggle-arrow', block);
    if (arrow && !arrow.classList.contains('expanded')) {
      arrow.classList.add('expanded');
      $$(`[data-parent="${block.dataset.blockId}"]`).forEach(c => c.classList.remove('collapsed'));
    }

    setCursorToBlock(childEl, true);
    scheduleAutoSave();
    return;
  }

  // Toggle child: if empty, exit the toggle
  if (block.dataset.parent && contentEl.textContent.trim() === '') {
    // Convert to top-level paragraph after the parent toggle's children
    delete block.dataset.parent;
    block.classList.remove('toggle-child');
    block.style.paddingLeft = '';
    block.dataset.type = 'paragraph';

    // Move after all siblings of the same parent
    const parentId = block.dataset.parent;
    // Already removed parent ref, just rebuild as paragraph
    rebuildBlock(block, 'paragraph', '');
    setCursorToBlock(block, true);
    scheduleAutoSave();
    return;
  }

  // Split content at cursor
  const afterRange2 = document.createRange();
  afterRange2.setStart(range.endContainer, range.endOffset);
  if (contentEl.lastChild) {
    afterRange2.setEndAfter(contentEl.lastChild);
  } else {
    afterRange2.setEnd(contentEl, contentEl.childNodes.length);
  }
  const afterFrag2 = afterRange2.extractContents();
  const afterHTML2 = fragmentToHTML(afterFrag2);

  // Determine new block type
  let newType = 'paragraph';
  if (type === 'bullet_list' || type === 'numbered_list' || type === 'todo') {
    // If current block is now empty, convert it to paragraph instead
    if (contentEl.textContent.trim() === '' && afterHTML2.trim() === '') {
      convertBlock(block, 'paragraph');
      setCursorToBlock(block, true);
      scheduleAutoSave();
      return;
    }
    newType = type;
  }

  // Create new block with the "after" content
  const parentId = block.dataset.parent || '';
  const newBlock = createBlockEl({
    id: tempId(),
    type: newType,
    content: afterHTML2,
    properties: newType === 'todo' ? '{"checked":false}' : '{}',
    parent_block_id: parentId || undefined,
  });
  if (parentId) {
    newBlock.classList.add('toggle-child');
    newBlock.dataset.parent = parentId;
  }

  // Insert after current block (but before next non-child)
  const nextNonChild = getNextNonChildSibling(block);
  if (nextNonChild) {
    block.parentElement.insertBefore(newBlock, nextNonChild);
  } else {
    block.parentElement.appendChild(newBlock);
  }

  setCursorToBlock(newBlock, true);
  renumberLists();
  scheduleAutoSave();
}

function handleBackspace(e) {
  const block = getCurrentBlock();
  if (!block) return;

  const type = block.dataset.type;
  if (type === 'divider' || type === 'image') {
    e.preventDefault();
    const prev = getPreviousBlock(block);
    block.remove();
    if (prev) setCursorToBlock(prev, false);
    scheduleAutoSave();
    return;
  }

  if (!isCursorAtStart()) return;

  const contentEl = $('.block-content', block);
  if (!contentEl) return;

  e.preventDefault();

  // If not paragraph, convert to paragraph
  if (type !== 'paragraph') {
    convertBlock(block, 'paragraph');
    setCursorToBlock(block, true);
    scheduleAutoSave();
    return;
  }

  // Merge with previous
  const prev = getPreviousBlock(block);
  if (!prev) return;
  if (prev.dataset.type === 'divider' || prev.dataset.type === 'image') {
    prev.remove();
    scheduleAutoSave();
    return;
  }

  const prevContent = $('.block-content', prev);
  if (!prevContent) return;

  // Save cursor position at end of previous
  const savedLen = prevContent.textContent.length;

  // Move content from current to previous
  while (contentEl.firstChild) {
    prevContent.appendChild(contentEl.firstChild);
  }
  block.remove();

  setCursorToBlockAt(prev, savedLen);
  renumberLists();
  scheduleAutoSave();
}

// --- Block Operations ---
function insertBlockAfter(refBlock, type, content) {
  const newBlock = createBlockEl({
    id: tempId(), type, content, properties: type === 'todo' ? '{"checked":false}' : '{}',
  });
  const next = getNextNonChildSibling(refBlock);
  if (next) {
    refBlock.parentElement.insertBefore(newBlock, next);
  } else {
    refBlock.parentElement.appendChild(newBlock);
  }
  setCursorToBlock(newBlock, true);
  renumberLists();
  scheduleAutoSave();
  return newBlock;
}

function convertBlock(blockEl, newType) {
  const oldType = blockEl.dataset.type;
  if (oldType === newType) return;

  const contentEl = $('.block-content', blockEl);
  const oldContent = contentEl ? contentEl.innerHTML : '';

  blockEl.dataset.type = newType;

  if (newType === 'divider') {
    blockEl.contentEditable = 'false';
    blockEl.innerHTML = '';
    const handle = document.createElement('div');
    handle.className = 'block-handle';
    handle.contentEditable = 'false';
    handle.draggable = true;
    handle.innerHTML = '<svg viewBox="0 0 10 20"><circle cx="3" cy="4" r="1.2"/><circle cx="7" cy="4" r="1.2"/><circle cx="3" cy="10" r="1.2"/><circle cx="7" cy="10" r="1.2"/><circle cx="3" cy="16" r="1.2"/><circle cx="7" cy="16" r="1.2"/></svg>';
    blockEl.appendChild(handle);
    const hr = document.createElement('hr');
    hr.className = 'divider-line';
    blockEl.appendChild(hr);
    // Create a new paragraph after
    insertBlockAfter(blockEl, 'paragraph', '');
    return;
  }

  rebuildBlock(blockEl, newType, oldContent);
}

function rebuildBlock(blockEl, type, content) {
  // Keep the handle
  const handle = $('.block-handle', blockEl);

  blockEl.innerHTML = '';
  blockEl.removeAttribute('contenteditable');
  blockEl.dataset.type = type;
  blockEl.classList.remove('checked');

  if (handle) blockEl.appendChild(handle);
  else {
    const h = document.createElement('div');
    h.className = 'block-handle';
    h.contentEditable = 'false';
    h.draggable = true;
    h.innerHTML = '<svg viewBox="0 0 10 20"><circle cx="3" cy="4" r="1.2"/><circle cx="7" cy="4" r="1.2"/><circle cx="3" cy="10" r="1.2"/><circle cx="7" cy="10" r="1.2"/><circle cx="3" cy="16" r="1.2"/><circle cx="7" cy="16" r="1.2"/></svg>';
    blockEl.appendChild(h);
  }

  if (type === 'bullet_list' || type === 'numbered_list' || type === 'todo' || type === 'toggle') {
    const row = document.createElement('div');
    row.className = 'block-row';

    if (type === 'bullet_list') {
      const m = document.createElement('span');
      m.className = 'list-marker'; m.contentEditable = 'false'; m.textContent = '•';
      row.appendChild(m);
    } else if (type === 'numbered_list') {
      const m = document.createElement('span');
      m.className = 'list-marker'; m.contentEditable = 'false'; m.textContent = '1.';
      row.appendChild(m);
    } else if (type === 'todo') {
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.className = 'todo-checkbox';
      cb.contentEditable = 'false';
      cb.onchange = () => { blockEl.classList.toggle('checked', cb.checked); scheduleAutoSave(); };
      row.appendChild(cb);
    } else if (type === 'toggle') {
      const arrow = document.createElement('span');
      arrow.className = 'toggle-arrow expanded';
      arrow.contentEditable = 'false'; arrow.textContent = '▶';
      arrow.onclick = () => toggleToggle(blockEl);
      row.appendChild(arrow);
    }

    const c = document.createElement('div');
    c.className = 'block-content';
    c.innerHTML = content;
    setPlaceholder(c, type);
    row.appendChild(c);
    blockEl.appendChild(row);
  } else {
    const c = document.createElement('div');
    c.className = 'block-content';
    c.innerHTML = content;
    setPlaceholder(c, type);
    blockEl.appendChild(c);
  }
}

// --- Cursor / Selection Helpers ---
function getCurrentBlock() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  let node = sel.anchorNode;
  while (node && node !== document) {
    if (node.nodeType === 1 && node.classList && node.classList.contains('block-wrapper')) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function isCursorAtStart() {
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  const block = getCurrentBlock();
  if (!block) return false;
  const content = $('.block-content', block);
  if (!content) return false;

  const preRange = document.createRange();
  preRange.setStart(content, 0);
  preRange.setEnd(range.startContainer, range.startOffset);
  return preRange.toString().length === 0;
}

function setCursorToBlock(blockEl, atStart) {
  const container = $('#blocks-container');
  container.focus();
  requestAnimationFrame(() => {
    const content = $('.block-content', blockEl);
    if (!content) return;
    const sel = window.getSelection();
    const range = document.createRange();
    if (atStart || !content.firstChild) {
      range.setStart(content, 0);
      range.collapse(true);
    } else {
      if (content.lastChild) {
        if (content.lastChild.nodeType === 3) {
          range.setStart(content.lastChild, content.lastChild.length);
        } else {
          range.setStartAfter(content.lastChild);
        }
        range.collapse(true);
      }
    }
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

function setCursorToBlockAt(blockEl, textOffset) {
  const container = $('#blocks-container');
  container.focus();
  requestAnimationFrame(() => {
    const content = $('.block-content', blockEl);
    if (!content) return;
    const sel = window.getSelection();
    const range = document.createRange();

    // Walk text nodes to find position
    let remaining = textOffset;
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      if (remaining <= node.length) {
        range.setStart(node, remaining);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      remaining -= node.length;
    }

    // Fallback: end of content
    if (content.lastChild) {
      if (content.lastChild.nodeType === 3) {
        range.setStart(content.lastChild, content.lastChild.length);
      } else {
        range.setStartAfter(content.lastChild);
      }
    } else {
      range.setStart(content, 0);
    }
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

function getPreviousBlock(blockEl) {
  let el = blockEl.previousElementSibling;
  while (el && !el.classList.contains('block-wrapper')) el = el.previousElementSibling;
  return el;
}

function getNextNonChildSibling(blockEl) {
  const blockId = blockEl.dataset.blockId;
  let el = blockEl.nextElementSibling;
  while (el && el.dataset.parent === blockId) {
    el = el.nextElementSibling;
  }
  return el;
}

function fragmentToHTML(frag) {
  const div = document.createElement('div');
  div.appendChild(frag);
  return div.innerHTML;
}

// --- Slash Commands ---
function showSlashMenu() {
  const block = slashState?.blockEl;
  if (!block) return;
  const content = $('.block-content', block);
  if (!content) return;

  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const rect = sel.getRangeAt(0).getBoundingClientRect();

  const menu = $('#slash-menu');
  menu.style.display = 'block';
  menu.style.left = rect.left + 'px';
  menu.style.top = (rect.bottom + 4) + 'px';

  filteredSlashItems = [...SLASH_ITEMS];
  slashActiveIndex = 0;
  renderSlashItems();
}

function hideSlashMenu() {
  $('#slash-menu').style.display = 'none';
  slashState = null;
}

function updateSlashFilter() {
  if (!slashState) return;
  const content = $('.block-content', slashState.blockEl);
  if (!content) { hideSlashMenu(); return; }

  const text = content.textContent;
  const slashIdx = text.lastIndexOf('/');
  if (slashIdx === -1) { hideSlashMenu(); return; }

  const query = text.substring(slashIdx + 1).toLowerCase();
  filteredSlashItems = SLASH_ITEMS.filter(item =>
    item.label.toLowerCase().includes(query) || item.type.includes(query)
  );
  slashActiveIndex = Math.min(slashActiveIndex, Math.max(filteredSlashItems.length - 1, 0));
  renderSlashItems();

  if (filteredSlashItems.length === 0) {
    $('#slash-menu').style.display = 'none';
  } else {
    $('#slash-menu').style.display = 'block';
  }
}

function renderSlashItems() {
  const container = $('#slash-menu-items');
  container.innerHTML = '';
  filteredSlashItems.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'slash-item' + (i === slashActiveIndex ? ' active' : '');
    div.innerHTML = `<span class="slash-item-icon">${item.icon}</span><span>${item.label}</span>`;
    div.onmousedown = e => {
      e.preventDefault();
      executeSlashCommand(item.type);
      hideSlashMenu();
    };
    container.appendChild(div);
  });
}

function executeSlashCommand(type) {
  if (!slashState) return;
  const block = slashState.blockEl;
  const content = $('.block-content', block);
  if (!content) return;

  // Remove the slash and query from content
  const text = content.textContent;
  const slashIdx = text.lastIndexOf('/');
  if (slashIdx >= 0) {
    // Remove from slash to end
    const before = text.substring(0, slashIdx);
    content.textContent = before;
  }

  hideSlashMenu();

  if (type === 'image') {
    // Trigger file upload
    $('#image-upload').dataset.targetBlock = block.dataset.blockId;
    $('#image-upload').click();
    return;
  }

  if (content.textContent.trim() === '' || block.dataset.type === 'paragraph') {
    convertBlock(block, type);
    if (type !== 'divider') setCursorToBlock(block, true);
  } else {
    insertBlockAfter(block, type, '');
  }
  scheduleAutoSave();
}

// --- Image Upload ---
async function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const form = new FormData();
  form.append('file', file);
  const result = await api('POST', '/api/upload', form);
  if (!result || !result.src) return;

  const targetId = e.target.dataset.targetBlock;
  const block = $(`[data-block-id="${targetId}"]`);

  if (block && block.dataset.type === 'paragraph' && !$('.block-content', block)?.textContent.trim()) {
    // Convert existing empty block to image
    block.dataset.type = 'image';
    block.innerHTML = '';
    const handle = document.createElement('div');
    handle.className = 'block-handle'; handle.contentEditable = 'false'; handle.draggable = true;
    handle.innerHTML = '<svg viewBox="0 0 10 20"><circle cx="3" cy="4" r="1.2"/><circle cx="7" cy="4" r="1.2"/><circle cx="3" cy="10" r="1.2"/><circle cx="7" cy="10" r="1.2"/><circle cx="3" cy="16" r="1.2"/><circle cx="7" cy="16" r="1.2"/></svg>';
    block.appendChild(handle);
    const content = document.createElement('div');
    content.className = 'block-content'; content.contentEditable = 'false';
    const img = document.createElement('img');
    img.src = result.src;
    content.appendChild(img);
    block.appendChild(content);
  } else {
    // Insert new image block
    const ref = block || $$('#blocks-container > .block-wrapper').pop();
    if (ref) {
      const imgBlock = createBlockEl({ id: tempId(), type: 'image', content: '', properties: JSON.stringify({ src: result.src }) });
      ref.after(imgBlock);
    }
  }
  e.target.value = '';
  scheduleAutoSave();
}

// --- Drag and Drop ---
function handleDragStart(e) {
  const handle = e.target.closest('.block-handle');
  if (!handle) return;
  const block = handle.closest('.block-wrapper');
  if (!block) return;
  dragState = { el: block };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', '');
  block.style.opacity = '0.4';
}

function handleDragOver(e) {
  if (!dragState) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  const container = $('#blocks-container');
  const wrappers = $$(':scope > .block-wrapper', container);
  const indicator = $('#drag-indicator');

  let closest = null;
  let closestOffset = Infinity;
  let insertBefore = true;

  wrappers.forEach(w => {
    if (w === dragState.el) return;
    const rect = w.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    const offset = e.clientY - mid;
    if (Math.abs(offset) < Math.abs(closestOffset)) {
      closestOffset = offset;
      closest = w;
      insertBefore = offset < 0;
    }
  });

  if (closest) {
    const rect = closest.getBoundingClientRect();
    const y = insertBefore ? rect.top : rect.bottom;
    indicator.style.display = 'block';
    indicator.style.left = rect.left + 'px';
    indicator.style.top = y + 'px';
    indicator.style.width = rect.width + 'px';
    indicator.dataset.target = closest.dataset.blockId;
    indicator.dataset.before = insertBefore;
  }
}

function handleDrop(e) {
  if (!dragState) return;
  e.preventDefault();
  const indicator = $('#drag-indicator');
  const targetId = indicator.dataset.target;
  const insertBefore = indicator.dataset.before === 'true';
  const target = $(`[data-block-id="${targetId}"]`);

  if (target && target !== dragState.el) {
    if (insertBefore) {
      target.before(dragState.el);
    } else {
      target.after(dragState.el);
    }
    // Also move children of dragged block if it's a toggle
    if (dragState.el.dataset.type === 'toggle') {
      const children = $$(`[data-parent="${dragState.el.dataset.blockId}"]`);
      let after = dragState.el;
      children.forEach(c => { after.after(c); after = c; });
    }
  }

  cleanupDrag();
  renumberLists();
  scheduleAutoSave();
}

function handleDragEnd() {
  cleanupDrag();
}

function cleanupDrag() {
  if (dragState?.el) dragState.el.style.opacity = '';
  dragState = null;
  $('#drag-indicator').style.display = 'none';
}

// --- Editor Click ---
function handleEditorClick(e) {
  // Click on comment mark
  const mark = e.target.closest('mark.comment-mark');
  if (mark) {
    const commentId = mark.dataset.commentId;
    showCommentsSidebar();
    highlightCommentInSidebar(commentId);
    return;
  }

  // Click on toggle arrow
  if (e.target.closest('.toggle-arrow')) return; // handled by onclick
  // Click on checkbox
  if (e.target.closest('.todo-checkbox')) return; // handled by onchange
}

// --- Text Selection / Comments ---
function handleTextSelection() {
  const btn = $('#floating-comment-btn');
  setTimeout(() => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text) {
      btn.style.display = 'none';
      return;
    }
    // Only show if selection is inside blocks-container or shared-content
    let node = sel.anchorNode;
    let inEditor = false;
    while (node) {
      if (node.id === 'blocks-container' || node.id === 'shared-content') {
        inEditor = true; break;
      }
      node = node.parentElement;
    }
    if (!inEditor) { btn.style.display = 'none'; return; }

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

  const range = sel.getRangeAt(0);

  // Find which block the selection is in
  let node = range.startContainer;
  let block = null;
  while (node) {
    if (node.nodeType === 1 && node.classList?.contains('block-wrapper')) {
      block = node; break;
    }
    node = node.parentElement;
  }

  // Generate a temp comment ID
  const tempCommentId = 'pending_' + tempId();

  // Wrap selection in mark tag
  try {
    const mark = document.createElement('mark');
    mark.className = 'comment-mark';
    mark.dataset.commentId = tempCommentId;
    range.surroundContents(mark);
  } catch(e) {
    // Cross-element selection - use extractContents approach
    const frag = range.extractContents();
    const mark = document.createElement('mark');
    mark.className = 'comment-mark';
    mark.dataset.commentId = tempCommentId;
    mark.appendChild(frag);
    range.insertNode(mark);
  }

  $('#floating-comment-btn').style.display = 'none';
  sel.removeAllRanges();

  pendingCommentData = {
    highlightedText: text,
    blockId: block?.dataset.blockId || null,
    tempCommentId,
  };

  showCommentsSidebar();
  showNewCommentBox(text);
}

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
  // Remove pending mark if exists
  if (pendingCommentData?.tempCommentId) {
    const mark = $(`mark[data-comment-id="${pendingCommentData.tempCommentId}"]`);
    if (mark) {
      const parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      mark.remove();
    }
  }
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

  const comment = await api('POST', `/api/pages/${currentPageId}/comments`, body);
  if (!comment) return;

  // Update the mark tag with the real comment ID
  if (pendingCommentData?.tempCommentId) {
    const mark = $(`mark[data-comment-id="${pendingCommentData.tempCommentId}"]`);
    if (mark) {
      mark.dataset.commentId = comment.id;
    }
  }

  pendingCommentData = null;
  $('#new-comment-box').style.display = 'none';

  // Save blocks to persist the mark tags
  scheduleAutoSave();
  loadComments();
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
  loadComments();
}

async function loadComments() {
  if (!currentPageId) return;
  const comments = await api('GET', `/api/pages/${currentPageId}/comments`);
  if (!comments) return;
  renderComments(comments);
}

function renderComments(comments) {
  const list = $('#comments-list');
  list.innerHTML = '';

  // Group into threads (top-level comments with replies)
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

    // Top-level comment
    threadEl.appendChild(createCommentItemEl(thread, true));

    // Replies
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

  if (isTopLevel) {
    html += '<div class="comment-actions">';
    html += `<button class="comment-action-btn" onclick="replyToComment('${comment.id}')">Reply</button>`;
    if (!comment.resolved) {
      html += `<button class="comment-action-btn" onclick="resolveComment('${comment.id}')">Resolve</button>`;
    }
    html += '</div>';
  }

  div.innerHTML = html;
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

window.replyToComment = function(parentId) {
  pendingCommentData = { highlightedText: '', blockId: null, tempCommentId: null };
  showNewCommentBox('', parentId);
};

window.resolveComment = async function(commentId) {
  await api('PUT', `/api/comments/${commentId}/resolve`);
  // Remove the mark tag for resolved comments
  const mark = $(`mark[data-comment-id="${commentId}"]`);
  if (mark) {
    const parent = mark.parentNode;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    mark.remove();
    scheduleAutoSave();
  }
  loadComments();
};

// --- Share Modal ---
function openShareModal() {
  $('#share-modal').style.display = 'flex';
  loadShares();
}

async function loadShares() {
  if (!currentPageId) return;
  const shares = await api('GET', `/api/pages/${currentPageId}/shares`);
  if (!shares) return;
  renderShares(shares);
}

function renderShares(shares) {
  const list = $('#shares-list');
  list.innerHTML = '';
  if (shares.length === 0) {
    list.innerHTML = '<div style="padding:8px 0;color:var(--color-text-muted);font-size:13px;">No share links yet</div>';
    return;
  }
  shares.forEach(s => {
    const div = document.createElement('div');
    div.className = 'share-item';
    const link = window.location.origin + '/shared/' + s.token;
    div.innerHTML = `
      <div class="share-info">
        <div class="share-alias">${escHtml(s.alias)}
          <span class="share-badge">${s.can_comment ? 'Can comment' : 'View only'}</span>
        </div>
        <div class="share-link"><a href="${link}" target="_blank">${link}</a></div>
      </div>
      <button class="share-delete-btn" onclick="deleteShare('${s.id}')">&times;</button>
    `;
    list.appendChild(div);
  });
}

async function createShare() {
  const alias = $('#share-alias').value.trim();
  if (!alias) return;
  const canComment = $('#share-can-comment').checked ? 1 : 0;
  await api('POST', `/api/pages/${currentPageId}/shares`, { alias, can_comment: canComment });
  $('#share-alias').value = '';
  loadShares();
}

window.deleteShare = async function(id) {
  await api('DELETE', `/api/shares/${id}`);
  loadShares();
};

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
