package main

import (
	"fmt"
	"html"
	"log"
	"net/http"
	"os"
)

func readTemplate(name string) string {
	data, err := os.ReadFile("templates/" + name)
	if err != nil {
		log.Printf("Failed to load template %s: %v", name, err)
		return "Internal server error"
	}
	return string(data)
}

func (a *App) serveLoginPage(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprint(w, readTemplate("login.html"))
}

func (a *App) serveAdminPage(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprint(w, readTemplate("admin.html"))
}

func (a *App) serveSharedPage(w http.ResponseWriter, page *Page, share *Share) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	icon := page.Icon
	if icon == "" {
		icon = "📄"
	}
	canEdit := ""
	if share.KeyType == "editor" {
		canEdit = `contenteditable="true"`
	}
	slashMenu := ""
	if share.KeyType == "editor" {
		slashMenu = `<div id="slash-menu" class="popup-menu" style="display:none"></div>`
	}
	commentsBtn := ""
	if share.KeyType == "commenter" || share.KeyType == "editor" {
		commentsBtn = `<button id="shared-comments-btn" title="Comments">Comments</button>`
	}

	fmt.Fprintf(w, readTemplate("shared.html"),
		html.EscapeString(page.Title),
		html.EscapeString(icon),
		html.EscapeString(page.Title),
		commentsBtn,
		canEdit,
		slashMenu,
		html.EscapeString(share.Token),
		html.EscapeString(share.KeyType),
	)
}
