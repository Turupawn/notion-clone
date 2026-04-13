package main

import (
	"log"
	"net/http"
	"os"
	"strings"
)

func main() {
	adminKey := os.Getenv("ADMIN_KEY")
	if adminKey == "" {
		log.Fatal("ADMIN_KEY environment variable is required")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "../data/data.db"
	}

	uploadDir := os.Getenv("UPLOAD_DIR")
	if uploadDir == "" {
		uploadDir = "../data/uploads"
	}

	os.MkdirAll(uploadDir, 0700)

	db := initDB(dbPath)
	defer db.Close()

	app := &App{
		db:        db,
		adminKey:  adminKey,
		uploadDir: uploadDir,
	}

	mux := http.NewServeMux()

	// HTML pages
	mux.HandleFunc("GET /", app.adminAuth(app.handleAdminPage))
	mux.HandleFunc("POST /login", app.handleLogin)
	mux.HandleFunc("GET /shared/{token}", app.handleSharedPage)

	// Static files (served from disk so changes don't require recompilation)
	mux.Handle("GET /static/", http.StripPrefix("/static/", http.FileServer(http.Dir("static"))))

	// Uploads: authenticated serving only
	mux.HandleFunc("GET /uploads/{filename}", app.adminAuth(app.handleServeUpload))
	mux.HandleFunc("GET /api/shared/{token}/uploads/{filename}", app.handleSharedServeUpload)

	// API - pages (admin)
	mux.HandleFunc("GET /api/pages", app.adminAuth(app.handleListPages))
	mux.HandleFunc("POST /api/pages", app.adminAuth(app.handleCreatePage))
	mux.HandleFunc("PUT /api/pages/{id}", app.adminAuth(app.handleUpdatePage))
	mux.HandleFunc("DELETE /api/pages/{id}", app.adminAuth(app.handleDeletePage))
	mux.HandleFunc("PUT /api/pages/{id}/move", app.adminAuth(app.handleMovePage))

	// API - blocks (admin)
	mux.HandleFunc("GET /api/pages/{id}/blocks", app.adminAuth(app.handleGetBlocks))
	mux.HandleFunc("PUT /api/pages/{id}/blocks", app.adminAuth(app.handleSaveBlocks))

	// API - shares (admin)
	mux.HandleFunc("GET /api/pages/{id}/shares", app.adminAuth(app.handleListShares))
	mux.HandleFunc("POST /api/pages/{id}/shares", app.adminAuth(app.handleCreateShare))
	mux.HandleFunc("DELETE /api/shares/{id}", app.adminAuth(app.handleDeleteShare))

	// API - comments (admin)
	mux.HandleFunc("GET /api/pages/{id}/comments", app.adminAuth(app.handleGetComments))
	mux.HandleFunc("POST /api/pages/{id}/comments", app.adminAuth(app.handleCreateComment))
	mux.HandleFunc("PUT /api/comments/{id}/resolve", app.adminAuth(app.handleResolveComment))

	// API - upload (admin, scoped to page)
	mux.HandleFunc("POST /api/pages/{id}/upload", app.adminAuth(app.handleUpload))

	// API - shared endpoints
	mux.HandleFunc("GET /api/shared/{token}/page", app.handleSharedGetPage)
	mux.HandleFunc("POST /api/shared/{token}/comments", app.handleSharedCreateComment)
	mux.HandleFunc("PUT /api/shared/{token}/blocks", app.handleSharedSaveBlocks)
	mux.HandleFunc("POST /api/shared/{token}/upload", app.handleSharedUpload)

	// Limit request body size: 10MB for JSON, uploads set their own limit
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/") {
			r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
		}
		mux.ServeHTTP(w, r)
	})

	log.Printf("Server starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, handler))
}
