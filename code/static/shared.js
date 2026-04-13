(function() {
'use strict';

var shareData = null;
var autoSaveTimer = null;
var pollTimer = null;
var slashQuery = '';
var slashBlockId = null;

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
	{ type: 'table', label: 'Table', icon: '📊', keywords: 'table grid data' },
	{ type: 'math', label: 'Math Equation', icon: '∑', keywords: 'math latex equation katex' }
];

// ---- API ----
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

function sharedUploadUrl(src) {
	if (!src || src.indexOf('/uploads/') === -1) return src;
	var filename = src.split('/uploads/').pop().split('?')[0];
	return '/api/shared/' + shareToken + '/uploads/' + encodeURIComponent(filename);
}

function cleanUploadPath(src) {
	if (!src) return src;
	var idx = src.lastIndexOf('/uploads/');
	if (idx === -1) return src;
	var filename = src.substring(idx + '/uploads/'.length).split('?')[0];
	return '/uploads/' + filename;
}

// ---- Init ----
function init() {
	loadSharedPage().then(function() {
		startPolling();
	});

	var container = document.getElementById('shared-blocks-container');

	if (shareKeyType === 'editor') {
		container.addEventListener('input', handleInput);
		container.addEventListener('keydown', handleKeyDown);
		container.addEventListener('paste', handlePaste);
		container.addEventListener('dragstart', handleBlockDragStart);
		container.addEventListener('dragover', handleBlockDragOver);
		container.addEventListener('dragleave', handleBlockDragLeave);
		container.addEventListener('drop', handleBlockDrop);
		container.addEventListener('dragend', handleBlockDragEnd);
		document.addEventListener('selectionchange', updateCursorBlock);
	}

	container.addEventListener('click', handleEditorClick);

	// Comments
	if (shareKeyType === 'commenter' || shareKeyType === 'editor') {
		var commentsBtn = document.getElementById('shared-comments-btn');
		if (commentsBtn) {
			commentsBtn.addEventListener('click', toggleCommentsPanel);
		}
		document.addEventListener('mouseup', handleTextSelection);
		document.getElementById('comment-float-btn').addEventListener('mousedown', function(e) {
			e.preventDefault();
			createCommentFromSelection();
		});
	}

	var closeBtn = document.getElementById('close-comments-btn');
	if (closeBtn) {
		closeBtn.addEventListener('click', function() {
			document.getElementById('comments-panel').style.display = 'none';
		});
	}

	// Close menus
	document.addEventListener('mousedown', function(e) {
		var slash = document.getElementById('slash-menu');
		if (slash && slash.style.display !== 'none' && !slash.contains(e.target)) {
			hideSlashMenu();
		}
	});
	document.addEventListener('keydown', function(e) {
		if (e.key === 'Escape') {
			hideSlashMenu();
			document.getElementById('comment-float-btn').style.display = 'none';
		}
	});

	// beforeunload
	window.addEventListener('beforeunload', function() {
		if (autoSaveTimer && shareKeyType === 'editor') {
			clearTimeout(autoSaveTimer);
			autoSaveTimer = null;
			doSave();
		}
	});
}

function loadSharedPage() {
	return api('GET', '/api/shared/' + shareToken + '/page').then(function(data) {
		shareData = data;
		document.getElementById('shared-page-title').textContent = data.page.title;
		document.getElementById('shared-page-icon').textContent = data.page.icon || '📄';
		document.title = data.page.title;
		renderBlocks(data.blocks);
		renderComments();
		// Auto-open comments panel if page has comments
		if (data.comments && data.comments.length > 0) {
			var panel = document.getElementById('comments-panel');
			if (panel) panel.style.display = 'flex';
		}
	});
}

// ---- Blocks ----
function renderBlocks(blocks) {
	var container = document.getElementById('shared-blocks-container');
	container.innerHTML = '';

	if (!blocks || blocks.length === 0) {
		if (shareKeyType === 'editor') {
			var wrapper = createBlockEl({ id: generateId(), type: 'paragraph', content: '', properties: {} });
			container.appendChild(wrapper);
			ensureBR(wrapper.querySelector('.block-content'));
		}
		return;
	}

	var blockMap = {};
	blocks.forEach(function(b) { blockMap[b.id] = b; });

	blocks.forEach(function(block) {
		var wrapper = createBlockEl(block);
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
	var isEditor = shareKeyType === 'editor';

	// Handle (only for editor)
	if (isEditor) {
		var handle = document.createElement('div');
		handle.className = 'block-handle';
		handle.contentEditable = 'false';
		handle.draggable = true;
		handle.textContent = '⋮⋮';
		wrapper.appendChild(handle);
	}

	// Type-specific prefix
	if (block.type === 'todo') {
		var cb = document.createElement('input');
		cb.type = 'checkbox';
		cb.className = 'todo-checkbox';
		cb.contentEditable = 'false';
		cb.checked = !!(props.checked);
		if (!isEditor) cb.disabled = true;
		if (cb.checked) wrapper.classList.add('checked');
		cb.addEventListener('change', function() {
			wrapper.classList.toggle('checked', cb.checked);
			if (isEditor) scheduleAutoSave();
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
			var container = document.getElementById('shared-blocks-container');
			var allWrappers = Array.from(container.querySelectorAll('.block-wrapper'));
			var myId = wrapper.dataset.blockId;
			var children = allWrappers.filter(function(w) { return w.dataset.parentBlockId === myId; });
			if (isOpen && children.length === 0 && shareKeyType === 'editor') {
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
		if (!isEditor) langSelect.disabled = true;
		codeWrapper.appendChild(langSelect);

		var pre = document.createElement('pre');
		var code = document.createElement('code');
		code.contentEditable = isEditor ? 'true' : 'false';
		code.textContent = block.content || '';
		if (isEditor) {
			code.addEventListener('input', function() { scheduleAutoSave(); });
			code.addEventListener('keydown', function(e) {
				if (e.key === 'Tab') {
					e.preventDefault();
					document.execCommand('insertText', false, '  ');
				}
			});
		}
		pre.appendChild(code);
		codeWrapper.appendChild(pre);
		wrapper.appendChild(codeWrapper);
	} else if (block.type === 'image') {
		var imgDiv = document.createElement('div');
		imgDiv.className = 'block-content image-block';
		imgDiv.contentEditable = 'false';
		if (props.src) {
			var img = document.createElement('img');
			img.src = sharedUploadUrl(props.src);
			imgDiv.appendChild(img);
		} else if (isEditor) {
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
			fileDiv.innerHTML = '📎 <a href="' + escapeHtml(sharedUploadUrl(props.src)) + '" download="' + escapeHtml(props.filename || '') + '">' + escapeHtml(props.filename || block.content || 'Download') + '</a>';
		} else if (isEditor) {
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
		linkDiv.textContent = '📄 ' + (block.content || 'Unknown page');
		if (props.page_id) {
			linkDiv.addEventListener('click', function() {
				window.location.href = '/?page=' + props.page_id;
			});
		}
		wrapper.appendChild(linkDiv);
	} else if (block.type === 'table') {
		var tableDiv = document.createElement('div');
		tableDiv.className = 'block-content table-wrapper';
		tableDiv.contentEditable = 'false';
		var rows = props.rows || [['', ''], ['', '']];
		tableDiv.appendChild(createTableElement(rows, isEditor));
		if (isEditor) tableDiv.appendChild(createTableControls(tableDiv));
		wrapper.appendChild(tableDiv);
	} else if (block.type === 'math') {
		var mathDiv = document.createElement('div');
		mathDiv.className = 'block-content math-block';
		mathDiv.contentEditable = 'false';
		var preview = document.createElement('div');
		preview.className = 'math-preview';
		if (isEditor) {
			preview.addEventListener('click', function() {
				mathDiv.classList.add('editing');
				mathInput.focus();
			});
		}
		mathDiv.appendChild(preview);

		var mathInput = document.createElement('div');
		mathInput.className = 'math-input';
		mathInput.contentEditable = isEditor ? 'true' : 'false';
		mathInput.textContent = block.content || '';
		if (isEditor) {
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
		}
		mathDiv.appendChild(mathInput);
		wrapper.appendChild(mathDiv);
	} else {
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

function createTableElement(rows, editable) {
	var table = document.createElement('table');
	rows.forEach(function(row, ri) {
		var tr = document.createElement('tr');
		row.forEach(function(cell) {
			var td = document.createElement(ri === 0 ? 'th' : 'td');
			td.contentEditable = editable ? 'true' : 'false';
			td.textContent = cell;
			if (editable) td.addEventListener('input', function() { scheduleAutoSave(); });
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

// ---- Helpers ----
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
	while (node && node !== document.getElementById('shared-blocks-container')) {
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
	return wrapper ? wrapper.querySelector('.block-content') : null;
}

function generateId() {
	return 'b_' + Math.random().toString(36).substr(2, 12);
}

function escapeHtml(str) {
	var div = document.createElement('div');
	div.textContent = str;
	return div.innerHTML;
}

function setCursorToBlock(wrapper, atEnd) {
	var container = document.getElementById('shared-blocks-container');
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
					if (lastChild.nodeType === 3) range.setStart(lastChild, lastChild.textContent.length);
					else range.setStartAfter(lastChild);
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

function updateCursorBlock() {
	var allWrappers = document.querySelectorAll('#shared-blocks-container .block-wrapper');
	allWrappers.forEach(function(w) { w.classList.remove('has-cursor'); });
	var wrapper = getCurrentBlockWrapper();
	if (wrapper) {
		wrapper.classList.add('has-cursor');
		var content = getBlockContent(wrapper);
		if (content) ensureBR(content);
	}
}

// ---- Input handling (editor mode) ----
function handleInput(e) {
	var wrapper = getCurrentBlockWrapper();
	if (!wrapper) return;
	var type = wrapper.dataset.type;
	var content = getBlockContent(wrapper);
	if (content) ensureBR(content);

	// Markdown shortcuts
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
		if (/^---$/.test(text.trim())) {
			content.innerHTML = '<hr>';
			rebuildBlock(wrapper, 'divider');
			scheduleAutoSave();
			return;
		}
		if (/^```$/.test(text.trim())) {
			content.innerHTML = '';
			rebuildBlock(wrapper, 'code');
			scheduleAutoSave();
			return;
		}
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
}

function handleKeyDown(e) {
	if (e.ctrlKey || e.metaKey) {
		if (e.key === 'b') { e.preventDefault(); document.execCommand('bold'); return; }
		if (e.key === 'i') { e.preventDefault(); document.execCommand('italic'); return; }
		if (e.key === 'e') { e.preventDefault(); toggleInlineCode(); return; }
		if (e.key === 'X' && e.shiftKey) { e.preventDefault(); document.execCommand('strikeThrough'); return; }
	}

	var wrapper = getCurrentBlockWrapper();
	if (!wrapper) return;
	var type = wrapper.dataset.type;

	var slash = document.getElementById('slash-menu');
	if (slash && slash.style.display !== 'none') {
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

	if (e.key === 'Enter' && !e.shiftKey) {
		if (type === 'code' || type === 'math') return;
		if (type === 'divider' || type === 'image' || type === 'file' || type === 'page_link' || type === 'table') {
			e.preventDefault();
			insertBlockAfter(wrapper, 'paragraph', '');
			return;
		}
		e.preventDefault();
		var content = getBlockContent(wrapper);
		if (!content) return;

		if ((type === 'bullet_list' || type === 'numbered_list' || type === 'todo' || type === 'toggle') && content.textContent.trim() === '') {
			rebuildBlock(wrapper, 'paragraph');
			return;
		}

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
			var ti = wrapper.querySelector('.toggle-icon');
			if (ti && !ti.classList.contains('open')) {
				ti.classList.add('open');
			}
			var containerEl = document.getElementById('shared-blocks-container');
			var allWrappers = Array.from(containerEl.querySelectorAll('.block-wrapper'));
			var lastChild = wrapper;
			allWrappers.forEach(function(w) {
				if (w.dataset.parentBlockId === wrapper.dataset.blockId) lastChild = w;
			});
			if (lastChild !== wrapper) lastChild.after(childBlock);
			setCursorToBlock(childBlock, false);
			scheduleAutoSave();
			return;
		}

		var newType = (type === 'bullet_list' || type === 'numbered_list' || type === 'todo') ? type : 'paragraph';
		var newBlock = insertBlockAfter(wrapper, newType, afterHtml);
		if (wrapper.dataset.parentBlockId) {
			newBlock.dataset.parentBlockId = wrapper.dataset.parentBlockId;
			newBlock.dataset.depth = wrapper.dataset.depth || '0';
		}
		updateNumberedLists();
		return;
	}

	if (e.key === 'Backspace') {
		var content = getBlockContent(wrapper);
		if (!content) return;
		var sel = window.getSelection();
		if (sel.isCollapsed) {
			var range = sel.getRangeAt(0);
			var testRange = document.createRange();
			testRange.setStart(content, 0);
			testRange.setEnd(range.startContainer, range.startOffset);
			if (testRange.toString() === '') {
				e.preventDefault();
				if (type !== 'paragraph') {
					rebuildBlock(wrapper, 'paragraph');
				} else {
					var prev = wrapper.previousElementSibling;
					while (prev && prev.dataset.type === 'divider') prev = prev.previousElementSibling;
					if (prev) {
						var prevContent = getBlockContent(prev);
						if (prevContent && prevContent.contentEditable !== 'false') {
							var myHtml = cleanContent(content.innerHTML);
							setCursorToBlock(prev, true);
							if (myHtml) {
								setTimeout(function() {
									prevContent.innerHTML = DOMPurify.sanitize(cleanContent(prevContent.innerHTML) + myHtml);
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

	if (e.key === 'Tab') {
		if (type === 'bullet_list' || type === 'numbered_list' || type === 'todo') {
			e.preventDefault();
			if (e.shiftKey) outdentBlock(wrapper);
			else indentBlock(wrapper);
			scheduleAutoSave();
			return;
		}
	}
}

function handleEditorClick(e) {
	var link = e.target.closest('a[href]');
	if (link && !link.hasAttribute('data-page-link')) {
		e.preventDefault();
		window.open(link.href, '_blank');
		return;
	}
	var pageLink = e.target.closest('a[data-page-link]');
	if (pageLink) {
		e.preventDefault();
		window.location.href = '/?page=' + pageLink.dataset.pageLink;
		return;
	}
	var mark = e.target.closest('mark.comment-mark');
	if (mark) {
		var commentId = mark.dataset.commentId;
		openCommentsPanel();
		setTimeout(function() { highlightComment(commentId); }, 100);
		return;
	}
}

function handlePaste(e) {
	var wrapper = getCurrentBlockWrapper();
	if (!wrapper) return;
	if (wrapper.dataset.type === 'code') return;

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
	var block = { id: generateId(), type: type, content: content || '', properties: {} };
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
	wrapper.dataset.type = newType;

	var cb = wrapper.querySelector('.todo-checkbox');
	if (cb) cb.remove();
	var ti = wrapper.querySelector('.toggle-icon');
	if (ti) ti.remove();
	var numSpan = wrapper.querySelector('.list-number');
	if (numSpan) numSpan.remove();
	if (oldContent) oldContent.remove();

	var handle = wrapper.querySelector('.block-handle');
	var insertAfterEl = handle || wrapper.firstChild;

	if (newType === 'todo') {
		var newCb = document.createElement('input');
		newCb.type = 'checkbox';
		newCb.className = 'todo-checkbox';
		newCb.contentEditable = 'false';
		newCb.checked = !!checked;
		wrapper.classList.toggle('checked', !!checked);
		newCb.addEventListener('change', function() {
			wrapper.classList.toggle('checked', newCb.checked);
			scheduleAutoSave();
		});
		if (handle) handle.after(newCb);
		else wrapper.prepend(newCb);
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
			var container = document.getElementById('shared-blocks-container');
			var allWrappers = Array.from(container.querySelectorAll('.block-wrapper'));
			var myId = wrapper.dataset.blockId;
			var children = allWrappers.filter(function(w) { return w.dataset.parentBlockId === myId; });
			if (isOpen && children.length === 0 && shareKeyType === 'editor') {
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
		if (handle) handle.after(toggleIcon);
		else wrapper.prepend(toggleIcon);
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
		if (handle) handle.after(numSpan);
		else wrapper.prepend(numSpan);
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
	} else if (newType === 'table') {
		wrapper.classList.remove('checked');
		var tableDiv = document.createElement('div');
		tableDiv.className = 'block-content table-wrapper';
		tableDiv.contentEditable = 'false';
		tableDiv.appendChild(createTableElement([['Header 1', 'Header 2'], ['', '']], true));
		tableDiv.appendChild(createTableControls(tableDiv));
		wrapper.appendChild(tableDiv);
	} else {
		wrapper.classList.remove('checked');
		var content = document.createElement('div');
		content.className = 'block-content';
		content.innerHTML = DOMPurify.sanitize(oldHtml || '<br>');
		wrapper.appendChild(content);
		ensureBR(content);
		setCursorToBlock(wrapper, false);
	}
}

// ---- Indentation ----
function indentBlock(wrapper) {
	var container = document.getElementById('shared-blocks-container');
	var allWrappers = Array.from(container.querySelectorAll('.block-wrapper'));
	var idx = allWrappers.indexOf(wrapper);
	if (idx <= 0) return;
	var prevSibling = null;
	for (var i = idx - 1; i >= 0; i--) {
		if ((allWrappers[i].dataset.parentBlockId || '') === (wrapper.dataset.parentBlockId || '')) {
			prevSibling = allWrappers[i];
			break;
		}
	}
	if (!prevSibling) return;
	var currentDepth = parseInt(wrapper.dataset.depth || '0');
	if (currentDepth >= 4) return;
	wrapper.dataset.parentBlockId = prevSibling.dataset.blockId;
	wrapper.dataset.depth = currentDepth + 1;
	updateNumberedLists();
}

function outdentBlock(wrapper) {
	var parentId = wrapper.dataset.parentBlockId;
	if (!parentId) return;
	var container = document.getElementById('shared-blocks-container');
	var parentWrapper = container.querySelector('[data-block-id="' + parentId + '"]');
	if (!parentWrapper) return;
	wrapper.dataset.parentBlockId = parentWrapper.dataset.parentBlockId || '';
	if (!wrapper.dataset.parentBlockId) delete wrapper.dataset.parentBlockId;
	var newDepth = parseInt(wrapper.dataset.depth || '1') - 1;
	if (newDepth > 0) wrapper.dataset.depth = newDepth;
	else delete wrapper.dataset.depth;
	updateNumberedLists();
}

function updateNumberedLists() {
	var container = document.getElementById('shared-blocks-container');
	var allWrappers = Array.from(container.querySelectorAll('.block-wrapper'));
	var groups = {};
	allWrappers.forEach(function(w) {
		if (w.dataset.type !== 'numbered_list') return;
		var parentKey = w.dataset.parentBlockId || '__root__';
		if (!groups[parentKey]) groups[parentKey] = [];
		groups[parentKey].push(w);
	});
	Object.keys(groups).forEach(function(key) {
		var allSiblings = allWrappers.filter(function(w) {
			return (w.dataset.parentBlockId || '__root__') === key;
		});
		var count = 0;
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

// ---- Inline code toggle ----
function toggleInlineCode() {
	var sel = window.getSelection();
	if (sel.isCollapsed) return;
	var range = sel.getRangeAt(0);
	var container = range.commonAncestorContainer;
	var codeEl = null;
	var node = container;
	while (node && node !== document.getElementById('shared-blocks-container')) {
		if (node.nodeName === 'CODE' && node.classList && node.classList.contains('inline-code')) {
			codeEl = node;
			break;
		}
		node = node.parentNode;
	}
	if (codeEl) {
		var text = codeEl.textContent;
		var textNode = document.createTextNode(text);
		codeEl.parentNode.replaceChild(textNode, codeEl);
		var newRange = document.createRange();
		newRange.selectNodeContents(textNode);
		sel.removeAllRanges();
		sel.addRange(newRange);
	} else {
		var text = range.toString();
		var code = document.createElement('code');
		code.className = 'inline-code';
		range.deleteContents();
		code.textContent = text;
		range.insertNode(code);
		var newRange = document.createRange();
		newRange.selectNodeContents(code);
		sel.removeAllRanges();
		sel.addRange(newRange);
	}
	scheduleAutoSave();
}

// ---- Slash menu ----
function showSlashMenu() {
	var slash = document.getElementById('slash-menu');
	if (!slash) return;
	var items = SLASH_ITEMS.filter(function(item) {
		if (!slashQuery) return true;
		var q = slashQuery.toLowerCase();
		return item.label.toLowerCase().indexOf(q) !== -1 || item.keywords.toLowerCase().indexOf(q) !== -1;
	});
	if (items.length === 0) { slash.style.display = 'none'; return; }
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
	var sel = window.getSelection();
	if (sel.rangeCount > 0) {
		var rect = sel.getRangeAt(0).getBoundingClientRect();
		slash.style.left = rect.left + 'px';
		slash.style.top = (rect.bottom + 4) + 'px';
	}
	slash.style.display = 'block';
}

function hideSlashMenu() {
	var slash = document.getElementById('slash-menu');
	if (slash) slash.style.display = 'none';
	slashQuery = '';
	slashBlockId = null;
}

function navigateSlashMenu(dir) {
	var slash = document.getElementById('slash-menu');
	if (!slash) return;
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
	if (!slash) return;
	var active = slash.querySelector('.slash-item.active');
	if (!active) return;
	active.dispatchEvent(new MouseEvent('mousedown'));
}

function applySlashItem(item) {
	var blockId = slashBlockId;
	hideSlashMenu();
	var container = document.getElementById('shared-blocks-container');
	var wrapper = container.querySelector('[data-block-id="' + blockId + '"]');
	if (!wrapper) return;
	var content = getBlockContent(wrapper);
	if (content) content.innerHTML = '<br>';
	rebuildBlock(wrapper, item.type);
	scheduleAutoSave();
}

// ---- Block drag and drop ----
var draggedBlockId = null;

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
	document.querySelectorAll('.block-wrapper.drag-above, .block-wrapper.drag-below').forEach(function(w) {
		w.classList.remove('drag-above', 'drag-below');
	});
	var rect = wrapper.getBoundingClientRect();
	var mid = rect.top + rect.height / 2;
	if (e.clientY < mid) wrapper.classList.add('drag-above');
	else wrapper.classList.add('drag-below');
}

function handleBlockDragLeave(e) {
	var wrapper = getBlockWrapper(e.target);
	if (wrapper) wrapper.classList.remove('drag-above', 'drag-below');
}

function handleBlockDrop(e) {
	e.preventDefault();
	if (!draggedBlockId) return;
	var targetWrapper = getBlockWrapper(e.target);
	if (!targetWrapper || targetWrapper.dataset.blockId === draggedBlockId) return;
	var container = document.getElementById('shared-blocks-container');
	var draggedWrapper = container.querySelector('[data-block-id="' + draggedBlockId + '"]');
	if (!draggedWrapper) return;
	var rect = targetWrapper.getBoundingClientRect();
	var mid = rect.top + rect.height / 2;
	if (e.clientY < mid) targetWrapper.before(draggedWrapper);
	else targetWrapper.after(draggedWrapper);
	handleBlockDragEnd();
	scheduleAutoSave();
}

function handleBlockDragEnd() {
	if (draggedBlockId) {
		var container = document.getElementById('shared-blocks-container');
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
		api('POST', '/api/shared/' + shareToken + '/upload', form).then(function(result) {
			var imgDiv = wrapper.querySelector('.image-block');
			imgDiv.innerHTML = '';
			var img = document.createElement('img');
			img.src = sharedUploadUrl(result.src);
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
		api('POST', '/api/shared/' + shareToken + '/upload', form).then(function(result) {
			var fileDiv = wrapper.querySelector('.file-block');
			fileDiv.innerHTML = '📎 <a href="' + escapeHtml(sharedUploadUrl(result.src)) + '" download="' + escapeHtml(result.filename) + '">' + escapeHtml(result.filename) + '</a>';
			wrapper.querySelector('.block-content').dataset.src = result.src;
			wrapper.querySelector('.block-content').dataset.filename = result.filename;
			scheduleAutoSave();
		});
	});
	input.click();
}

// ---- Auto-save ----
function scheduleAutoSave() {
	if (shareKeyType !== 'editor') return;
	if (autoSaveTimer) clearTimeout(autoSaveTimer);
	autoSaveTimer = setTimeout(function() {
		autoSaveTimer = null;
		doSave();
	}, 1000);
}

function doSave() {
	var blocks = collectBlocks();
	api('PUT', '/api/shared/' + shareToken + '/blocks', blocks).then(function(page) {
		if (page && page.updated_at && shareData) {
			shareData.page.updated_at = page.updated_at;
		}
	});
}

function collectBlocks() {
	var container = document.getElementById('shared-blocks-container');
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
			if (properties.src && properties.src.indexOf('/uploads/') !== -1) {
				properties.src = cleanUploadPath(properties.src);
			}
		} else if (type === 'file') {
			var link = wrapper.querySelector('.file-block a');
			if (link) {
				content = link.textContent;
				properties.src = cleanUploadPath(link.getAttribute('href') || '');
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
					Array.from(tr.cells).forEach(function(td) { row.push(td.textContent); });
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
	renderComments();
}

function toggleCommentsPanel() {
	var panel = document.getElementById('comments-panel');
	if (panel.style.display !== 'none') {
		panel.style.display = 'none';
	} else {
		openCommentsPanel();
	}
}

function renderComments() {
	var list = document.getElementById('comments-list');
	if (!list) return;
	list.innerHTML = '';

	var comments = shareData ? shareData.comments : [];
	var threads = [];
	var threadMap = {};

	comments.forEach(function(c) {
		if (!c.parent_comment_id) {
			var thread = { comment: c, replies: [] };
			threads.push(thread);
			threadMap[c.id] = thread;
		}
	});
	comments.forEach(function(c) {
		if (c.parent_comment_id && threadMap[c.parent_comment_id]) {
			threadMap[c.parent_comment_id].replies.push(c);
		}
	});

	if (threads.length === 0) {
		list.innerHTML = '<p style="color:#bbb;text-align:center;padding:20px;font-size:12px">No comments yet.</p>';
		return;
	}

	// Sort by block position in document
	var container = document.getElementById('shared-blocks-container');
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

		threadDiv.appendChild(createCommentItem(thread.comment, true));
		thread.replies.forEach(function(reply) {
			threadDiv.appendChild(createCommentItem(reply, false));
		});

		// Reply form (only if can comment)
		if (shareKeyType === 'commenter' || shareKeyType === 'editor') {
			var replyForm = document.createElement('div');
			replyForm.className = 'comment-reply-form';
			var textarea = document.createElement('textarea');
			textarea.placeholder = 'Reply...';
			replyForm.appendChild(textarea);
			var submitBtn = document.createElement('button');
			submitBtn.textContent = 'Reply';
			submitBtn.addEventListener('click', function() {
				if (!textarea.value.trim()) return;
				api('POST', '/api/shared/' + shareToken + '/comments', {
					parent_comment_id: thread.comment.id,
					content: textarea.value.trim()
				}).then(function() {
					loadSharedPage();
				});
			});
			replyForm.appendChild(submitBtn);
			threadDiv.appendChild(replyForm);
		}

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
		div.appendChild(quote);
	}

	var text = document.createElement('div');
	text.className = 'comment-text';
	text.textContent = comment.content;
	div.appendChild(text);

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

		var range = sel.getRangeAt(0);
		var container = document.getElementById('shared-blocks-container');
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

	document.getElementById('comment-float-btn').style.display = 'none';

	var wrapper = getBlockWrapper(range.commonAncestorContainer);
	var blockId = wrapper ? wrapper.dataset.blockId : null;

	// Show comments panel and insert inline form
	document.getElementById('comments-panel').style.display = 'flex';
	renderComments();

	var list = document.getElementById('comments-list');
	var existing = list.querySelector('.new-comment-form');
	if (existing) existing.remove();
	var formDiv = document.createElement('div');
	formDiv.className = 'comment-thread new-comment-form';
	formDiv.innerHTML = '<div style="font-size:12px;color:#999;margin-bottom:4px;padding:8px 10px 0">Commenting on: <em>"' + escapeHtml(text.substring(0, 50)) + (text.length > 50 ? '...' : '') + '"</em></div>';
	var textarea = document.createElement('textarea');
	textarea.placeholder = 'Write a comment...';
	textarea.style.cssText = 'width:calc(100% - 20px);min-height:60px;margin:6px 10px;padding:6px;border:1px solid #ddd;border-radius:4px;font-size:13px;resize:vertical;';
	formDiv.appendChild(textarea);
	var btnRow = document.createElement('div');
	btnRow.style.cssText = 'display:flex;gap:6px;justify-content:flex-end;padding:0 10px 8px;';
	var cancelBtn = document.createElement('button');
	cancelBtn.textContent = 'Cancel';
	cancelBtn.style.cssText = 'padding:4px 10px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer;font-size:12px;';
	cancelBtn.addEventListener('click', function() { formDiv.remove(); });
	var submitBtn = document.createElement('button');
	submitBtn.textContent = 'Comment';
	submitBtn.style.cssText = 'padding:4px 10px;border:none;border-radius:4px;background:#2eaadc;color:#fff;cursor:pointer;font-size:12px;';
	submitBtn.addEventListener('click', function() {
		var commentText = textarea.value.trim();
		if (!commentText) return;
		formDiv.remove();
		api('POST', '/api/shared/' + shareToken + '/comments', {
			block_id: blockId,
			highlighted_text: text,
			content: commentText
		}).then(function() {
			loadSharedPage();
		});
	});
	btnRow.appendChild(cancelBtn);
	btnRow.appendChild(submitBtn);
	formDiv.appendChild(btnRow);
	list.insertBefore(formDiv, list.firstChild);
	textarea.focus();
}

function applyCommentHighlights() {
	if (!shareData) return;
	shareData.comments.forEach(function(c) {
		if (c.highlighted_text) {
			var container = document.getElementById('shared-blocks-container');
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

// ---- Code highlighting ----
function highlightCodeBlocks() {
	if (typeof hljs === 'undefined') return;
	var currentWrapper = getCurrentBlockWrapper();
	var currentBlockId = currentWrapper ? currentWrapper.dataset.blockId : null;

	document.querySelectorAll('#shared-blocks-container .code-block-wrapper code').forEach(function(code) {
		var wrapper = getBlockWrapper(code);
		if (shareKeyType === 'editor' && wrapper && wrapper.dataset.blockId === currentBlockId) return;

		var lang = wrapper ? wrapper.querySelector('.code-language') : null;
		var langVal = lang ? lang.value : '';
		var text = code.innerText;
		if (!text.trim()) return;

		try {
			var result = langVal
				? hljs.highlight(text, { language: langVal })
				: hljs.highlightAuto(text);
			code.innerHTML = result.value;
		} catch (e) { /* keep plain text */ }
	});
}

// ---- Math rendering ----
function renderMathBlocks() {
	document.querySelectorAll('#shared-blocks-container .math-block').forEach(function(mathDiv) {
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
		if (autoSaveTimer) return; // Skip if pending save
		if (shareKeyType === 'editor') {
			var container = document.getElementById('shared-blocks-container');
			if (document.activeElement && (document.activeElement === container || container.contains(document.activeElement))) return;
		}

		api('GET', '/api/shared/' + shareToken + '/page').then(function(data) {
			if (!shareData) return;
			// Update comments always
			shareData.comments = data.comments;
			shareData.page = data.page;
			renderComments();

			// For non-editor modes, re-render blocks too
			if (shareKeyType !== 'editor') {
				if (data.page.updated_at !== shareData.page.updated_at) {
					shareData.blocks = data.blocks;
					renderBlocks(data.blocks);
				}
			}

			document.getElementById('shared-page-title').textContent = data.page.title;
			document.getElementById('shared-page-icon').textContent = data.page.icon || '📄';
			document.title = data.page.title;
		}).catch(function() {});
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
