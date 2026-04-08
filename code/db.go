package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
)

func generateID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func generateToken() string {
	b := make([]byte, 24)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func initSchema(db *sql.DB) error {
	schema := `
	CREATE TABLE IF NOT EXISTS pages (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL DEFAULT 'Untitled',
		icon TEXT DEFAULT '',
		cover_image TEXT DEFAULT '',
		parent_id TEXT REFERENCES pages(id) ON DELETE CASCADE,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE IF NOT EXISTS blocks (
		id TEXT PRIMARY KEY,
		page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
		type TEXT NOT NULL DEFAULT 'paragraph',
		content TEXT DEFAULT '',
		properties TEXT DEFAULT '{}',
		position INTEGER NOT NULL DEFAULT 0,
		parent_block_id TEXT REFERENCES blocks(id) ON DELETE CASCADE,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX IF NOT EXISTS idx_blocks_page ON blocks(page_id, position);
	CREATE INDEX IF NOT EXISTS idx_blocks_parent ON blocks(parent_block_id);
	CREATE TABLE IF NOT EXISTS shares (
		id TEXT PRIMARY KEY,
		page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
		alias TEXT NOT NULL,
		token TEXT NOT NULL UNIQUE,
		can_comment INTEGER DEFAULT 1,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX IF NOT EXISTS idx_shares_token ON shares(token);
	CREATE INDEX IF NOT EXISTS idx_shares_page ON shares(page_id);
	CREATE TABLE IF NOT EXISTS comments (
		id TEXT PRIMARY KEY,
		page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
		block_id TEXT REFERENCES blocks(id) ON DELETE SET NULL,
		share_id TEXT REFERENCES shares(id) ON DELETE CASCADE,
		author_type TEXT NOT NULL DEFAULT 'share',
		highlighted_text TEXT DEFAULT '',
		parent_comment_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
		resolved INTEGER DEFAULT 0,
		content TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX IF NOT EXISTS idx_comments_page ON comments(page_id);
	CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_comment_id);
	`
	_, err := db.Exec(schema)
	return err
}

// Pages

func dbListPages() ([]Page, error) {
	rows, err := db.Query("SELECT id, title, icon, cover_image, parent_id, created_at, updated_at FROM pages ORDER BY updated_at DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var pages []Page
	for rows.Next() {
		var p Page
		if err := rows.Scan(&p.ID, &p.Title, &p.Icon, &p.CoverImage, &p.ParentID, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		pages = append(pages, p)
	}
	return pages, nil
}

func dbGetPage(id string) (*Page, error) {
	var p Page
	err := db.QueryRow("SELECT id, title, icon, cover_image, parent_id, created_at, updated_at FROM pages WHERE id = ?", id).
		Scan(&p.ID, &p.Title, &p.Icon, &p.CoverImage, &p.ParentID, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func dbCreatePage(title, icon string) (*Page, error) {
	id := generateID()
	if title == "" {
		title = "Untitled"
	}
	_, err := db.Exec("INSERT INTO pages (id, title, icon) VALUES (?, ?, ?)", id, title, icon)
	if err != nil {
		return nil, err
	}
	return dbGetPage(id)
}

func dbUpdatePage(id, title, icon, coverImage string) error {
	_, err := db.Exec("UPDATE pages SET title = ?, icon = ?, cover_image = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
		title, icon, coverImage, id)
	return err
}

func dbDeletePage(id string) error {
	_, err := db.Exec("DELETE FROM pages WHERE id = ?", id)
	return err
}

// Blocks

func dbGetBlocks(pageID string) ([]Block, error) {
	rows, err := db.Query("SELECT id, page_id, type, content, properties, position, parent_block_id, created_at, updated_at FROM blocks WHERE page_id = ? ORDER BY position", pageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var all []Block
	for rows.Next() {
		var b Block
		if err := rows.Scan(&b.ID, &b.PageID, &b.Type, &b.Content, &b.Properties, &b.Position, &b.ParentBlockID, &b.CreatedAt, &b.UpdatedAt); err != nil {
			return nil, err
		}
		all = append(all, b)
	}

	// Organize: top-level first, then children right after their parent
	var topLevel []Block
	children := make(map[string][]Block)
	for _, b := range all {
		if b.ParentBlockID == nil {
			topLevel = append(topLevel, b)
		} else {
			children[*b.ParentBlockID] = append(children[*b.ParentBlockID], b)
		}
	}

	var result []Block
	for _, b := range topLevel {
		result = append(result, b)
		if kids, ok := children[b.ID]; ok {
			result = append(result, kids...)
		}
	}
	return result, nil
}

func dbSaveBlocks(pageID string, inputs []BlockInput) ([]Block, error) {
	tx, err := db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	// Delete existing blocks (comments.block_id will be SET NULL)
	if _, err := tx.Exec("DELETE FROM blocks WHERE page_id = ?", pageID); err != nil {
		return nil, fmt.Errorf("delete blocks: %w", err)
	}

	// Generate new IDs and build mapping
	idMap := make(map[string]string)
	for _, b := range inputs {
		if b.ClientID != "" {
			idMap[b.ClientID] = generateID()
		}
	}

	// Insert top-level blocks first (no parent)
	for _, b := range inputs {
		if b.ParentClientID != "" {
			continue
		}
		newID := idMap[b.ClientID]
		if newID == "" {
			newID = generateID()
		}
		if _, err := tx.Exec(
			"INSERT INTO blocks (id, page_id, type, content, properties, position) VALUES (?,?,?,?,?,?)",
			newID, pageID, b.Type, b.Content, b.Properties, b.Position,
		); err != nil {
			return nil, fmt.Errorf("insert block: %w", err)
		}
	}

	// Insert child blocks
	for _, b := range inputs {
		if b.ParentClientID == "" {
			continue
		}
		newID := idMap[b.ClientID]
		if newID == "" {
			newID = generateID()
		}
		parentID := idMap[b.ParentClientID]
		if parentID == "" {
			continue // skip orphans
		}
		if _, err := tx.Exec(
			"INSERT INTO blocks (id, page_id, type, content, properties, position, parent_block_id) VALUES (?,?,?,?,?,?,?)",
			newID, pageID, b.Type, b.Content, b.Properties, b.Position, parentID,
		); err != nil {
			return nil, fmt.Errorf("insert child block: %w", err)
		}
	}

	// Update page timestamp
	if _, err := tx.Exec("UPDATE pages SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", pageID); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return dbGetBlocks(pageID)
}

// Comments

func dbGetComments(pageID string) ([]Comment, error) {
	rows, err := db.Query(`
		SELECT c.id, c.page_id, c.block_id, c.share_id, c.author_type, c.highlighted_text,
			c.parent_comment_id, c.resolved, c.content, c.created_at,
			COALESCE(s.alias, 'Admin') as author_name
		FROM comments c
		LEFT JOIN shares s ON c.share_id = s.id
		WHERE c.page_id = ?
		ORDER BY c.created_at ASC`, pageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var comments []Comment
	for rows.Next() {
		var c Comment
		if err := rows.Scan(&c.ID, &c.PageID, &c.BlockID, &c.ShareID, &c.AuthorType,
			&c.HighlightedText, &c.ParentCommentID, &c.Resolved, &c.Content,
			&c.CreatedAt, &c.AuthorName); err != nil {
			return nil, err
		}
		comments = append(comments, c)
	}
	return comments, nil
}

func dbCreateComment(pageID string, blockID *string, shareID *string, authorType, highlightedText, content string, parentCommentID *string) (*Comment, error) {
	id := generateID()
	_, err := db.Exec(`
		INSERT INTO comments (id, page_id, block_id, share_id, author_type, highlighted_text, content, parent_comment_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		id, pageID, blockID, shareID, authorType, highlightedText, content, parentCommentID)
	if err != nil {
		return nil, err
	}

	var c Comment
	err = db.QueryRow(`
		SELECT c.id, c.page_id, c.block_id, c.share_id, c.author_type, c.highlighted_text,
			c.parent_comment_id, c.resolved, c.content, c.created_at,
			COALESCE(s.alias, 'Admin') as author_name
		FROM comments c
		LEFT JOIN shares s ON c.share_id = s.id
		WHERE c.id = ?`, id).
		Scan(&c.ID, &c.PageID, &c.BlockID, &c.ShareID, &c.AuthorType,
			&c.HighlightedText, &c.ParentCommentID, &c.Resolved, &c.Content,
			&c.CreatedAt, &c.AuthorName)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func dbResolveComment(id string) error {
	_, err := db.Exec("UPDATE comments SET resolved = 1 WHERE id = ?", id)
	return err
}

// Shares

func dbGetShares(pageID string) ([]Share, error) {
	rows, err := db.Query("SELECT id, page_id, alias, token, can_comment, created_at FROM shares WHERE page_id = ?", pageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var shares []Share
	for rows.Next() {
		var s Share
		if err := rows.Scan(&s.ID, &s.PageID, &s.Alias, &s.Token, &s.CanComment, &s.CreatedAt); err != nil {
			return nil, err
		}
		shares = append(shares, s)
	}
	return shares, nil
}

func dbCreateShare(pageID, alias string, canComment int) (*Share, error) {
	id := generateID()
	token := generateToken()
	_, err := db.Exec("INSERT INTO shares (id, page_id, alias, token, can_comment) VALUES (?, ?, ?, ?, ?)",
		id, pageID, alias, token, canComment)
	if err != nil {
		return nil, err
	}
	var s Share
	err = db.QueryRow("SELECT id, page_id, alias, token, can_comment, created_at FROM shares WHERE id = ?", id).
		Scan(&s.ID, &s.PageID, &s.Alias, &s.Token, &s.CanComment, &s.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func dbDeleteShare(id string) error {
	_, err := db.Exec("DELETE FROM shares WHERE id = ?", id)
	return err
}

func dbGetShareByToken(token string) (*Share, error) {
	var s Share
	err := db.QueryRow("SELECT id, page_id, alias, token, can_comment, created_at FROM shares WHERE token = ?", token).
		Scan(&s.ID, &s.PageID, &s.Alias, &s.Token, &s.CanComment, &s.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &s, nil
}
