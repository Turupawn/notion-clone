package main

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func jsonResponse(w http.ResponseWriter, data any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func jsonError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// Pages

func listPagesHandler(w http.ResponseWriter, r *http.Request) {
	pages, err := dbListPages()
	if err != nil {
		jsonError(w, err.Error(), 500)
		return
	}
	if pages == nil {
		pages = []Page{}
	}
	jsonResponse(w, pages)
}

func createPageHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title string `json:"title"`
		Icon  string `json:"icon"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	page, err := dbCreatePage(req.Title, req.Icon)
	if err != nil {
		jsonError(w, err.Error(), 500)
		return
	}
	w.WriteHeader(201)
	jsonResponse(w, page)
}

func getPageHandler(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	page, err := dbGetPage(id)
	if err == sql.ErrNoRows {
		jsonError(w, "page not found", 404)
		return
	}
	if err != nil {
		jsonError(w, err.Error(), 500)
		return
	}

	blocks, err := dbGetBlocks(id)
	if err != nil {
		jsonError(w, err.Error(), 500)
		return
	}
	if blocks == nil {
		blocks = []Block{}
	}

	jsonResponse(w, map[string]any{
		"page":   page,
		"blocks": blocks,
	})
}

func updatePageHandler(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req struct {
		Title      string `json:"title"`
		Icon       string `json:"icon"`
		CoverImage string `json:"cover_image"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	if err := dbUpdatePage(id, req.Title, req.Icon, req.CoverImage); err != nil {
		jsonError(w, err.Error(), 500)
		return
	}
	page, _ := dbGetPage(id)
	jsonResponse(w, page)
}

func deletePageHandler(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := dbDeletePage(id); err != nil {
		jsonError(w, err.Error(), 500)
		return
	}
	jsonResponse(w, map[string]bool{"ok": true})
}

// Blocks

func saveBlocksHandler(w http.ResponseWriter, r *http.Request) {
	pageID := r.PathValue("id")

	var req struct {
		Blocks []BlockInput `json:"blocks"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid JSON", 400)
		return
	}

	blocks, err := dbSaveBlocks(pageID, req.Blocks)
	if err != nil {
		jsonError(w, err.Error(), 500)
		return
	}
	if blocks == nil {
		blocks = []Block{}
	}
	jsonResponse(w, blocks)
}

// Comments

func getCommentsHandler(w http.ResponseWriter, r *http.Request) {
	pageID := r.PathValue("id")
	comments, err := dbGetComments(pageID)
	if err != nil {
		jsonError(w, err.Error(), 500)
		return
	}
	if comments == nil {
		comments = []Comment{}
	}
	jsonResponse(w, comments)
}

func createCommentHandler(w http.ResponseWriter, r *http.Request) {
	pageID := r.PathValue("id")
	var req struct {
		BlockID         *string `json:"block_id"`
		HighlightedText string  `json:"highlighted_text"`
		Content         string  `json:"content"`
		ParentCommentID *string `json:"parent_comment_id"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	if strings.TrimSpace(req.Content) == "" {
		jsonError(w, "content is required", 400)
		return
	}

	comment, err := dbCreateComment(pageID, req.BlockID, nil, "admin", req.HighlightedText, req.Content, req.ParentCommentID)
	if err != nil {
		jsonError(w, err.Error(), 500)
		return
	}
	w.WriteHeader(201)
	jsonResponse(w, comment)
}

func resolveCommentHandler(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := dbResolveComment(id); err != nil {
		jsonError(w, err.Error(), 500)
		return
	}
	jsonResponse(w, map[string]bool{"ok": true})
}

// Shares

func getSharesHandler(w http.ResponseWriter, r *http.Request) {
	pageID := r.PathValue("id")
	shares, err := dbGetShares(pageID)
	if err != nil {
		jsonError(w, err.Error(), 500)
		return
	}
	if shares == nil {
		shares = []Share{}
	}
	jsonResponse(w, shares)
}

func createShareHandler(w http.ResponseWriter, r *http.Request) {
	pageID := r.PathValue("id")
	var req struct {
		Alias      string `json:"alias"`
		CanComment int    `json:"can_comment"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	if strings.TrimSpace(req.Alias) == "" {
		jsonError(w, "alias is required", 400)
		return
	}

	share, err := dbCreateShare(pageID, req.Alias, req.CanComment)
	if err != nil {
		jsonError(w, err.Error(), 500)
		return
	}
	w.WriteHeader(201)
	jsonResponse(w, share)
}

func deleteShareHandler(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := dbDeleteShare(id); err != nil {
		jsonError(w, err.Error(), 500)
		return
	}
	jsonResponse(w, map[string]bool{"ok": true})
}

// Shared page (no admin auth)

func getSharedPageHandler(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	share, err := dbGetShareByToken(token)
	if err == sql.ErrNoRows {
		jsonError(w, "invalid share link", 404)
		return
	}
	if err != nil {
		jsonError(w, err.Error(), 500)
		return
	}

	page, err := dbGetPage(share.PageID)
	if err != nil {
		jsonError(w, err.Error(), 500)
		return
	}

	blocks, err := dbGetBlocks(share.PageID)
	if err != nil {
		jsonError(w, err.Error(), 500)
		return
	}
	if blocks == nil {
		blocks = []Block{}
	}

	comments, err := dbGetComments(share.PageID)
	if err != nil {
		jsonError(w, err.Error(), 500)
		return
	}
	if comments == nil {
		comments = []Comment{}
	}

	jsonResponse(w, map[string]any{
		"page":     page,
		"blocks":   blocks,
		"comments": comments,
		"share":    share,
	})
}

func createSharedCommentHandler(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	share, err := dbGetShareByToken(token)
	if err == sql.ErrNoRows {
		jsonError(w, "invalid share link", 404)
		return
	}
	if err != nil {
		jsonError(w, err.Error(), 500)
		return
	}

	if share.CanComment == 0 {
		jsonError(w, "commenting not allowed", 403)
		return
	}

	var req struct {
		BlockID         *string `json:"block_id"`
		HighlightedText string  `json:"highlighted_text"`
		Content         string  `json:"content"`
		ParentCommentID *string `json:"parent_comment_id"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	if strings.TrimSpace(req.Content) == "" {
		jsonError(w, "content is required", 400)
		return
	}

	comment, err := dbCreateComment(share.PageID, req.BlockID, &share.ID, "share", req.HighlightedText, req.Content, req.ParentCommentID)
	if err != nil {
		jsonError(w, err.Error(), 500)
		return
	}
	w.WriteHeader(201)
	jsonResponse(w, comment)
}

// Upload

func uploadHandler(w http.ResponseWriter, r *http.Request) {
	r.ParseMultipartForm(32 << 20) // 32MB max
	file, header, err := r.FormFile("file")
	if err != nil {
		jsonError(w, "no file provided", 400)
		return
	}
	defer file.Close()

	ext := filepath.Ext(header.Filename)
	newName := generateID() + ext
	dstPath := filepath.Join(uploadDir, newName)

	dst, err := os.Create(dstPath)
	if err != nil {
		jsonError(w, "failed to save file", 500)
		return
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		jsonError(w, "failed to write file", 500)
		return
	}

	jsonResponse(w, map[string]string{"src": "/uploads/" + newName})
}

// HTML pages

func serveIndex(w http.ResponseWriter, r *http.Request) {
	http.ServeFile(w, r, "static/index.html")
}

func serveSharedHTML(w http.ResponseWriter, r *http.Request) {
	http.ServeFile(w, r, "static/shared.html")
}
