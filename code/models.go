package main

type Page struct {
	ID         string  `json:"id"`
	Title      string  `json:"title"`
	Icon       string  `json:"icon"`
	CoverImage string  `json:"cover_image"`
	ParentID   *string `json:"parent_id"`
	CreatedAt  string  `json:"created_at"`
	UpdatedAt  string  `json:"updated_at"`
}

type Block struct {
	ID            string  `json:"id"`
	PageID        string  `json:"page_id"`
	Type          string  `json:"type"`
	Content       string  `json:"content"`
	Properties    string  `json:"properties"`
	Position      int     `json:"position"`
	ParentBlockID *string `json:"parent_block_id"`
	CreatedAt     string  `json:"created_at"`
	UpdatedAt     string  `json:"updated_at"`
}

type Share struct {
	ID         string `json:"id"`
	PageID     string `json:"page_id"`
	Alias      string `json:"alias"`
	Token      string `json:"token"`
	CanComment int    `json:"can_comment"`
	CreatedAt  string `json:"created_at"`
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
	AuthorName      string  `json:"author_name"`
}

type BlockInput struct {
	ClientID       string `json:"client_id"`
	Type           string `json:"type"`
	Content        string `json:"content"`
	Properties     string `json:"properties"`
	Position       int    `json:"position"`
	ParentClientID string `json:"parent_client_id"`
}
