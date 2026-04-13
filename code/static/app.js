(function() {
'use strict';

// ---- State ----
var currentPageId = null;
var currentPage = null;
var allPages = [];
var allComments = [];
var autoSaveTimer = null;
var pollTimer = null;
var slashQuery = '';
var slashBlockId = null;
var expandedPages = JSON.parse(localStorage.getItem('expanded_pages') || '{}');
var draggedBlockId = null;
var draggedPageId = null;

var SLASH_ITEMS = [
	{ type: 'paragraph', label: 'Text', icon: '📝', keywords: 'paragraph text' },
	{ type: 'heading1', label: 'Heading 1', icon: 'H1', keywords: 'heading h1 title' },
	{ type: 'heading2', label: 'Heading 2', icon: 'H2', keywords: 'heading h2' },
	{ type: 'heading3', label: 'Heading 3', icon: 'H3', keywords: 'heading h3' },
	{ type: 'bullet_list', label: 'Bullet List', icon: '•', keywords: 'bullet list unordered' },
	{ type: 'numbered_list', label: 'Numbered List', icon: '1.', keywords: 'numbered list ordered' },
	{ type: 'todo', label: 'To-do', icon: '☑', keywords: 'todo checkbox task' },
	{ type: 'toggle', label: 'Toggle', icon: '▶', keywords: 'toggle expandable' },
	{ type: 'quote', label: 'Quote', icon: '❝', keywords: 'quote blockquote' },
	{ type: 'callout', label: 'Callout', icon: '💡', keywords: 'callout info' },
	{ type: 'code', label: 'Code', icon: '&lt;&gt;', keywords: 'code snippet programming' },
	{ type: 'divider', label: 'Divider', icon: '─', keywords: 'divider line separator' },
	{ type: 'image', label: 'Image', icon: '🖼', keywords: 'image picture photo' },
	{ type: 'file', label: 'File', icon: '📎', keywords: 'file attachment upload' },
	{ type: 'page_link', label: 'Page Link', icon: '📄', keywords: 'page link reference' },
	{ type: 'table', label: 'Table', icon: '📊', keywords: 'table grid data' },
	{ type: 'math', label: 'Math Equation', icon: '∑', keywords: 'math latex equation katex' }
];

var EMOJIS = ['📄','📝','📋','📌','📎','📁','📂','🗂','📊','📈','📉','🗒','🗓','📅','📆','🔖','🏷','💡','🔍','🔎','⭐','🌟','💫','✨','🔥','💥','❤️','💙','💚','💛','💜','🧡','🖤','🤍','🏠','🏢','🏗','🌍','🌎','🌏','🚀','✈️','🎯','🎨','🎭','🎪','🎬','🎮','🕹','🎲','🎸','🎵','🎶','📻','📺','📷','📸','💻','🖥','⌨️','🖱','🖨','📱','📞','☎️','🔧','🔨','⚙️','🔩','🛠','⛏','🗡','🔪','💣','🧲','🧪','🧫','🧬','🔬','🔭','📡','🛡','🔑','🗝','🔒','🔓','💰','💳','💎','⚡','🔋','☀️','🌙','⛅','🌧','❄️','🌊','🌸','🌺','🌻','🌹','🍀','🌿','🍁','🌴','🌵','🍎','🍊','🍋','🍇','🍉','🍓','🥝','🍕','🍔','🍟','☕','🍵','🥤','🍺','🧁','🎂','🍰','🧀','🥚','🍳','✅','❌','⚠️','❓','❗','💬','💭','🗨','👍','👎','👏','🙌','🤝','✊','👊','✌️','🤞','👋','🖐','✋','👆','👇','👈','👉','☝️'];

// ---- API helpers ----
function api(method, path, body) {
	var opts = { method: method, headers: {} };
	if (body && !(body instanceof FormData)) {
		opts.headers['Content-Type'] = 'application/json';
		opts.body = JSON.stringify(body);
	} else if (body instanceof FormData) {
		opts.body = body;
	}
	return fetch(path, opts).then(function(r) {
		if (!r.ok) throw new Error('HTTP ' + r.status);
		return r.json();
	});
}

// ---- Init ----
function init() {
	loadPages().then(function() {
		// Check for ?page= parameter
		var params = new URLSearchParams(window.location.search);
		var pageParam = params.get('page');
		if (pageParam) {
			selectPage(pageParam);
			window.history.replaceState({}, '', '/');
		} else {
			var lastPageId = localStorage.getItem('last_page_id');
			if (lastPageId && allPages.find(function(p) { return p.id === lastPageId; })) {
				selectPage(lastPageId);
			}
		}
	});

	document.getElementById('new-page-btn').addEventListener('click', function() {
		createNewPage(null);
	});
	document.getElementById('page-title').addEventListener('input', function() {
		if (currentPageId) {
			currentPage.title = this.value;
			scheduleAutoSave();
		}
	});
	document.getElementById('delete-page-btn').addEventListener('click', deletePage);
	document.getElementById('share-btn').addEventListener('click', toggleSharesPanel);
	document.getElementById('comments-btn').addEventListener('click', toggleCommentsPanel);
	document.getElementById('close-comments-btn').addEventListener('click', function() {
		document.getElementById('comments-panel').style.display = 'none';
	});
	document.getElementById('close-shares-btn').addEventListener('click', function() {
		document.getElementById('shares-panel').style.display = 'none';
	});
	document.getElementById('create-share-btn').addEventListener('click', createShare);

	var container = document.getElementById('blocks-container');
	container.addEventListener('input', handleInput);
	container.addEventListener('keydown', handleKeyDown);
	container.addEventListener('click', handleEditorClick);
	container.addEventListener('paste', handlePaste);

	// Drag and drop for blocks
	container.addEventListener('dragstart', handleBlockDragStart);
	container.addEventListener('dragover', handleBlockDragOver);
	container.addEventListener('dragleave', handleBlockDragLeave);
	container.addEventListener('drop', handleBlockDrop);
	container.addEventListener('dragend', handleBlockDragEnd);

	// Floating comment button
	document.addEventListener('mouseup', handleTextSelection);
	document.getElementById('comment-float-btn').addEventListener('mousedown', function(e) {
		e.preventDefault();
		createCommentFromSelection();
	});

	// Track cursor for placeholder
	document.addEventListener('selectionchange', updateCursorBlock);

	// Search
	document.getElementById('page-search').addEventListener('input', handlePageSearch);

	// Close menus on outside click
	document.addEventListener('mousedown', function(e) {
		var slash = document.getElementById('slash-menu');
		if (slash.style.display !== 'none' && !slash.contains(e.target)) {
			hideSlashMenu();
		}
		var emoji = document.getElementById('emoji-picker');
		if (emoji.style.display !== 'none' && !emoji.contains(e.target) && e.target.id !== 'page-icon-btn') {
			emoji.style.display = 'none';
		}
		var modal = document.getElementById('page-link-modal');
		if (modal.style.display !== 'none') {
			var content = document.getElementById('page-link-modal-content');
			if (!content.contains(e.target)) {
				modal.style.display = 'none';
			}
		}
	});

	// Escape key closes menus
	document.addEventListener('keydown', function(e) {
		if (e.key === 'Escape') {
			hideSlashMenu();
			document.getElementById('emoji-picker').style.display = 'none';
			document.getElementById('page-link-modal').style.display = 'none';
			document.getElementById('comment-float-btn').style.display = 'none';
		}
	});

	// Emoji picker
	document.getElementById('page-icon-btn').addEventListener('click', toggleEmojiPicker);

	// beforeunload saves
	window.addEventListener('beforeunload', function() {
		if (autoSaveTimer) {
			clearTimeout(autoSaveTimer);
			autoSaveTimer = null;
			doSave();
		}
	});

	// Start polling
	startPolling();
}

// ---- Pages ----
function loadPages() {
	return api('GET', '/api/pages').then(function(pages) {
		allPages = pages;
		renderPageTree();
	});
}

function renderPageTree() {
	var search = document.getElementById('page-search').value.trim().toLowerCase();
	var tree = document.getElementById('page-tree');
	tree.innerHTML = '';

	if (search) {
		// Flat filtered list
		allPages.forEach(function(p) {
			if (p.title.toLowerCase().indexOf(search) !== -1) {
				var item = createPageItem(p);
				tree.appendChild(item);
			}
		});
		return;
	}

	// Build tree
	var roots = allPages.filter(function(p) { return !p.parent_id; });
	roots.forEach(function(p) { tree.appendChild(createPageNode(p)); });
}

function createPageNode(page) {
	var frag = document.createDocumentFragment();
	var item = createPageItem(page);
	frag.appendChild(item);

	var children = allPages.filter(function(p) { return p.parent_id === page.id; });
	if (children.length > 0) {
		var childrenDiv = document.createElement('div');
		childrenDiv.className = 'page-children';
		if (!expandedPages[page.id]) childrenDiv.classList.add('collapsed');
		children.forEach(function(c) { childrenDiv.appendChild(createPageNode(c)); });
		frag.appendChild(childrenDiv);
	}

	return frag;
}

function createPageItem(page) {
	var div = document.createElement('div');
	div.className = 'page-item' + (page.id === currentPageId ? ' active' : '');
	div.dataset.pageId = page.id;
	div.draggable = true;

	var children = allPages.filter(function(p) { return p.parent_id === page.id; });
	var hasChildren = children.length > 0;

	// Toggle
	var toggle = document.createElement('span');
	toggle.className = 'page-toggle';
	if (hasChildren) {
		toggle.textContent = expandedPages[page.id] ? '▼' : '▶';
		toggle.addEventListener('click', function(e) {
			e.stopPropagation();
			togglePageExpand(page.id);
		});
	}
	div.appendChild(toggle);

	// Icon
	var icon = document.createElement('span');
	icon.className = 'page-icon';
	icon.textContent = page.icon || '📄';
	div.appendChild(icon);

	// Title
	var title = document.createElement('span');
	title.className = 'page-title';
	title.textContent = page.title;
	div.appendChild(title);

	// Add child button
	var addBtn = document.createElement('span');
	addBtn.className = 'page-add-child';
	addBtn.textContent = '+';
	addBtn.addEventListener('click', function(e) {
		e.stopPropagation();
		createNewPage(page.id);
	});
	div.appendChild(addBtn);

	div.addEventListener('click', function() { selectPage(page.id); });

	// Page drag
	div.addEventListener('dragstart', function(e) {
		e.stopPropagation();
		draggedPageId = page.id;
		e.dataTransfer.effectAllowed = 'move';
		div.style.opacity = '0.4';
	});
	div.addEventListener('dragend', function() {
		draggedPageId = null;
		div.style.opacity = '';
		clearPageDragStyles();
	});
	div.addEventListener('dragover', function(e) {
		if (!draggedPageId || draggedPageId === page.id) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		var rect = div.getBoundingClientRect();
		var y = e.clientY - rect.top;
		var third = rect.height / 3;
		div.classList.remove('drag-over-top', 'drag-over-middle', 'drag-over-bottom');
		if (y < third) div.classList.add('drag-over-top');
		else if (y > third * 2) div.classList.add('drag-over-bottom');
		else div.classList.add('drag-over-middle');
	});
	div.addEventListener('dragleave', function() {
		div.classList.remove('drag-over-top', 'drag-over-middle', 'drag-over-bottom');
	});
	div.addEventListener('drop', function(e) {
		e.preventDefault();
		if (!draggedPageId || draggedPageId === page.id) return;
		var rect = div.getBoundingClientRect();
		var y = e.clientY - rect.top;
		var third = rect.height / 3;
		var parentId, position;
		if (y < third) {
			// Above: same parent, same position
			parentId = page.parent_id;
			position = page.position;
		} else if (y > third * 2) {
			// Below: same parent, position + 1
			parentId = page.parent_id;
			position = page.position + 1;
		} else {
			// Child
			parentId = page.id;
			position = 0;
			expandedPages[page.id] = true;
			localStorage.setItem('expanded_pages', JSON.stringify(expandedPages));
		}
		api('PUT', '/api/pages/' + draggedPageId + '/move', { parent_id: parentId || null, position: position })
			.then(loadPages);
		clearPageDragStyles();
	});

	return div;
}

function clearPageDragStyles() {
	document.querySelectorAll('.page-item').forEach(function(el) {
		el.classList.remove('drag-over-top', 'drag-over-middle', 'drag-over-bottom');
	});
}

function togglePageExpand(id) {
	expandedPages[id] = !expandedPages[id];
	localStorage.setItem('expanded_pages', JSON.stringify(expandedPages));
	renderPageTree();
}

function selectPage(id) {
	currentPageId = id;
	localStorage.setItem('last_page_id', id);
	document.getElementById('empty-state').style.display = 'none';
	document.getElementById('page-editor').style.display = 'block';
	// Close panels
	document.getElementById('comments-panel').style.display = 'none';
	document.getElementById('shares-panel').style.display = 'none';

	Promise.all([
		api('GET', '/api/pages'),
		api('GET', '/api/pages/' + id + '/blocks'),
		api('GET', '/api/pages/' + id + '/comments')
	]).then(function(results) {
		allPages = results[0];
		currentPage = allPages.find(function(p) { return p.id === id; });
		if (!currentPage) return;
		renderPageTree();

		document.getElementById('page-title').value = currentPage.title;
		document.getElementById('page-icon-btn').textContent = currentPage.icon || '📄';

		allComments = results[2];
		renderBlocks(results[1]);
		renderComments();
		// Auto-open comments panel if page has comments
		if (allComments.length > 0) {
			document.getElementById('comments-panel').style.display = 'block';
		}
	});
}

function createNewPage(parentId) {
	var body = { title: 'Untitled' };
	if (parentId) {
		body.parent_id = parentId;
		expandedPages[parentId] = true;
		localStorage.setItem('expanded_pages', JSON.stringify(expandedPages));
	}
	api('POST', '/api/pages', body).then(function(page) {
		loadPages().then(function() {
			selectPage(page.id);
			setTimeout(function() {
				var titleEl = document.getElementById('page-title');
				titleEl.focus();
				titleEl.select();
			}, 100);
		});
	});
}

function deletePage() {
	if (!currentPageId) return;
	if (!confirm('Delete this page and all its children?')) return;
	api('DELETE', '/api/pages/' + currentPageId).then(function() {
		currentPageId = null;
		currentPage = null;
		document.getElementById('page-editor').style.display = 'none';
		document.getElementById('empty-state').style.display = 'flex';
		loadPages();
	});
}

function handlePageSearch() {
	renderPageTree();
}

// ---- Blocks ----
function renderBlocks(blocks) {
	var container = document.getElementById('blocks-container');
	container.innerHTML = '';

	if (!blocks || blocks.length === 0) {
		var wrapper = createBlockEl({ id: generateId(), type: 'paragraph', content: '', properties: {} });
		container.appendChild(wrapper);
		ensureBR(wrapper.querySelector('.block-content'));
		return;
	}

	// Build parent map for depth calculation
	var blockMap = {};
	blocks.forEach(function(b) { blockMap[b.id] = b; });

	blocks.forEach(function(block) {
		var wrapper = createBlockEl(block);
		// Calculate depth
		var depth = getBlockDepth(block.parent_block_id, blockMap);
		if (depth > 0) wrapper.dataset.depth = depth;
		container.appendChild(wrapper);
	});

	updateNumberedLists();
	highlightCodeBlocks();
	renderMathBlocks();
	applyCommentHighlights();
}

function getBlockDepth(parentId, blockMap) {
	var depth = 0;
	var seen = {};
	while (parentId && blockMap[parentId] && !seen[parentId]) {
		seen[parentId] = true;
		depth++;
		parentId = blockMap[parentId].parent_block_id;
	}
	return depth;
}

function createBlockEl(block) {
	var wrapper = document.createElement('div');
	wrapper.className = 'block-wrapper';
	wrapper.dataset.blockId = block.id;
	wrapper.dataset.type = block.type;
	if (block.parent_block_id) wrapper.dataset.parentBlockId = block.parent_block_id;

	var props = typeof block.properties === 'string' ? JSON.parse(block.properties || '{}') : (block.properties || {});

	// Handle
	var handle = document.createElement('div');
	handle.className = 'block-handle';
	handle.contentEditable = 'false';
	handle.draggable = true;
	handle.textContent = '⋮⋮';
	wrapper.appendChild(handle);

	// Type-specific prefix elements
	if (block.type === 'todo') {
		var cb = document.createElement('input');
		cb.type = 'checkbox';
		cb.className = 'todo-checkbox';
		cb.contentEditable = 'false';
		cb.checked = !!(props.checked);
		if (cb.checked) wrapper.classList.add('checked');
		cb.addEventListener('change', function() {
			wrapper.classList.toggle('checked', cb.checked);
			scheduleAutoSave();
		});
		wrapper.appendChild(cb);
	}

	if (block.type === 'toggle') {
		var toggleIcon = document.createElement('span');
		toggleIcon.className = 'toggle-icon';
		toggleIcon.contentEditable = 'false';
		toggleIcon.textContent = '▶';
		toggleIcon.addEventListener('click', function() {
			toggleIcon.classList.toggle('open');
			var isOpen = toggleIcon.classList.contains('open');
			var container = document.getElementById('blocks-container');
			var allWrappers = Array.from(container.querySelectorAll('.block-wrapper'));
			var myId = wrapper.dataset.blockId;
			var children = allWrappers.filter(function(w) { return w.dataset.parentBlockId === myId; });
			if (isOpen && children.length === 0) {
				// Create empty child block when expanding empty toggle
				var parentDepth = parseInt(wrapper.dataset.depth || '0', 10);
				var childBlock = insertBlockAfter(wrapper, 'paragraph', '');
				childBlock.dataset.parentBlockId = myId;
				childBlock.dataset.depth = parentDepth + 1;
				setCursorToBlock(childBlock, false);
				scheduleAutoSave();
			} else {
				children.forEach(function(w) {
					w.style.display = isOpen ? '' : 'none';
				});
			}
		});
		wrapper.appendChild(toggleIcon);
	}

	if (block.type === 'numbered_list') {
		var numSpan = document.createElement('span');
		numSpan.className = 'list-number';
		numSpan.contentEditable = 'false';
		numSpan.textContent = '1.';
		wrapper.appendChild(numSpan);
	}

	// Content
	if (block.type === 'divider') {
		var content = document.createElement('div');
		content.className = 'block-content';
		content.contentEditable = 'false';
		content.innerHTML = '<hr>';
		wrapper.appendChild(content);
	} else if (block.type === 'code') {
		var codeWrapper = document.createElement('div');
		codeWrapper.className = 'block-content code-block-wrapper';
		codeWrapper.contentEditable = 'false';

		var langSelect = createCodeLangSelect(props.language || '');
		codeWrapper.appendChild(langSelect);

		var pre = document.createElement('pre');
		var code = document.createElement('code');
		code.contentEditable = 'true';
		code.textContent = block.content || '';
		code.addEventListener('input', function() { scheduleAutoSave(); });
		code.addEventListener('keydown', function(e) {
			if (e.key === 'Tab') {
				e.preventDefault();
				document.execCommand('insertText', false, '  ');
			}
		});
		pre.appendChild(code);
		codeWrapper.appendChild(pre);
		wrapper.appendChild(codeWrapper);
	} else if (block.type === 'image') {
		var imgDiv = document.createElement('div');
		imgDiv.className = 'block-content image-block';
		imgDiv.contentEditable = 'false';
		if (props.src) {
			var img = document.createElement('img');
			img.src = props.src;
			imgDiv.appendChild(img);
		} else {
			var placeholder = document.createElement('div');
			placeholder.className = 'image-upload-placeholder';
			placeholder.textContent = 'Click to upload image';
			placeholder.addEventListener('click', function() { uploadImage(wrapper); });
			imgDiv.appendChild(placeholder);
		}
		wrapper.appendChild(imgDiv);
	} else if (block.type === 'file') {
		var fileDiv = document.createElement('div');
		fileDiv.className = 'block-content file-block';
		fileDiv.contentEditable = 'false';
		if (props.src) {
			fileDiv.innerHTML = '📎 <a href="' + escapeHtml(props.src) + '" download="' + escapeHtml(props.filename || '') + '">' + escapeHtml(props.filename || block.content || 'Download') + '</a>';
		} else {
			var uploadBtn = document.createElement('div');
			uploadBtn.className = 'image-upload-placeholder';
			uploadBtn.textContent = 'Click to upload file';
			uploadBtn.addEventListener('click', function() { uploadFile(wrapper); });
			fileDiv.appendChild(uploadBtn);
		}
		wrapper.appendChild(fileDiv);
	} else if (block.type === 'page_link') {
		var linkDiv = document.createElement('div');
		linkDiv.className = 'block-content page-link-block';
		linkDiv.contentEditable = 'false';
		var pageId = props.page_id;
		var linkedPage = allPages.find(function(p) { return p.id === pageId; });
		linkDiv.textContent = '📄 ' + (linkedPage ? linkedPage.title : block.content || 'Unknown page');
		linkDiv.dataset.pageId = pageId;
		linkDiv.addEventListener('click', function() {
			if (pageId) selectPage(pageId);
		});
		wrapper.appendChild(linkDiv);
	} else if (block.type === 'table') {
		var tableDiv = document.createElement('div');
		tableDiv.className = 'block-content table-wrapper';
		tableDiv.contentEditable = 'false';
		var rows = props.rows || [['', ''], ['', '']];
		tableDiv.appendChild(createTableElement(rows));
		tableDiv.appendChild(createTableControls(tableDiv));
		wrapper.appendChild(tableDiv);
	} else if (block.type === 'math') {
		var mathDiv = document.createElement('div');
		mathDiv.className = 'block-content math-block';
		mathDiv.contentEditable = 'false';

		var preview = document.createElement('div');
		preview.className = 'math-preview';
		preview.addEventListener('click', function() {
			mathDiv.classList.add('editing');
			mathInput.focus();
		});
		mathDiv.appendChild(preview);

		var mathInput = document.createElement('div');
		mathInput.className = 'math-input';
		mathInput.contentEditable = 'true';
		mathInput.textContent = block.content || '';
		mathInput.addEventListener('blur', function() {
			mathDiv.classList.remove('editing');
			renderSingleMath(mathDiv);
			scheduleAutoSave();
		});
		mathInput.addEventListener('input', function() { scheduleAutoSave(); });
		mathInput.addEventListener('keydown', function(e) {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				mathInput.blur();
			}
		});
		mathDiv.appendChild(mathInput);
		wrapper.appendChild(mathDiv);
	} else {
		// paragraph, heading1-3, bullet_list, quote, callout
		var content = document.createElement('div');
		content.className = 'block-content';
		content.innerHTML = DOMPurify.sanitize(block.content || '<br>');
		wrapper.appendChild(content);
		ensureBR(content);
	}

	return wrapper;
}

function createCodeLangSelect(language) {
	var select = document.createElement('select');
	select.className = 'code-language';
	select.contentEditable = 'false';
	var langs = ['', 'json', 'bash', 'html', 'css', 'go', 'solidity', 'rust', 'c', 'cpp', 'toml', 'ruby', 'python', 'typescript', 'javascript', 'java', 'csharp', 'sql', 'yaml', 'xml', 'markdown', 'php', 'swift', 'kotlin', 'lua', 'perl', 'r', 'scala', 'haskell', 'elixir', 'erlang', 'clojure', 'dart', 'groovy', 'powershell', 'dockerfile', 'makefile', 'graphql', 'protobuf', 'ini', 'nginx', 'diff'];
	langs.forEach(function(l) {
		var opt = document.createElement('option');
		opt.value = l;
		opt.textContent = l || 'auto';
		if (l === language) opt.selected = true;
		select.appendChild(opt);
	});
	select.addEventListener('change', function() {
		scheduleAutoSave();
		highlightCodeBlocks();
	});
	return select;
}

function createTableElement(rows) {
	var table = document.createElement('table');
	rows.forEach(function(row, ri) {
		var tr = document.createElement('tr');
		row.forEach(function(cell) {
			var td = document.createElement(ri === 0 ? 'th' : 'td');
			td.contentEditable = 'true';
			td.textContent = cell;
			td.addEventListener('input', function() { scheduleAutoSave(); });
			tr.appendChild(td);
		});
		table.appendChild(tr);
	});
	return table;
}

function createTableControls(tableDiv) {
	var controls = document.createElement('div');
	controls.className = 'table-controls';

	var addRow = document.createElement('button');
	addRow.textContent = '+ Row';
	addRow.addEventListener('click', function() {
		var table = tableDiv.querySelector('table');
		var cols = table.rows[0] ? table.rows[0].cells.length : 2;
		var tr = document.createElement('tr');
		for (var i = 0; i < cols; i++) {
			var td = document.createElement('td');
			td.contentEditable = 'true';
			td.addEventListener('input', function() { scheduleAutoSave(); });
			tr.appendChild(td);
		}
		table.appendChild(tr);
		scheduleAutoSave();
	});

	var addCol = document.createElement('button');
	addCol.textContent = '+ Column';
	addCol.addEventListener('click', function() {
		var table = tableDiv.querySelector('table');
		Array.from(table.rows).forEach(function(tr, ri) {
			var td = document.createElement(ri === 0 ? 'th' : 'td');
			td.contentEditable = 'true';
			td.addEventListener('input', function() { scheduleAutoSave(); });
			tr.appendChild(td);
		});
		scheduleAutoSave();
	});

	var delRow = document.createElement('button');
	delRow.textContent = '- Row';
	delRow.addEventListener('click', function() {
		var table = tableDiv.querySelector('table');
		if (table.rows.length > 1) {
			table.deleteRow(table.rows.length - 1);
			scheduleAutoSave();
		}
	});

	var delCol = document.createElement('button');
	delCol.textContent = '- Column';
	delCol.addEventListener('click', function() {
		var table = tableDiv.querySelector('table');
		if (table.rows[0] && table.rows[0].cells.length > 1) {
			Array.from(table.rows).forEach(function(tr) {
				tr.deleteCell(tr.cells.length - 1);
			});
			scheduleAutoSave();
		}
	});

	controls.appendChild(addRow);
	controls.appendChild(addCol);
	controls.appendChild(delRow);
	controls.appendChild(delCol);
	return controls;
}

// ---- Block helpers ----
function ensureBR(el) {
	if (!el) return;
	if (el.textContent.trim() === '' && !el.querySelector('img') && !el.querySelector('br')) {
		el.innerHTML = '<br>';
	}
	el.classList.toggle('is-empty', el.textContent.trim() === '');
}

function cleanContent(html) {
	if (!html) return '';
	var cleaned = html.replace(/^<br\s*\/?>$/, '');
	cleaned = cleaned.replace(/<br\s*\/?>$/, '');
	return cleaned.trim();
}

function getBlockWrapper(node) {
	while (node && node !== document.getElementById('blocks-container')) {
		if (node.classList && node.classList.contains('block-wrapper')) return node;
		node = node.parentNode;
	}
	return null;
}

function getCurrentBlockWrapper() {
	var sel = window.getSelection();
	if (!sel.anchorNode) return null;
	return getBlockWrapper(sel.anchorNode);
}

function getBlockContent(wrapper) {
	if (!wrapper) return null;
	return wrapper.querySelector('.block-content');
}

function generateId() {
	return 'b_' + Math.random().toString(36).substr(2, 12);
}

function escapeHtml(str) {
	var div = document.createElement('div');
	div.textContent = str;
	return div.innerHTML;
}

// ---- Cursor management ----
function setCursorToBlock(wrapper, atEnd) {
	var container = document.getElementById('blocks-container');
	container.focus();

	requestAnimationFrame(function() {
		var content = wrapper.querySelector('.block-content');
		if (!content) return;

		var sel = window.getSelection();
		var range = document.createRange();

		if (atEnd && content.childNodes.length > 0) {
			var lastChild = content.childNodes[content.childNodes.length - 1];
			if (lastChild.nodeName === 'BR') {
				if (content.childNodes.length > 1) {
					lastChild = content.childNodes[content.childNodes.length - 2];
					if (lastChild.nodeType === 3) {
						range.setStart(lastChild, lastChild.textContent.length);
					} else {
						range.setStartAfter(lastChild);
					}
				} else {
					range.setStart(content, 0);
				}
			} else if (lastChild.nodeType === 3) {
				range.setStart(lastChild, lastChild.textContent.length);
			} else {
				range.setStartAfter(lastChild);
			}
		} else {
			range.setStart(content, 0);
		}
		range.collapse(true);
		sel.removeAllRanges();
		sel.addRange(range);
	});
}

var lastCursorBlockId = null;
function updateCursorBlock() {
	var allWrappers = document.querySelectorAll('#blocks-container .block-wrapper');
	allWrappers.forEach(function(w) { w.classList.remove('has-cursor'); });

	var wrapper = getCurrentBlockWrapper();
	var newBlockId = wrapper ? wrapper.dataset.blockId : null;
	if (wrapper) {
		wrapper.classList.add('has-cursor');
		var content = getBlockContent(wrapper);
		if (content) ensureBR(content);
	}
	// Re-highlight code blocks when cursor leaves a code block
	if (lastCursorBlockId !== newBlockId) {
		lastCursorBlockId = newBlockId;
		highlightCodeBlocks();
	}
}

// ---- Input handling ----
function handleInput(e) {
	var wrapper = getCurrentBlockWrapper();
	if (!wrapper) return;
	var type = wrapper.dataset.type;
	var content = getBlockContent(wrapper);

	if (content) ensureBR(content);

	// Check for markdown shortcuts
	if (type === 'paragraph' && content) {
		var text = content.textContent.replace(/\u00a0/g, ' ');

		var shortcuts = [
			{ pattern: /^# $/, type: 'heading1' },
			{ pattern: /^## $/, type: 'heading2' },
			{ pattern: /^### $/, type: 'heading3' },
			{ pattern: /^[-*] $/, type: 'bullet_list' },
			{ pattern: /^1\. $/, type: 'numbered_list' },
			{ pattern: /^> $/, type: 'quote' },
			{ pattern: /^\[\] $/, type: 'todo', checked: false },
			{ pattern: /^\[ \] $/, type: 'todo', checked: false },
			{ pattern: /^\[x\] $/, type: 'todo', checked: true },
		];

		for (var i = 0; i < shortcuts.length; i++) {
			if (shortcuts[i].pattern.test(text)) {
				content.innerHTML = '<br>';
				rebuildBlock(wrapper, shortcuts[i].type, shortcuts[i].checked);
				scheduleAutoSave();
				return;
			}
		}

		// Divider shortcut
		if (/^---$/.test(text.trim())) {
			content.innerHTML = '<hr>';
			rebuildBlock(wrapper, 'divider');
			scheduleAutoSave();
			return;
		}

		// Code block shortcut
		if (/^```$/.test(text.trim())) {
			content.innerHTML = '';
			rebuildBlock(wrapper, 'code');
			scheduleAutoSave();
			return;
		}

		// Math shortcut
		if (/^\$\$$/.test(text.trim())) {
			content.innerHTML = '';
			rebuildBlock(wrapper, 'math');
			scheduleAutoSave();
			return;
		}
	}

	// Slash command
	if (content) {
		var text = content.textContent.replace(/\u00a0/g, ' ');
		if (text.startsWith('/')) {
			slashQuery = text.substring(1);
			slashBlockId = wrapper.dataset.blockId;
			showSlashMenu();
			return;
		}
	}
	hideSlashMenu();
	scheduleAutoSave();

	// Live syntax highlighting for code blocks
	if (type === 'code') {
		highlightCodeBlocks();
	}
}

function handleKeyDown(e) {
	// Formatting shortcuts
	if (e.ctrlKey || e.metaKey) {
		if (e.key === 'b') {
			e.preventDefault();
			document.execCommand('bold');
			return;
		}
		if (e.key === 'i') {
			e.preventDefault();
			document.execCommand('italic');
			return;
		}
		if (e.key === 'e') {
			e.preventDefault();
			toggleInlineCode();
			return;
		}
		if (e.key === 'X' && e.shiftKey) {
			e.preventDefault();
			document.execCommand('strikeThrough');
			return;
		}
	}

	var wrapper = getCurrentBlockWrapper();
	if (!wrapper) return;
	var type = wrapper.dataset.type;

	// Slash menu navigation
	var slash = document.getElementById('slash-menu');
	if (slash.style.display !== 'none') {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			navigateSlashMenu(e.key === 'ArrowDown' ? 1 : -1);
			return;
		}
		if (e.key === 'Enter') {
			e.preventDefault();
			selectSlashItem();
			return;
		}
	}

	// Enter key
	if (e.key === 'Enter' && !e.shiftKey) {
		if (type === 'code' || type === 'math') return; // Let default handle it in code/math
		if (type === 'divider' || type === 'image' || type === 'file' || type === 'page_link' || type === 'table') {
			e.preventDefault();
			insertBlockAfter(wrapper, 'paragraph', '');
			return;
		}

		e.preventDefault();
		var content = getBlockContent(wrapper);
		if (!content) return;

		// If empty list/todo/toggle, convert to paragraph
		if ((type === 'bullet_list' || type === 'numbered_list' || type === 'todo' || type === 'toggle') && content.textContent.trim() === '') {
			rebuildBlock(wrapper, 'paragraph');
			return;
		}

		// Split block at cursor
		var sel = window.getSelection();
		var range = sel.getRangeAt(0);
		var afterRange = document.createRange();
		afterRange.setStart(range.endContainer, range.endOffset);
		afterRange.setEndAfter(content.lastChild || content);
		var afterFrag = afterRange.extractContents();
		var afterDiv = document.createElement('div');
		afterDiv.appendChild(afterFrag);
		var afterHtml = afterDiv.innerHTML;
		if (afterHtml === '<br>' || afterHtml === '') afterHtml = '';

		ensureBR(content);

		// Toggle: Enter creates a child block inside the toggle
		if (type === 'toggle') {
			var parentDepth = parseInt(wrapper.dataset.depth || '0', 10);
			var childDepth = parentDepth + 1;
			var childBlock = insertBlockAfter(wrapper, 'paragraph', afterHtml);
			childBlock.dataset.parentBlockId = wrapper.dataset.blockId;
			childBlock.dataset.depth = childDepth;
			// Ensure toggle is open
			var ti = wrapper.querySelector('.toggle-icon');
			if (ti && !ti.classList.contains('open')) {
				ti.classList.add('open');
			}
			// Move child after last existing child of this toggle
			var allWrappers = Array.from(document.getElementById('blocks-container').querySelectorAll('.block-wrapper'));
			var lastChild = wrapper;
			allWrappers.forEach(function(w) {
				if (w.dataset.parentBlockId === wrapper.dataset.blockId) lastChild = w;
			});
			if (lastChild !== wrapper) lastChild.after(childBlock);
			setCursorToBlock(childBlock, false);
			scheduleAutoSave();
			return;
		}

		// New block type: same for lists/todos, paragraph otherwise
		var newType = (type === 'bullet_list' || type === 'numbered_list' || type === 'todo') ? type : 'paragraph';
		var newBlock = insertBlockAfter(wrapper, newType, afterHtml);

		// Inherit parent for nested blocks
		if (wrapper.dataset.parentBlockId) {
			newBlock.dataset.parentBlockId = wrapper.dataset.parentBlockId;
			newBlock.dataset.depth = wrapper.dataset.depth || '0';
		}

		updateNumberedLists();
		return;
	}

	// Backspace at start of block
	if (e.key === 'Backspace') {
		var content = getBlockContent(wrapper);
		if (!content) return;

		var sel = window.getSelection();
		if (sel.isCollapsed) {
			var range = sel.getRangeAt(0);
			// Check if cursor is at start
			var testRange = document.createRange();
			testRange.setStart(content, 0);
			testRange.setEnd(range.startContainer, range.startOffset);
			if (testRange.toString() === '') {
				e.preventDefault();
				if (type !== 'paragraph') {
					// Convert to paragraph
					rebuildBlock(wrapper, 'paragraph');
				} else {
					// Merge with previous block
					var prev = wrapper.previousElementSibling;
					while (prev && prev.dataset.type === 'divider') prev = prev.previousElementSibling;
					if (prev) {
						var prevContent = getBlockContent(prev);
						if (prevContent && prevContent.contentEditable !== 'false') {
							var myHtml = cleanContent(content.innerHTML);
							// Set cursor to end of previous block, then append
							setCursorToBlock(prev, true);
							if (myHtml) {
								setTimeout(function() {
									prevContent.innerHTML = DOMPurify.sanitize(cleanContent(prevContent.innerHTML) + myHtml);
									// Set cursor position
									setCursorToBlock(prev, true);
								}, 0);
							}
							wrapper.remove();
							updateNumberedLists();
							scheduleAutoSave();
						}
					}
				}
				return;
			}
		}
	}

	// Tab / Shift+Tab for indentation
	if (e.key === 'Tab') {
		if (type === 'bullet_list' || type === 'numbered_list' || type === 'todo') {
			e.preventDefault();
			if (e.shiftKey) {
				outdentBlock(wrapper);
			} else {
				indentBlock(wrapper);
			}
			scheduleAutoSave();
			return;
		}
	}
}

function handleEditorClick(e) {
	// Handle link clicks
	var link = e.target.closest('a[href]');
	if (link && !link.hasAttribute('data-page-link')) {
		e.preventDefault();
		window.open(link.href, '_blank');
		return;
	}

	// Handle internal page links
	var pageLink = e.target.closest('a[data-page-link]');
	if (pageLink) {
		e.preventDefault();
		selectPage(pageLink.dataset.pageLink);
		return;
	}

	// Handle comment mark clicks
	var mark = e.target.closest('mark.comment-mark');
	if (mark) {
		var commentId = mark.dataset.commentId;
		document.getElementById('comments-panel').style.display = 'flex';
		document.getElementById('shares-panel').style.display = 'none';
		api('GET', '/api/pages/' + currentPageId + '/comments').then(function(comments) {
			allComments = comments;
			renderComments();
			highlightComment(commentId);
		});
		return;
	}
}

function handlePaste(e) {
	var wrapper = getCurrentBlockWrapper();
	if (!wrapper) return;
	if (wrapper.dataset.type === 'code') return; // Let default paste in code blocks

	e.preventDefault();
	var html = e.clipboardData.getData('text/html');
	if (html) {
		document.execCommand('insertHTML', false, DOMPurify.sanitize(html));
	} else {
		document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
	}
}

// ---- Block operations ----
function insertBlockAfter(refWrapper, type, content) {
	var block = {
		id: generateId(),
		type: type,
		content: content || '',
		properties: {}
	};
	var wrapper = createBlockEl(block);
	refWrapper.after(wrapper);

	var contentEl = getBlockContent(wrapper);
	if (contentEl) ensureBR(contentEl);
	setCursorToBlock(wrapper, false);
	scheduleAutoSave();
	return wrapper;
}

function rebuildBlock(wrapper, newType, checked) {
	var oldContent = getBlockContent(wrapper);
	var oldHtml = oldContent ? cleanContent(oldContent.innerHTML) : '';
	var oldType = wrapper.dataset.type;

	wrapper.dataset.type = newType;

	// Remove type-specific elements
	var cb = wrapper.querySelector('.todo-checkbox');
	if (cb) cb.remove();
	var ti = wrapper.querySelector('.toggle-icon');
	if (ti) ti.remove();
	var numSpan = wrapper.querySelector('.list-number');
	if (numSpan) numSpan.remove();
	if (oldContent) oldContent.remove();

	var handle = wrapper.querySelector('.block-handle');

	if (newType === 'todo') {
		var newCb = document.createElement('input');
		newCb.type = 'checkbox';
		newCb.className = 'todo-checkbox';
		newCb.contentEditable = 'false';
		newCb.checked = !!checked;
		if (newCb.checked) wrapper.classList.add('checked');
		else wrapper.classList.remove('checked');
		newCb.addEventListener('change', function() {
			wrapper.classList.toggle('checked', newCb.checked);
			scheduleAutoSave();
		});
		handle.after(newCb);
		var content = document.createElement('div');
		content.className = 'block-content';
		content.innerHTML = DOMPurify.sanitize(oldHtml || '<br>');
		wrapper.appendChild(content);
		ensureBR(content);
		setCursorToBlock(wrapper, false);
	} else if (newType === 'toggle') {
		var toggleIcon = document.createElement('span');
		toggleIcon.className = 'toggle-icon';
		toggleIcon.contentEditable = 'false';
		toggleIcon.textContent = '▶';
		toggleIcon.addEventListener('click', function() {
			toggleIcon.classList.toggle('open');
			var isOpen = toggleIcon.classList.contains('open');
			var container = document.getElementById('blocks-container');
			var allWrappers = Array.from(container.querySelectorAll('.block-wrapper'));
			var myId = wrapper.dataset.blockId;
			var children = allWrappers.filter(function(w) { return w.dataset.parentBlockId === myId; });
			if (isOpen && children.length === 0) {
				var parentDepth = parseInt(wrapper.dataset.depth || '0', 10);
				var childBlock = insertBlockAfter(wrapper, 'paragraph', '');
				childBlock.dataset.parentBlockId = myId;
				childBlock.dataset.depth = parentDepth + 1;
				setCursorToBlock(childBlock, false);
				scheduleAutoSave();
			} else {
				children.forEach(function(w) {
					w.style.display = isOpen ? '' : 'none';
				});
			}
		});
		handle.after(toggleIcon);
		var content = document.createElement('div');
		content.className = 'block-content';
		content.innerHTML = DOMPurify.sanitize(oldHtml || '<br>');
		wrapper.appendChild(content);
		ensureBR(content);
		setCursorToBlock(wrapper, false);
	} else if (newType === 'numbered_list') {
		var numSpan = document.createElement('span');
		numSpan.className = 'list-number';
		numSpan.contentEditable = 'false';
		numSpan.textContent = '1.';
		handle.after(numSpan);
		var content = document.createElement('div');
		content.className = 'block-content';
		content.innerHTML = DOMPurify.sanitize(oldHtml || '<br>');
		wrapper.appendChild(content);
		ensureBR(content);
		setCursorToBlock(wrapper, false);
		updateNumberedLists();
	} else if (newType === 'divider') {
		wrapper.classList.remove('checked');
		var content = document.createElement('div');
		content.className = 'block-content';
		content.contentEditable = 'false';
		content.innerHTML = '<hr>';
		wrapper.appendChild(content);
		// Insert a new paragraph after
		insertBlockAfter(wrapper, 'paragraph', '');
	} else if (newType === 'code') {
		wrapper.classList.remove('checked');
		var codeWrapper = document.createElement('div');
		codeWrapper.className = 'block-content code-block-wrapper';
		codeWrapper.contentEditable = 'false';
		var langSelect = createCodeLangSelect('');
		codeWrapper.appendChild(langSelect);
		var pre = document.createElement('pre');
		var code = document.createElement('code');
		code.contentEditable = 'true';
		code.textContent = oldHtml.replace(/<[^>]*>/g, '') || '';
		code.addEventListener('input', function() { scheduleAutoSave(); });
		code.addEventListener('keydown', function(e) {
			if (e.key === 'Tab') {
				e.preventDefault();
				document.execCommand('insertText', false, '  ');
			}
		});
		pre.appendChild(code);
		codeWrapper.appendChild(pre);
		wrapper.appendChild(codeWrapper);
		setTimeout(function() { code.focus(); }, 50);
	} else if (newType === 'math') {
		wrapper.classList.remove('checked');
		var mathDiv = document.createElement('div');
		mathDiv.className = 'block-content math-block';
		mathDiv.contentEditable = 'false';
		var preview = document.createElement('div');
		preview.className = 'math-preview';
		preview.addEventListener('click', function() {
			mathDiv.classList.add('editing');
			mathInput.focus();
		});
		mathDiv.appendChild(preview);
		var mathInput = document.createElement('div');
		mathInput.className = 'math-input';
		mathInput.contentEditable = 'true';
		mathInput.textContent = '';
		mathInput.addEventListener('blur', function() {
			mathDiv.classList.remove('editing');
			renderSingleMath(mathDiv);
			scheduleAutoSave();
		});
		mathInput.addEventListener('input', function() { scheduleAutoSave(); });
		mathInput.addEventListener('keydown', function(e) {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				mathInput.blur();
			}
		});
		mathDiv.appendChild(mathInput);
		wrapper.appendChild(mathDiv);
		mathDiv.classList.add('editing');
		setTimeout(function() { mathInput.focus(); }, 50);
	} else if (newType === 'image') {
		wrapper.classList.remove('checked');
		var imgDiv = document.createElement('div');
		imgDiv.className = 'block-content image-block';
		imgDiv.contentEditable = 'false';
		var placeholder = document.createElement('div');
		placeholder.className = 'image-upload-placeholder';
		placeholder.textContent = 'Click to upload image';
		placeholder.addEventListener('click', function() { uploadImage(wrapper); });
		imgDiv.appendChild(placeholder);
		wrapper.appendChild(imgDiv);
	} else if (newType === 'file') {
		wrapper.classList.remove('checked');
		var fileDiv = document.createElement('div');
		fileDiv.className = 'block-content file-block';
		fileDiv.contentEditable = 'false';
		var uploadBtn = document.createElement('div');
		uploadBtn.className = 'image-upload-placeholder';
		uploadBtn.textContent = 'Click to upload file';
		uploadBtn.addEventListener('click', function() { uploadFile(wrapper); });
		fileDiv.appendChild(uploadBtn);
		wrapper.appendChild(fileDiv);
	} else if (newType === 'page_link') {
		wrapper.classList.remove('checked');
		showPageLinkModal(wrapper);
		// Temp placeholder
		var linkDiv = document.createElement('div');
		linkDiv.className = 'block-content page-link-block';
		linkDiv.contentEditable = 'false';
		linkDiv.textContent = '📄 Select a page...';
		wrapper.appendChild(linkDiv);
	} else if (newType === 'table') {
		wrapper.classList.remove('checked');
		var tableDiv = document.createElement('div');
		tableDiv.className = 'block-content table-wrapper';
		tableDiv.contentEditable = 'false';
		tableDiv.appendChild(createTableElement([['Header 1', 'Header 2'], ['', '']]));
		tableDiv.appendChild(createTableControls(tableDiv));
		wrapper.appendChild(tableDiv);
	} else {
		// paragraph, heading1-3, bullet_list, quote, callout
		wrapper.classList.remove('checked');
		var content = document.createElement('div');
		content.className = 'block-content';
		content.innerHTML = DOMPurify.sanitize(oldHtml || '<br>');
		wrapper.appendChild(content);
		ensureBR(content);
		setCursorToBlock(wrapper, false);
	}
}

// ---- Indentation (Tab/Shift+Tab) ----
function indentBlock(wrapper) {
	var container = document.getElementById('blocks-container');
	var allWrappers = Array.from(container.querySelectorAll('.block-wrapper'));
	var idx = allWrappers.indexOf(wrapper);
	if (idx <= 0) return;

	// Find previous sibling at same or higher level
	var prevSibling = null;
	for (var i = idx - 1; i >= 0; i--) {
		var w = allWrappers[i];
		if ((w.dataset.parentBlockId || '') === (wrapper.dataset.parentBlockId || '')) {
			prevSibling = w;
			break;
		}
	}
	if (!prevSibling) return;

	// Check depth limit
	var currentDepth = parseInt(wrapper.dataset.depth || '0');
	if (currentDepth >= 4) return;

	wrapper.dataset.parentBlockId = prevSibling.dataset.blockId;
	wrapper.dataset.depth = currentDepth + 1;
	updateNumberedLists();
}

function outdentBlock(wrapper) {
	var parentId = wrapper.dataset.parentBlockId;
	if (!parentId) return;

	var container = document.getElementById('blocks-container');
	var parentWrapper = container.querySelector('[data-block-id="' + parentId + '"]');
	if (!parentWrapper) return;

	wrapper.dataset.parentBlockId = parentWrapper.dataset.parentBlockId || '';
	if (!wrapper.dataset.parentBlockId) delete wrapper.dataset.parentBlockId;
	var newDepth = parseInt(wrapper.dataset.depth || '1') - 1;
	if (newDepth > 0) wrapper.dataset.depth = newDepth;
	else delete wrapper.dataset.depth;
	updateNumberedLists();
}

// ---- Numbered list numbering ----
function updateNumberedLists() {
	var container = document.getElementById('blocks-container');
	var allWrappers = Array.from(container.querySelectorAll('.block-wrapper'));

	// Group by parent
	var groups = {};
	allWrappers.forEach(function(w) {
		if (w.dataset.type !== 'numbered_list') return;
		var parentKey = w.dataset.parentBlockId || '__root__';
		if (!groups[parentKey]) groups[parentKey] = [];
		groups[parentKey].push(w);
	});

	Object.keys(groups).forEach(function(key) {
		var wrappers = groups[key];
		// Re-count within each parent, restarting when non-numbered blocks appear
		var count = 0;
		var allSiblings = allWrappers.filter(function(w) {
			return (w.dataset.parentBlockId || '__root__') === key;
		});
		allSiblings.forEach(function(w) {
			if (w.dataset.type === 'numbered_list') {
				count++;
				var numSpan = w.querySelector('.list-number');
				if (numSpan) numSpan.textContent = count + '.';
			} else {
				count = 0;
			}
		});
	});
}

// ---- Slash menu ----
function showSlashMenu() {
	var slash = document.getElementById('slash-menu');
	var items = SLASH_ITEMS.filter(function(item) {
		if (!slashQuery) return true;
		var q = slashQuery.toLowerCase();
		return item.label.toLowerCase().indexOf(q) !== -1 || item.keywords.toLowerCase().indexOf(q) !== -1;
	});

	if (items.length === 0) {
		slash.style.display = 'none';
		return;
	}

	slash.innerHTML = '';
	items.forEach(function(item, idx) {
		var div = document.createElement('div');
		div.className = 'slash-item' + (idx === 0 ? ' active' : '');
		div.innerHTML = '<span class="slash-icon">' + item.icon + '</span><span class="slash-label">' + item.label + '</span>';
		div.addEventListener('mousedown', function(e) {
			e.preventDefault();
			applySlashItem(item);
		});
		slash.appendChild(div);
	});

	// Position near cursor
	var sel = window.getSelection();
	if (sel.rangeCount > 0) {
		var rect = sel.getRangeAt(0).getBoundingClientRect();
		slash.style.left = rect.left + 'px';
		slash.style.top = (rect.bottom + 4) + 'px';
	}
	slash.style.display = 'block';
}

function hideSlashMenu() {
	document.getElementById('slash-menu').style.display = 'none';
	slashQuery = '';
	slashBlockId = null;
}

function navigateSlashMenu(dir) {
	var slash = document.getElementById('slash-menu');
	var items = slash.querySelectorAll('.slash-item');
	var active = slash.querySelector('.slash-item.active');
	if (!active || items.length === 0) return;

	var idx = Array.from(items).indexOf(active);
	active.classList.remove('active');
	idx = (idx + dir + items.length) % items.length;
	items[idx].classList.add('active');
	items[idx].scrollIntoView({ block: 'nearest' });
}

function selectSlashItem() {
	var slash = document.getElementById('slash-menu');
	var active = slash.querySelector('.slash-item.active');
	if (!active) return;
	active.dispatchEvent(new MouseEvent('mousedown'));
}

function applySlashItem(item) {
	var blockId = slashBlockId;
	hideSlashMenu();
	var container = document.getElementById('blocks-container');
	var wrapper = container.querySelector('[data-block-id="' + blockId + '"]');
	if (!wrapper) return;

	// Clear the slash command text
	var content = getBlockContent(wrapper);
	if (content) content.innerHTML = '<br>';

	rebuildBlock(wrapper, item.type);
	scheduleAutoSave();
}

// ---- Inline code toggle ----
function toggleInlineCode() {
	var sel = window.getSelection();
	if (sel.isCollapsed) return;

	var range = sel.getRangeAt(0);
	var container = range.commonAncestorContainer;

	// Check if selection is within a code element
	var codeEl = null;
	var node = container;
	while (node && node !== document.getElementById('blocks-container')) {
		if (node.nodeName === 'CODE' && node.classList && node.classList.contains('inline-code')) {
			codeEl = node;
			break;
		}
		node = node.parentNode;
	}

	if (codeEl) {
		// Remove code formatting - extract text, replace code element
		var text = codeEl.textContent;
		var textNode = document.createTextNode(text);
		codeEl.parentNode.replaceChild(textNode, codeEl);
		// Reselect the text
		var newRange = document.createRange();
		newRange.selectNodeContents(textNode);
		sel.removeAllRanges();
		sel.addRange(newRange);
	} else {
		// Wrap in code
		var text = range.toString();
		var code = document.createElement('code');
		code.className = 'inline-code';
		range.deleteContents();
		code.textContent = text;
		range.insertNode(code);
		// Select the code contents
		var newRange = document.createRange();
		newRange.selectNodeContents(code);
		sel.removeAllRanges();
		sel.addRange(newRange);
	}
	scheduleAutoSave();
}

// ---- Block drag and drop ----
function handleBlockDragStart(e) {
	var handle = e.target.closest('.block-handle');
	if (!handle) return;
	var wrapper = handle.closest('.block-wrapper');
	if (!wrapper) return;

	draggedBlockId = wrapper.dataset.blockId;
	wrapper.classList.add('dragging');
	e.dataTransfer.effectAllowed = 'move';
	e.dataTransfer.setData('text/plain', draggedBlockId);
}

function handleBlockDragOver(e) {
	if (!draggedBlockId) return;
	e.preventDefault();
	e.dataTransfer.dropEffect = 'move';

	var wrapper = getBlockWrapper(e.target);
	if (!wrapper || wrapper.dataset.blockId === draggedBlockId) return;

	// Clear existing indicators
	document.querySelectorAll('.block-wrapper.drag-above, .block-wrapper.drag-below').forEach(function(w) {
		w.classList.remove('drag-above', 'drag-below');
	});

	var rect = wrapper.getBoundingClientRect();
	var mid = rect.top + rect.height / 2;
	if (e.clientY < mid) {
		wrapper.classList.add('drag-above');
	} else {
		wrapper.classList.add('drag-below');
	}
}

function handleBlockDragLeave(e) {
	var wrapper = getBlockWrapper(e.target);
	if (wrapper) {
		wrapper.classList.remove('drag-above', 'drag-below');
	}
}

function handleBlockDrop(e) {
	e.preventDefault();
	if (!draggedBlockId) return;

	var targetWrapper = getBlockWrapper(e.target);
	if (!targetWrapper || targetWrapper.dataset.blockId === draggedBlockId) return;

	var container = document.getElementById('blocks-container');
	var draggedWrapper = container.querySelector('[data-block-id="' + draggedBlockId + '"]');
	if (!draggedWrapper) return;

	var rect = targetWrapper.getBoundingClientRect();
	var mid = rect.top + rect.height / 2;

	if (e.clientY < mid) {
		targetWrapper.before(draggedWrapper);
	} else {
		targetWrapper.after(draggedWrapper);
	}

	handleBlockDragEnd();
	scheduleAutoSave();
}

function handleBlockDragEnd() {
	if (draggedBlockId) {
		var container = document.getElementById('blocks-container');
		var wrapper = container.querySelector('[data-block-id="' + draggedBlockId + '"]');
		if (wrapper) wrapper.classList.remove('dragging');
	}
	draggedBlockId = null;
	document.querySelectorAll('.block-wrapper.drag-above, .block-wrapper.drag-below').forEach(function(w) {
		w.classList.remove('drag-above', 'drag-below');
	});
}

// ---- Uploads ----
function uploadImage(wrapper) {
	var input = document.createElement('input');
	input.type = 'file';
	input.accept = 'image/*';
	input.addEventListener('change', function() {
		if (!input.files[0]) return;
		var form = new FormData();
		form.append('file', input.files[0]);
		form.append('block_type', 'image');
		api('POST', '/api/pages/' + currentPageId + '/upload', form).then(function(result) {
			var imgDiv = wrapper.querySelector('.image-block');
			imgDiv.innerHTML = '';
			var img = document.createElement('img');
			img.src = result.src;
			imgDiv.appendChild(img);
			scheduleAutoSave();
		});
	});
	input.click();
}

function uploadFile(wrapper) {
	var input = document.createElement('input');
	input.type = 'file';
	input.addEventListener('change', function() {
		if (!input.files[0]) return;
		var form = new FormData();
		form.append('file', input.files[0]);
		form.append('block_type', 'file');
		api('POST', '/api/pages/' + currentPageId + '/upload', form).then(function(result) {
			var fileDiv = wrapper.querySelector('.file-block');
			fileDiv.innerHTML = '📎 <a href="' + escapeHtml(result.src) + '" download="' + escapeHtml(result.filename) + '">' + escapeHtml(result.filename) + '</a>';
			wrapper.querySelector('.block-content').dataset.src = result.src;
			wrapper.querySelector('.block-content').dataset.filename = result.filename;
			scheduleAutoSave();
		});
	});
	input.click();
}

// ---- Page link modal ----
function showPageLinkModal(wrapper) {
	var modal = document.getElementById('page-link-modal');
	var searchInput = document.getElementById('page-link-search');
	var results = document.getElementById('page-link-results');

	modal.style.display = 'flex';
	searchInput.value = '';
	searchInput.focus();

	function renderResults() {
		var q = searchInput.value.trim().toLowerCase();
		results.innerHTML = '';
		allPages.forEach(function(p) {
			if (q && p.title.toLowerCase().indexOf(q) === -1) return;
			if (p.id === currentPageId) return;
			var item = document.createElement('div');
			item.className = 'page-link-item';
			item.textContent = (p.icon || '📄') + ' ' + p.title;
			item.addEventListener('click', function() {
				modal.style.display = 'none';
				var linkDiv = wrapper.querySelector('.page-link-block');
				linkDiv.textContent = '📄 ' + p.title;
				linkDiv.dataset.pageId = p.id;
				linkDiv.addEventListener('click', function() { selectPage(p.id); });
				scheduleAutoSave();
			});
			results.appendChild(item);
		});
	}

	searchInput.oninput = renderResults;
	renderResults();
}

// ---- Emoji picker ----
function toggleEmojiPicker() {
	var picker = document.getElementById('emoji-picker');
	if (picker.style.display !== 'none') {
		picker.style.display = 'none';
		return;
	}

	picker.innerHTML = '';
	EMOJIS.forEach(function(emoji) {
		var span = document.createElement('span');
		span.className = 'emoji-item';
		span.textContent = emoji;
		span.addEventListener('click', function() {
			if (!currentPageId) return;
			currentPage.icon = emoji;
			document.getElementById('page-icon-btn').textContent = emoji;
			picker.style.display = 'none';
			api('PUT', '/api/pages/' + currentPageId, { title: currentPage.title, icon: emoji });
			loadPages();
		});
		picker.appendChild(span);
	});

	var btn = document.getElementById('page-icon-btn');
	var rect = btn.getBoundingClientRect();
	picker.style.left = rect.left + 'px';
	picker.style.top = (rect.bottom + 4) + 'px';
	picker.style.display = 'grid';
}

// ---- Auto-save ----
function scheduleAutoSave() {
	if (autoSaveTimer) clearTimeout(autoSaveTimer);
	autoSaveTimer = setTimeout(function() {
		autoSaveTimer = null;
		doSave();
	}, 1000);
}

function doSave() {
	if (!currentPageId) return;

	// Save page title/icon
	api('PUT', '/api/pages/' + currentPageId, {
		title: document.getElementById('page-title').value || 'Untitled',
		icon: currentPage ? currentPage.icon || '' : ''
	}).then(function() { loadPages(); });

	// Collect blocks
	var blocks = collectBlocks();
	api('PUT', '/api/pages/' + currentPageId + '/blocks', blocks).then(function(page) {
		if (page && page.updated_at) {
			currentPage.updated_at = page.updated_at;
		}
	});
}

function collectBlocks() {
	var container = document.getElementById('blocks-container');
	var wrappers = container.querySelectorAll('.block-wrapper');
	var blocks = [];

	wrappers.forEach(function(wrapper, idx) {
		var type = wrapper.dataset.type;
		var content = '';
		var properties = {};
		var parentBlockId = wrapper.dataset.parentBlockId || null;

		if (type === 'divider') {
			content = '';
		} else if (type === 'code') {
			var code = wrapper.querySelector('code');
			content = code ? code.innerText : '';
			var lang = wrapper.querySelector('.code-language');
			properties.language = lang ? lang.value : '';
		} else if (type === 'image') {
			var img = wrapper.querySelector('img');
			properties.src = img ? img.src : '';
			// Convert absolute URL to relative path
			if (properties.src && properties.src.indexOf('/uploads/') !== -1) {
				properties.src = '/uploads/' + properties.src.split('/uploads/').pop();
			}
		} else if (type === 'file') {
			var link = wrapper.querySelector('.file-block a');
			if (link) {
				content = link.textContent;
				var href = link.getAttribute('href') || '';
				properties.src = href;
				properties.filename = link.getAttribute('download') || content;
			}
		} else if (type === 'page_link') {
			var linkDiv = wrapper.querySelector('.page-link-block');
			properties.page_id = linkDiv ? linkDiv.dataset.pageId : '';
			content = linkDiv ? linkDiv.textContent.replace(/^📄\s*/, '') : '';
		} else if (type === 'table') {
			var rows = [];
			var table = wrapper.querySelector('table');
			if (table) {
				Array.from(table.rows).forEach(function(tr) {
					var row = [];
					Array.from(tr.cells).forEach(function(td) {
						row.push(td.textContent);
					});
					rows.push(row);
				});
			}
			properties.rows = rows;
		} else if (type === 'math') {
			var mathInput = wrapper.querySelector('.math-input');
			content = mathInput ? mathInput.textContent : '';
		} else if (type === 'todo') {
			var bc = wrapper.querySelector('.block-content');
			content = bc ? cleanContent(bc.innerHTML) : '';
			var cb = wrapper.querySelector('.todo-checkbox');
			properties.checked = cb ? cb.checked : false;
		} else {
			var bc = wrapper.querySelector('.block-content');
			content = bc ? cleanContent(bc.innerHTML) : '';
		}

		blocks.push({
			id: wrapper.dataset.blockId,
			type: type,
			content: content,
			properties: properties,
			position: idx,
			parent_block_id: parentBlockId
		});
	});

	return blocks;
}

// ---- Comments ----
function openCommentsPanel() {
	document.getElementById('comments-panel').style.display = 'flex';
	document.getElementById('shares-panel').style.display = 'none';
	loadComments();
}

function toggleCommentsPanel() {
	var panel = document.getElementById('comments-panel');
	if (panel.style.display !== 'none') {
		panel.style.display = 'none';
	} else {
		openCommentsPanel();
	}
}

function loadComments() {
	if (!currentPageId) return;
	api('GET', '/api/pages/' + currentPageId + '/comments').then(function(comments) {
		allComments = comments;
		renderComments();
	});
}

function renderComments() {
	var list = document.getElementById('comments-list');
	list.innerHTML = '';

	// Group into threads (top-level comments and their replies)
	var threads = [];
	var threadMap = {};

	allComments.forEach(function(c) {
		if (!c.parent_comment_id) {
			var thread = { comment: c, replies: [] };
			threads.push(thread);
			threadMap[c.id] = thread;
		}
	});

	allComments.forEach(function(c) {
		if (c.parent_comment_id && threadMap[c.parent_comment_id]) {
			threadMap[c.parent_comment_id].replies.push(c);
		}
	});

	if (threads.length === 0) {
		list.innerHTML = '<p style="color:#bbb;text-align:center;padding:20px;font-size:12px">Select text and click Comment to add one.</p>';
		return;
	}

	// Sort by block position in document
	var container = document.getElementById('blocks-container');
	var allWrappers = container ? Array.from(container.querySelectorAll('.block-wrapper')) : [];
	threads.sort(function(a, b) {
		var aIdx = -1, bIdx = -1;
		if (a.comment.block_id) {
			aIdx = allWrappers.findIndex(function(w) { return w.dataset.blockId === a.comment.block_id; });
		}
		if (b.comment.block_id) {
			bIdx = allWrappers.findIndex(function(w) { return w.dataset.blockId === b.comment.block_id; });
		}
		if (aIdx === -1 && bIdx === -1) return 0;
		if (aIdx === -1) return 1;
		if (bIdx === -1) return -1;
		return aIdx - bIdx;
	});

	threads.forEach(function(thread) {
		var threadDiv = document.createElement('div');
		threadDiv.className = 'comment-thread' + (thread.comment.resolved ? ' resolved' : '');
		threadDiv.dataset.commentId = thread.comment.id;

		// Main comment
		threadDiv.appendChild(createCommentItem(thread.comment, true));

		// Replies
		thread.replies.forEach(function(reply) {
			threadDiv.appendChild(createCommentItem(reply, false));
		});

		// Reply form
		var replyForm = document.createElement('div');
		replyForm.className = 'comment-reply-form';
		var textarea = document.createElement('textarea');
		textarea.placeholder = 'Reply...';
		replyForm.appendChild(textarea);
		var submitBtn = document.createElement('button');
		submitBtn.textContent = 'Reply';
		submitBtn.addEventListener('click', function() {
			if (!textarea.value.trim()) return;
			api('POST', '/api/pages/' + currentPageId + '/comments', {
				parent_comment_id: thread.comment.id,
				content: textarea.value.trim()
			}).then(function() { loadComments(); });
		});
		replyForm.appendChild(submitBtn);
		threadDiv.appendChild(replyForm);

		list.appendChild(threadDiv);
	});
}

function createCommentItem(comment, isThread) {
	var div = document.createElement('div');
	div.className = 'comment-item';

	var header = document.createElement('div');
	header.className = 'comment-header';
	var author = document.createElement('span');
	author.className = 'comment-author';
	author.textContent = comment.author;
	header.appendChild(author);
	var time = document.createElement('span');
	time.className = 'comment-time';
	time.textContent = formatTime(comment.created_at);
	header.appendChild(time);
	div.appendChild(header);

	if (comment.highlighted_text && isThread) {
		var quote = document.createElement('div');
		quote.className = 'comment-quote';
		quote.textContent = '"' + comment.highlighted_text + '"';
		quote.style.cursor = 'pointer';
		quote.addEventListener('click', function() {
			var mark = document.querySelector('mark.comment-mark[data-comment-id="' + comment.id + '"]');
			if (mark) {
				mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
				mark.style.background = '#ffd54f';
				setTimeout(function() { mark.style.background = ''; }, 2000);
			}
		});
		div.appendChild(quote);
	}

	var text = document.createElement('div');
	text.className = 'comment-text';
	text.textContent = comment.content;
	div.appendChild(text);

	if (isThread && !comment.resolved) {
		var actions = document.createElement('div');
		actions.className = 'comment-actions';
		var resolveBtn = document.createElement('button');
		resolveBtn.textContent = 'Resolve';
		resolveBtn.addEventListener('click', function() {
			api('PUT', '/api/comments/' + comment.id + '/resolve').then(function() { loadComments(); });
		});
		actions.appendChild(resolveBtn);
		div.appendChild(actions);
	}

	return div;
}

function highlightComment(commentId) {
	var threads = document.querySelectorAll('.comment-thread');
	threads.forEach(function(t) { t.classList.remove('highlight'); });
	var target = document.querySelector('.comment-thread[data-comment-id="' + commentId + '"]');
	if (target) {
		target.classList.add('highlight');
		target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
		setTimeout(function() { target.classList.remove('highlight'); }, 3000);
	}
}

function handleTextSelection() {
	setTimeout(function() {
		var sel = window.getSelection();
		var text = sel.toString().trim();
		var btn = document.getElementById('comment-float-btn');

		if (!text || sel.rangeCount === 0) {
			btn.style.display = 'none';
			return;
		}

		// Check if selection is in blocks container
		var range = sel.getRangeAt(0);
		var container = document.getElementById('blocks-container');
		if (!container.contains(range.commonAncestorContainer)) {
			btn.style.display = 'none';
			return;
		}

		var rect = range.getBoundingClientRect();
		btn.style.left = (rect.left + rect.width / 2 - 30) + 'px';
		btn.style.top = (rect.top - 32) + 'px';
		btn.style.display = 'block';
	}, 10);
}

function createCommentFromSelection() {
	var sel = window.getSelection();
	if (!sel.rangeCount) return;

	var range = sel.getRangeAt(0);
	var text = sel.toString().trim();
	if (!text) return;

	// Wrap selection in mark
	var commentId = generateId();
	var mark = document.createElement('mark');
	mark.className = 'comment-mark';
	mark.dataset.commentId = commentId;

	try {
		range.surroundContents(mark);
	} catch (e) {
		// Cross-element selection - wrap what we can
		mark.textContent = text;
		range.deleteContents();
		range.insertNode(mark);
	}

	document.getElementById('comment-float-btn').style.display = 'none';

	// Find which block the comment is in
	var wrapper = getBlockWrapper(mark);
	var blockId = wrapper ? wrapper.dataset.blockId : null;

	// Show comments panel and insert form after comments load
	document.getElementById('comments-panel').style.display = 'flex';
	document.getElementById('shares-panel').style.display = 'none';
	scheduleAutoSave();

	var insertForm = function() {
		var list = document.getElementById('comments-list');
		// Remove any existing new-comment-form
		var existing = list.querySelector('.new-comment-form');
		if (existing) existing.remove();
		var formDiv = document.createElement('div');
	formDiv.className = 'comment-thread new-comment-form';
	formDiv.innerHTML = '<div style="font-size:12px;color:#999;margin-bottom:4px">Commenting on: <em>"' + escapeHtml(text.substring(0, 50)) + (text.length > 50 ? '...' : '') + '"</em></div>';
	var textarea = document.createElement('textarea');
	textarea.placeholder = 'Write a comment...';
	textarea.style.cssText = 'width:100%;min-height:60px;margin-bottom:6px;padding:6px;border:1px solid #ddd;border-radius:4px;font-size:13px;resize:vertical;';
	formDiv.appendChild(textarea);
	var btnRow = document.createElement('div');
	btnRow.style.cssText = 'display:flex;gap:6px;justify-content:flex-end;';
	var cancelBtn = document.createElement('button');
	cancelBtn.textContent = 'Cancel';
	cancelBtn.style.cssText = 'padding:4px 10px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer;font-size:12px;';
	cancelBtn.addEventListener('click', function() {
		formDiv.remove();
		var parent = mark.parentNode;
		while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
		parent.removeChild(mark);
		scheduleAutoSave();
	});
	var submitBtn = document.createElement('button');
	submitBtn.textContent = 'Comment';
	submitBtn.style.cssText = 'padding:4px 10px;border:none;border-radius:4px;background:#2eaadc;color:#fff;cursor:pointer;font-size:12px;';
	submitBtn.addEventListener('click', function() {
		var commentText = textarea.value.trim();
		if (!commentText) return;
		formDiv.remove();
		api('POST', '/api/pages/' + currentPageId + '/comments', {
			block_id: blockId,
			highlighted_text: text,
			content: commentText
		}).then(function(comment) {
			if (comment && comment.id) {
				// Find mark by client ID (may have been re-rendered)
				var m = document.querySelector('mark[data-comment-id="' + commentId + '"]') || mark;
				m.dataset.commentId = comment.id;
				scheduleAutoSave();
			}
			loadComments();
		});
	});
	btnRow.appendChild(cancelBtn);
	btnRow.appendChild(submitBtn);
	formDiv.appendChild(btnRow);
	list.insertBefore(formDiv, list.firstChild);
	textarea.focus();
	};

	// Load comments first, then insert form on top
	api('GET', '/api/pages/' + currentPageId + '/comments').then(function(comments) {
		allComments = comments;
		renderComments();
		insertForm();
	});
}

function applyCommentHighlights() {
	// Apply text-match highlights for comments that don't already have a mark in the DOM
	allComments.forEach(function(c) {
		if (c.highlighted_text && !c.resolved && !document.querySelector('mark.comment-mark[data-comment-id="' + c.id + '"]')) {
			var container = document.getElementById('blocks-container');
			var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
			var node;
			while ((node = walker.nextNode())) {
				var idx = node.textContent.indexOf(c.highlighted_text);
				if (idx !== -1) {
					var range = document.createRange();
					range.setStart(node, idx);
					range.setEnd(node, idx + c.highlighted_text.length);
					var mark = document.createElement('mark');
					mark.className = 'comment-mark';
					mark.dataset.commentId = c.id;
					try { range.surroundContents(mark); } catch (e) {}
					break;
				}
			}
		}
	});
}

// ---- Shares ----
function toggleSharesPanel() {
	var panel = document.getElementById('shares-panel');
	if (panel.style.display !== 'none') {
		panel.style.display = 'none';
	} else {
		panel.style.display = 'flex';
		document.getElementById('comments-panel').style.display = 'none';
		loadShares();
	}
}

function loadShares() {
	if (!currentPageId) return;
	api('GET', '/api/pages/' + currentPageId + '/shares').then(renderShares);
}

function renderShares(shares) {
	var list = document.getElementById('shares-list');
	list.innerHTML = '';

	shares.forEach(function(s) {
		var div = document.createElement('div');
		div.className = 'share-item';

		var info = document.createElement('div');
		info.className = 'share-info';
		info.innerHTML = '<div class="share-alias">' + escapeHtml(s.alias) + '</div><div class="share-type">' + escapeHtml(s.key_type) + '</div>';
		div.appendChild(info);

		var link = document.createElement('span');
		link.className = 'share-link';
		var url = window.location.origin + '/shared/' + s.token;
		link.textContent = url;
		link.title = 'Click to copy';
		link.addEventListener('click', function() {
			navigator.clipboard.writeText(url);
			link.textContent = 'Copied!';
			setTimeout(function() { link.textContent = url; }, 2000);
		});
		div.appendChild(link);

		var del = document.createElement('button');
		del.className = 'share-delete';
		del.textContent = '✕';
		del.addEventListener('click', function() {
			api('DELETE', '/api/shares/' + s.id).then(loadShares);
		});
		div.appendChild(del);

		list.appendChild(div);
	});
}

function createShare() {
	if (!currentPageId) return;
	var alias = document.getElementById('share-alias').value.trim() || 'Anonymous';
	var keyType = document.getElementById('share-key-type').value;
	api('POST', '/api/pages/' + currentPageId + '/shares', { alias: alias, key_type: keyType })
		.then(function() {
			document.getElementById('share-alias').value = '';
			loadShares();
		});
}

// ---- Code highlighting ----
function highlightCodeBlocks() {
	if (typeof hljs === 'undefined') return;

	document.querySelectorAll('#blocks-container .code-block-wrapper code').forEach(function(code) {
		var wrapper = getBlockWrapper(code);
		var lang = wrapper ? wrapper.querySelector('.code-language') : null;
		var langVal = lang ? lang.value : '';
		var text = code.innerText;
		if (!text.trim()) return;

		// Save cursor position using innerText offset
		var sel = window.getSelection();
		var cursorOffset = -1;
		if (sel.rangeCount && code.contains(sel.anchorNode)) {
			// Use a temporary marker to find cursor position in innerText
			var savedRange = sel.getRangeAt(0).cloneRange();
			savedRange.collapse(true);
			var marker = document.createTextNode('\u200B');
			savedRange.insertNode(marker);
			var fullText = code.innerText;
			cursorOffset = fullText.indexOf('\u200B');
			marker.parentNode.removeChild(marker);
			// Re-read text without marker
			text = code.innerText;
		}

		if (!text.trim()) return;

		try {
			var result = langVal
				? hljs.highlight(text, { language: langVal })
				: hljs.highlightAuto(text);
			code.innerHTML = result.value;
		} catch (e) { return; }

		// Restore cursor position
		if (cursorOffset >= 0) {
			var walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
			var node, charCount = 0;
			while ((node = walker.nextNode())) {
				if (charCount + node.textContent.length >= cursorOffset) {
					var newRange = document.createRange();
					newRange.setStart(node, cursorOffset - charCount);
					newRange.collapse(true);
					sel.removeAllRanges();
					sel.addRange(newRange);
					break;
				}
				charCount += node.textContent.length;
			}
		}
	});
}

// ---- Math rendering ----
function renderMathBlocks() {
	document.querySelectorAll('#blocks-container .math-block').forEach(function(mathDiv) {
		renderSingleMath(mathDiv);
	});
}

function renderSingleMath(mathDiv) {
	if (typeof katex === 'undefined') return;
	var input = mathDiv.querySelector('.math-input');
	var preview = mathDiv.querySelector('.math-preview');
	if (!input || !preview) return;

	var latex = input.textContent.trim();
	if (!latex) {
		preview.textContent = 'Empty equation';
		preview.style.color = '#999';
		return;
	}
	try {
		katex.render(latex, preview, { throwOnError: false, displayMode: true });
		preview.style.color = '';
	} catch (e) {
		preview.textContent = latex;
		preview.style.color = '#999';
	}
}

// ---- Polling ----
function startPolling() {
	pollTimer = setInterval(function() {
		if (!currentPageId) return;
		if (autoSaveTimer) return; // Skip if pending save
		var container = document.getElementById('blocks-container');
		if (document.activeElement && (document.activeElement === container || container.contains(document.activeElement))) return; // Skip if user has focus

		api('GET', '/api/pages/' + currentPageId + '/blocks').then(function(blocks) {
			api('GET', '/api/pages/' + currentPageId + '/comments').then(function(comments) {
				allComments = comments;
				// Don't re-render comments if user is writing a new comment
				if (!document.querySelector('.new-comment-form')) {
					renderComments();
				}
				renderBlocks(blocks);
			});
		}).catch(function() {}); // Ignore poll errors

		// Refresh page list too
		loadPages();
	}, 3000);
}

// ---- Helpers ----
function formatTime(dateStr) {
	if (!dateStr) return '';
	var d = new Date(dateStr.replace(' ', 'T') + 'Z');
	if (isNaN(d.getTime())) return '';
	var now = new Date();
	var diff = now - d;
	if (diff < 60000) return 'just now';
	if (diff < 3600000) return Math.floor(diff / 60000) + ' minutes ago';
	if (diff < 86400000) return Math.floor(diff / 3600000) + ' hours ago';
	var days = Math.floor(diff / 86400000);
	if (days === 1) return 'yesterday';
	if (days < 30) return days + ' days ago';
	return d.toLocaleDateString();
}

// ---- Start ----
document.addEventListener('DOMContentLoaded', init);

})();
