package main

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ---- Auth middleware ----

func (a *App) isAdmin(r *http.Request) bool {
	key := r.Header.Get("X-Admin-Key")
	if key == "" {
		cookie, err := r.Cookie("admin_key")
		if err == nil {
			key = cookie.Value
		}
	}
	if len(key) == 0 {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(key), []byte(a.adminKey)) == 1
}

func (a *App) adminAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !a.isAdmin(r) {
			if r.URL.Path == "/" {
				a.serveLoginPage(w)
				return
			}
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

func (a *App) handleLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Key string `json:"key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"bad request"}`, http.StatusBadRequest)
		return
	}
	if subtle.ConstantTimeCompare([]byte(body.Key), []byte(a.adminKey)) != 1 {
		http.Error(w, `{"error":"invalid key"}`, http.StatusUnauthorized)
		return
	}
	secure := r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
	http.SetCookie(w, &http.Cookie{
		Name:     "admin_key",
		Value:    body.Key,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   86400 * 365,
	})
	writeJSON(w, map[string]string{"status": "ok"})
}

// ---- HTML pages ----

func (a *App) handleAdminPage(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	a.serveAdminPage(w)
}

func (a *App) handleSharedPage(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	share, err := a.getShareByToken(token)
	if err != nil {
		http.Error(w, "Share not found", http.StatusNotFound)
		return
	}
	page, err := a.getPage(share.PageID)
	if err != nil {
		http.Error(w, "Page not found", http.StatusNotFound)
		return
	}
	a.serveSharedPage(w, page, share)
}

// ---- API: Pages ----

func (a *App) handleListPages(w http.ResponseWriter, r *http.Request) {
	pages, err := a.listPages()
	if err != nil {
		serverError(w, err)
		return
	}
	if pages == nil {
		pages = []Page{}
	}
	writeJSON(w, pages)
}

func (a *App) handleCreatePage(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title    string  `json:"title"`
		ParentID *string `json:"parent_id"`
		Icon     string  `json:"icon"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"bad request"}`, http.StatusBadRequest)
		return
	}
	if body.Title == "" {
		body.Title = "Untitled"
	}
	page, err := a.createPage(body.Title, body.ParentID, body.Icon)
	if err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, page)
}

func (a *App) handleUpdatePage(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		Title string `json:"title"`
		Icon  string `json:"icon"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"bad request"}`, http.StatusBadRequest)
		return
	}
	if err := a.updatePage(id, body.Title, body.Icon); err != nil {
		serverError(w, err)
		return
	}
	page, _ := a.getPage(id)
	writeJSON(w, page)
}

func (a *App) handleDeletePage(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := a.deletePage(id); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, map[string]string{"status": "ok"})
}

func (a *App) handleMovePage(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		ParentID *string `json:"parent_id"`
		Position int     `json:"position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"bad request"}`, http.StatusBadRequest)
		return
	}
	if err := a.movePage(id, body.ParentID, body.Position); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, map[string]string{"status": "ok"})
}

// ---- API: Blocks ----

func (a *App) handleGetBlocks(w http.ResponseWriter, r *http.Request) {
	pageID := r.PathValue("id")
	blocks, err := a.getBlocks(pageID)
	if err != nil {
		serverError(w, err)
		return
	}
	if blocks == nil {
		blocks = []Block{}
	}
	writeJSON(w, blocks)
}

func (a *App) handleSaveBlocks(w http.ResponseWriter, r *http.Request) {
	pageID := r.PathValue("id")
	var blocks []Block
	if err := json.NewDecoder(r.Body).Decode(&blocks); err != nil {
		http.Error(w, `{"error":"bad request"}`, http.StatusBadRequest)
		return
	}
	if err := a.saveBlocks(pageID, blocks); err != nil {
		serverError(w, err)
		return
	}
	page, _ := a.getPage(pageID)
	writeJSON(w, page)
}

// ---- API: Shares ----

func (a *App) handleListShares(w http.ResponseWriter, r *http.Request) {
	pageID := r.PathValue("id")
	shares, err := a.listShares(pageID)
	if err != nil {
		serverError(w, err)
		return
	}
	if shares == nil {
		shares = []Share{}
	}
	writeJSON(w, shares)
}

func (a *App) handleCreateShare(w http.ResponseWriter, r *http.Request) {
	pageID := r.PathValue("id")
	var body struct {
		Alias   string `json:"alias"`
		KeyType string `json:"key_type"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"bad request"}`, http.StatusBadRequest)
		return
	}
	if body.Alias == "" {
		body.Alias = "Anonymous"
	}
	switch body.KeyType {
	case "viewer", "commenter", "editor":
	default:
		body.KeyType = "viewer"
	}
	share, err := a.createShare(pageID, body.Alias, body.KeyType)
	if err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, share)
}

func (a *App) handleDeleteShare(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := a.deleteShare(id); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, map[string]string{"status": "ok"})
}

// ---- API: Comments ----

func (a *App) handleGetComments(w http.ResponseWriter, r *http.Request) {
	pageID := r.PathValue("id")
	comments, err := a.getComments(pageID)
	if err != nil {
		serverError(w, err)
		return
	}
	if comments == nil {
		comments = []Comment{}
	}
	writeJSON(w, comments)
}

func (a *App) handleCreateComment(w http.ResponseWriter, r *http.Request) {
	pageID := r.PathValue("id")
	var body struct {
		BlockID         *string `json:"block_id"`
		HighlightedText string  `json:"highlighted_text"`
		ParentCommentID *string `json:"parent_comment_id"`
		Content         string  `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"bad request"}`, http.StatusBadRequest)
		return
	}
	comment, err := a.createComment(pageID, body.BlockID, nil, body.ParentCommentID, "admin", body.HighlightedText, body.Content)
	if err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, comment)
}

func (a *App) handleResolveComment(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := a.resolveComment(id); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, map[string]string{"status": "ok"})
}

// ---- API: Upload ----

var safeImageExts = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".webp": true, ".avif": true,
}

func (a *App) handleUpload(w http.ResponseWriter, r *http.Request) {
	pageID := r.PathValue("id")
	a.processUpload(w, r, pageID)
}

func (a *App) processUpload(w http.ResponseWriter, r *http.Request, pageID string) {
	r.Body = http.MaxBytesReader(w, r.Body, 250<<20) // 250MB
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		http.Error(w, `{"error":"file too large"}`, http.StatusRequestEntityTooLarge)
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, `{"error":"no file"}`, http.StatusBadRequest)
		return
	}
	defer file.Close()

	ext := strings.ToLower(filepath.Ext(header.Filename))

	// Read first 512 bytes for content type detection
	buf := make([]byte, 512)
	n, _ := file.Read(buf)
	detected := http.DetectContentType(buf[:n])
	file.Seek(0, 0)

	// For image blocks, validate content matches a safe image type
	blockType := r.FormValue("block_type")
	if blockType == "image" {
		if !safeImageExts[ext] || !strings.HasPrefix(detected, "image/") {
			http.Error(w, `{"error":"invalid image file"}`, http.StatusBadRequest)
			return
		}
	}

	// Generate unique filename
	name := fmt.Sprintf("%s_%d%s", generateID(), time.Now().UnixNano(), ext)
	fpath := filepath.Join(a.uploadDir, name)

	out, err := os.OpenFile(fpath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		serverError(w, err)
		return
	}
	defer out.Close()

	if _, err = io.Copy(out, file); err != nil {
		serverError(w, err)
		return
	}

	// Record file ownership (server-side, not forgeable by editors)
	if err := a.insertFile(name, pageID); err != nil {
		serverError(w, err)
		return
	}

	writeJSON(w, map[string]string{
		"src":      "/uploads/" + name,
		"filename": header.Filename,
	})
}

// ---- Secure upload serving ----

func (a *App) validateUploadPath(filename string) (string, bool) {
	if filename == "" || strings.Contains(filename, "..") || strings.ContainsAny(filename, "/\\") {
		return "", false
	}
	filePath := filepath.Join(a.uploadDir, filename)
	absUpload, err := filepath.Abs(a.uploadDir)
	if err != nil {
		return "", false
	}
	absFile, err := filepath.Abs(filePath)
	if err != nil {
		return "", false
	}
	if !strings.HasPrefix(absFile, absUpload+string(filepath.Separator)) {
		return "", false
	}
	return filePath, true
}

func (a *App) serveFileSecure(w http.ResponseWriter, r *http.Request, filePath string) {
	w.Header().Set("X-Content-Type-Options", "nosniff")

	inline := false
	ext := strings.ToLower(filepath.Ext(filePath))
	if safeImageExts[ext] {
		f, err := os.Open(filePath)
		if err == nil {
			buf := make([]byte, 512)
			n, _ := f.Read(buf)
			f.Close()
			detected := http.DetectContentType(buf[:n])
			if strings.HasPrefix(detected, "image/") && detected != "image/svg+xml" {
				inline = true
			}
		}
	}

	if !inline {
		w.Header().Set("Content-Disposition", "attachment")
	}
	http.ServeFile(w, r, filePath)
}

func (a *App) handleServeUpload(w http.ResponseWriter, r *http.Request) {
	filename := r.PathValue("filename")
	filePath, ok := a.validateUploadPath(filename)
	if !ok {
		http.NotFound(w, r)
		return
	}
	a.serveFileSecure(w, r, filePath)
}

func (a *App) handleSharedServeUpload(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	filename := r.PathValue("filename")
	share, err := a.getShareByToken(token)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	filePath, ok := a.validateUploadPath(filename)
	if !ok {
		http.NotFound(w, r)
		return
	}
	if !a.fileExistsForPage(filename, share.PageID) {
		http.NotFound(w, r)
		return
	}
	a.serveFileSecure(w, r, filePath)
}

// ---- Shared API endpoints ----

func (a *App) handleSharedGetPage(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	share, err := a.getShareByToken(token)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	page, err := a.getPage(share.PageID)
	if err != nil {
		http.Error(w, `{"error":"page not found"}`, http.StatusNotFound)
		return
	}
	blocks, _ := a.getBlocks(share.PageID)
	if blocks == nil {
		blocks = []Block{}
	}
	comments, _ := a.getComments(share.PageID)
	if comments == nil {
		comments = []Comment{}
	}

	writeJSON(w, map[string]interface{}{
		"page":     page,
		"blocks":   blocks,
		"comments": comments,
		"share": map[string]string{
			"key_type": share.KeyType,
			"alias":    share.Alias,
			"id":       share.ID,
		},
	})
}

func (a *App) handleSharedCreateComment(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	share, err := a.getShareByToken(token)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if share.KeyType != "commenter" && share.KeyType != "editor" {
		http.Error(w, `{"error":"no comment access"}`, http.StatusForbidden)
		return
	}

	var body struct {
		BlockID         *string `json:"block_id"`
		HighlightedText string  `json:"highlighted_text"`
		ParentCommentID *string `json:"parent_comment_id"`
		Content         string  `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"bad request"}`, http.StatusBadRequest)
		return
	}

	comment, err := a.createComment(share.PageID, body.BlockID, &share.ID, body.ParentCommentID, "share", body.HighlightedText, body.Content)
	if err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, comment)
}

func (a *App) handleSharedSaveBlocks(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	share, err := a.getShareByToken(token)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if share.KeyType != "editor" {
		http.Error(w, `{"error":"no edit access"}`, http.StatusForbidden)
		return
	}

	var blocks []Block
	if err := json.NewDecoder(r.Body).Decode(&blocks); err != nil {
		http.Error(w, `{"error":"bad request"}`, http.StatusBadRequest)
		return
	}
	if err := a.saveBlocks(share.PageID, blocks); err != nil {
		serverError(w, err)
		return
	}
	page, _ := a.getPage(share.PageID)
	writeJSON(w, page)
}

func (a *App) handleSharedUpload(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	share, err := a.getShareByToken(token)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if share.KeyType != "editor" {
		http.Error(w, `{"error":"no upload access"}`, http.StatusForbidden)
		return
	}
	a.processUpload(w, r, share.PageID)
}

// ---- Helpers ----

func writeJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func serverError(w http.ResponseWriter, err error) {
	log.Printf("Internal error: %v", err)
	http.Error(w, `{"error":"internal server error"}`, http.StatusInternalServerError)
}
