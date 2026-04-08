package main

import (
	"database/sql"
	"log"
	"net/http"
	"os"

	_ "github.com/mattn/go-sqlite3"
)

var (
	db        *sql.DB
	adminKey  string
	uploadDir string
)

func main() {
	adminKey = os.Getenv("ADMIN_KEY")
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

	uploadDir = os.Getenv("UPLOAD_DIR")
	if uploadDir == "" {
		uploadDir = "../data/uploads"
	}

	os.MkdirAll(uploadDir, 0755)

	var err error
	db, err = sql.Open("sqlite3", dbPath+"?_busy_timeout=5000&_foreign_keys=on")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)

	if err := initSchema(db); err != nil {
		log.Fatal("schema init:", err)
	}

	mux := http.NewServeMux()

	// Admin API
	mux.Handle("GET /api/pages", adminOnly(http.HandlerFunc(listPagesHandler)))
	mux.Handle("POST /api/pages", adminOnly(http.HandlerFunc(createPageHandler)))
	mux.Handle("GET /api/pages/{id}", adminOnly(http.HandlerFunc(getPageHandler)))
	mux.Handle("PUT /api/pages/{id}", adminOnly(http.HandlerFunc(updatePageHandler)))
	mux.Handle("DELETE /api/pages/{id}", adminOnly(http.HandlerFunc(deletePageHandler)))
	mux.Handle("PUT /api/pages/{id}/blocks", adminOnly(http.HandlerFunc(saveBlocksHandler)))
	mux.Handle("GET /api/pages/{id}/comments", adminOnly(http.HandlerFunc(getCommentsHandler)))
	mux.Handle("POST /api/pages/{id}/comments", adminOnly(http.HandlerFunc(createCommentHandler)))
	mux.Handle("PUT /api/comments/{id}/resolve", adminOnly(http.HandlerFunc(resolveCommentHandler)))
	mux.Handle("GET /api/pages/{id}/shares", adminOnly(http.HandlerFunc(getSharesHandler)))
	mux.Handle("POST /api/pages/{id}/shares", adminOnly(http.HandlerFunc(createShareHandler)))
	mux.Handle("DELETE /api/shares/{id}", adminOnly(http.HandlerFunc(deleteShareHandler)))
	mux.Handle("POST /api/upload", adminOnly(http.HandlerFunc(uploadHandler)))

	// Public shared page API
	mux.HandleFunc("GET /api/shared/{token}", getSharedPageHandler)
	mux.HandleFunc("POST /api/shared/{token}/comments", createSharedCommentHandler)

	// Static files
	mux.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir("static"))))
	mux.Handle("/uploads/", http.StripPrefix("/uploads/", http.FileServer(http.Dir(uploadDir))))

	// HTML pages
	mux.HandleFunc("GET /shared/{token}", serveSharedHTML)
	mux.HandleFunc("GET /{$}", serveIndex)

	log.Printf("Listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
