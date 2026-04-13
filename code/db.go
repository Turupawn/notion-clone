package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

type App struct {
	db        *sql.DB
	adminKey  string
	uploadDir string
}

type Page struct {
	ID        string  `json:"id"`
	Title     string  `json:"title"`
	Icon      string  `json:"icon"`
	CoverImg  string  `json:"cover_image"`
	ParentID  *string `json:"parent_id"`
	CreatedAt string  `json:"created_at"`
	UpdatedAt string  `json:"updated_at"`
	Position  int     `json:"position"`
}

type Block struct {
	ID            string          `json:"id"`
	PageID        string          `json:"page_id"`
	Type          string          `json:"type"`
	Content       string          `json:"content"`
	Properties    json.RawMessage `json:"properties"`
	Position      int             `json:"position"`
	ParentBlockID *string         `json:"parent_block_id"`
	CreatedAt     string          `json:"created_at"`
	UpdatedAt     string          `json:"updated_at"`
}

type Share struct {
	ID        string  `json:"id"`
	PageID    string  `json:"page_id"`
	Alias     string  `json:"alias"`
	Token     string  `json:"token"`
	KeyType   string  `json:"key_type"`
	CreatedAt string  `json:"created_at"`
	ExpiresAt *string `json:"expires_at"`
}

type Comment struct {
	ID              string  `json:"id"`
	PageID          string  `json:"page_id"`
	BlockID         *string `json:"block_id"`
	ShareID         *string `json:"share_id"`
	AuthorType      string  `json:"author_type"`
	HighlightedText string  `json:"highlighted_text"`
	ParentCommentID *string `json:"parent_comment_id"`
	Resolved        int     `json:"resolved"`
	Content         string  `json:"content"`
	CreatedAt       string  `json:"created_at"`
	Author          string  `json:"author"`
}

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

func initDB(path string) *sql.DB {
	db, err := sql.Open("sqlite3", path+"?_busy_timeout=5000&_journal_mode=WAL&_foreign_keys=on")
	if err != nil {
		log.Fatal(err)
	}
	db.SetMaxOpenConns(1)

	// Create tables if they don't exist
	schema := `
	CREATE TABLE IF NOT EXISTS pages (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL DEFAULT 'Untitled',
		icon TEXT DEFAULT '',
		cover_image TEXT DEFAULT '',
		parent_id TEXT REFERENCES pages(id) ON DELETE CASCADE,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		position INTEGER NOT NULL DEFAULT 0
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
		key_type TEXT NOT NULL DEFAULT 'viewer',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		expires_at DATETIME
	);
	CREATE INDEX IF NOT EXISTS idx_shares_token ON shares(token);
	CREATE INDEX IF NOT EXISTS idx_shares_page ON shares(page_id);
	CREATE TABLE IF NOT EXISTS files (
		filename TEXT PRIMARY KEY,
		page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
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
	_, err = db.Exec(schema)
	if err != nil {
		log.Fatal(err)
	}
	return db
}

// ---- Page operations ----

func (a *App) listPages() ([]Page, error) {
	rows, err := a.db.Query("SELECT id, title, icon, cover_image, parent_id, created_at, updated_at, position FROM pages ORDER BY position ASC, updated_at DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var pages []Page
	for rows.Next() {
		var p Page
		err := rows.Scan(&p.ID, &p.Title, &p.Icon, &p.CoverImg, &p.ParentID, &p.CreatedAt, &p.UpdatedAt, &p.Position)
		if err != nil {
			return nil, err
		}
		pages = append(pages, p)
	}
	return pages, nil
}

func (a *App) getPage(id string) (*Page, error) {
	var p Page
	err := a.db.QueryRow("SELECT id, title, icon, cover_image, parent_id, created_at, updated_at, position FROM pages WHERE id = ?", id).
		Scan(&p.ID, &p.Title, &p.Icon, &p.CoverImg, &p.ParentID, &p.CreatedAt, &p.UpdatedAt, &p.Position)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (a *App) createPage(title string, parentID *string, icon string) (*Page, error) {
	id := generateID()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	// Get max position for siblings
	var maxPos int
	if parentID != nil {
		a.db.QueryRow("SELECT COALESCE(MAX(position), -1) FROM pages WHERE parent_id = ?", *parentID).Scan(&maxPos)
	} else {
		a.db.QueryRow("SELECT COALESCE(MAX(position), -1) FROM pages WHERE parent_id IS NULL").Scan(&maxPos)
	}

	_, err := a.db.Exec("INSERT INTO pages (id, title, icon, parent_id, created_at, updated_at, position) VALUES (?, ?, ?, ?, ?, ?, ?)",
		id, title, icon, parentID, now, now, maxPos+1)
	if err != nil {
		return nil, err
	}

	return a.getPage(id)
}

func (a *App) updatePage(id, title, icon string) error {
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	_, err := a.db.Exec("UPDATE pages SET title = ?, icon = ?, updated_at = ? WHERE id = ?", title, icon, now, id)
	return err
}

func (a *App) deletePage(id string) error {
	_, err := a.db.Exec("DELETE FROM pages WHERE id = ?", id)
	return err
}

func (a *App) movePage(id string, parentID *string, position int) error {
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	_, err := a.db.Exec("UPDATE pages SET parent_id = ?, position = ?, updated_at = ? WHERE id = ?", parentID, position, now, id)
	if err != nil {
		return err
	}
	// Reorder siblings
	var siblings []string
	var rows *sql.Rows
	if parentID != nil {
		rows, err = a.db.Query("SELECT id FROM pages WHERE parent_id = ? AND id != ? ORDER BY position ASC, updated_at DESC", *parentID, id)
	} else {
		rows, err = a.db.Query("SELECT id FROM pages WHERE parent_id IS NULL AND id != ? ORDER BY position ASC, updated_at DESC", id)
	}
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var sid string
		rows.Scan(&sid)
		siblings = append(siblings, sid)
	}

	// Insert the moved page at the right position
	result := make([]string, 0, len(siblings)+1)
	inserted := false
	for i, sid := range siblings {
		if i == position && !inserted {
			result = append(result, id)
			inserted = true
		}
		result = append(result, sid)
	}
	if !inserted {
		result = append(result, id)
	}

	for i, sid := range result {
		a.db.Exec("UPDATE pages SET position = ? WHERE id = ?", i, sid)
	}
	return nil
}

// ---- Block operations ----

func (a *App) getBlocks(pageID string) ([]Block, error) {
	rows, err := a.db.Query("SELECT id, page_id, type, content, properties, position, parent_block_id, created_at, updated_at FROM blocks WHERE page_id = ? ORDER BY position ASC", pageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var blocks []Block
	for rows.Next() {
		var b Block
		var props string
		err := rows.Scan(&b.ID, &b.PageID, &b.Type, &b.Content, &props, &b.Position, &b.ParentBlockID, &b.CreatedAt, &b.UpdatedAt)
		if err != nil {
			return nil, err
		}
		b.Properties = json.RawMessage(props)
		blocks = append(blocks, b)
	}
	return blocks, nil
}

func (a *App) saveBlocks(pageID string, blocks []Block) error {
	tx, err := a.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Delete existing blocks
	_, err = tx.Exec("DELETE FROM blocks WHERE page_id = ?", pageID)
	if err != nil {
		return err
	}

	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	// Build old-to-new ID mapping and insert parents first
	idMap := make(map[string]string)
	for i := range blocks {
		newID := generateID()
		if blocks[i].ID != "" {
			idMap[blocks[i].ID] = newID
		}
		blocks[i].ID = newID
	}

	// Insert blocks: parents first (those without parent_block_id), then children
	// Two passes: first pass inserts blocks without parents, second pass inserts children
	stmt, err := tx.Prepare("INSERT INTO blocks (id, page_id, type, content, properties, position, parent_block_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
	if err != nil {
		return err
	}
	defer stmt.Close()

	// First pass: blocks without parent
	for i, b := range blocks {
		if b.ParentBlockID != nil {
			continue
		}
		props := string(b.Properties)
		if props == "" {
			props = "{}"
		}
		_, err = stmt.Exec(b.ID, pageID, b.Type, b.Content, props, i, nil, now, now)
		if err != nil {
			return fmt.Errorf("inserting block %s: %w", b.ID, err)
		}
	}

	// Second pass: blocks with parent (remap parent IDs)
	for i, b := range blocks {
		if b.ParentBlockID == nil {
			continue
		}
		newParent, ok := idMap[*b.ParentBlockID]
		if !ok {
			newParent = *b.ParentBlockID // fallback
		}
		props := string(b.Properties)
		if props == "" {
			props = "{}"
		}
		_, err = stmt.Exec(b.ID, pageID, b.Type, b.Content, props, i, newParent, now, now)
		if err != nil {
			return fmt.Errorf("inserting child block %s: %w", b.ID, err)
		}
	}

	// Update page updated_at
	_, err = tx.Exec("UPDATE pages SET updated_at = ? WHERE id = ?", now, pageID)
	if err != nil {
		return err
	}

	return tx.Commit()
}

// ---- Share operations ----

func (a *App) listShares(pageID string) ([]Share, error) {
	rows, err := a.db.Query("SELECT id, page_id, alias, token, key_type, created_at, expires_at FROM shares WHERE page_id = ?", pageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var shares []Share
	for rows.Next() {
		var s Share
		err := rows.Scan(&s.ID, &s.PageID, &s.Alias, &s.Token, &s.KeyType, &s.CreatedAt, &s.ExpiresAt)
		if err != nil {
			return nil, err
		}
		shares = append(shares, s)
	}
	return shares, nil
}

func (a *App) getShareByToken(token string) (*Share, error) {
	var s Share
	err := a.db.QueryRow("SELECT id, page_id, alias, token, key_type, created_at, expires_at FROM shares WHERE token = ? AND expires_at > datetime('now')", token).
		Scan(&s.ID, &s.PageID, &s.Alias, &s.Token, &s.KeyType, &s.CreatedAt, &s.ExpiresAt)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func (a *App) createShare(pageID, alias, keyType string) (*Share, error) {
	id := generateID()
	token := generateToken()
	expiresAt := time.Now().UTC().Add(30 * 24 * time.Hour).Format("2006-01-02 15:04:05")
	_, err := a.db.Exec("INSERT INTO shares (id, page_id, alias, token, key_type, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
		id, pageID, alias, token, keyType, expiresAt)
	if err != nil {
		return nil, err
	}
	return a.getShareByToken(token)
}

func (a *App) deleteShare(id string) error {
	_, err := a.db.Exec("DELETE FROM shares WHERE id = ?", id)
	return err
}

// ---- Comment operations ----

func (a *App) getComments(pageID string) ([]Comment, error) {
	rows, err := a.db.Query(`
		SELECT c.id, c.page_id, c.block_id, c.share_id, c.author_type, c.highlighted_text,
			c.parent_comment_id, c.resolved, c.content, c.created_at,
			COALESCE(s.alias, 'Admin') as author
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
		err := rows.Scan(&c.ID, &c.PageID, &c.BlockID, &c.ShareID, &c.AuthorType, &c.HighlightedText,
			&c.ParentCommentID, &c.Resolved, &c.Content, &c.CreatedAt, &c.Author)
		if err != nil {
			return nil, err
		}
		comments = append(comments, c)
	}
	return comments, nil
}

func (a *App) createComment(pageID string, blockID, shareID, parentCommentID *string, authorType, highlightedText, content string) (*Comment, error) {
	id := generateID()
	now := time.Now().UTC().Format("2006-01-02 15:04:05")

	// Verify block_id exists if provided
	if blockID != nil && *blockID != "" {
		var exists int
		err := a.db.QueryRow("SELECT COUNT(*) FROM blocks WHERE id = ?", *blockID).Scan(&exists)
		if err != nil || exists == 0 {
			blockID = nil
		}
	}

	_, err := a.db.Exec(`INSERT INTO comments (id, page_id, block_id, share_id, author_type, highlighted_text, parent_comment_id, content, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, pageID, blockID, shareID, authorType, highlightedText, parentCommentID, content, now)
	if err != nil {
		return nil, err
	}

	// Update page updated_at
	a.db.Exec("UPDATE pages SET updated_at = ? WHERE id = ?", now, pageID)

	var c Comment
	err = a.db.QueryRow(`
		SELECT c.id, c.page_id, c.block_id, c.share_id, c.author_type, c.highlighted_text,
			c.parent_comment_id, c.resolved, c.content, c.created_at,
			COALESCE(s.alias, 'Admin') as author
		FROM comments c LEFT JOIN shares s ON c.share_id = s.id WHERE c.id = ?`, id).
		Scan(&c.ID, &c.PageID, &c.BlockID, &c.ShareID, &c.AuthorType, &c.HighlightedText,
			&c.ParentCommentID, &c.Resolved, &c.Content, &c.CreatedAt, &c.Author)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (a *App) resolveComment(id string) error {
	_, err := a.db.Exec("UPDATE comments SET resolved = 1 WHERE id = ? OR parent_comment_id = ?", id, id)
	return err
}

func (a *App) insertFile(filename, pageID string) error {
	_, err := a.db.Exec("INSERT OR REPLACE INTO files (filename, page_id) VALUES (?, ?)", filename, pageID)
	return err
}

func (a *App) fileExistsForPage(filename, pageID string) bool {
	var count int
	a.db.QueryRow("SELECT COUNT(*) FROM files WHERE filename = ? AND page_id = ?", filename, pageID).Scan(&count)
	return count > 0
}

