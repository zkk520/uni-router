package handlers

import (
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zkk520/uni-router/internal/op"
)

func parsePageParams(c *gin.Context) op.PageParams {
	page, _ := strconv.Atoi(c.DefaultQuery("page", strconv.Itoa(op.DefaultPage)))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", strconv.Itoa(op.DefaultPageSize)))
	return op.NormalizePageParams(op.PageParams{
		Page:      page,
		PageSize:  pageSize,
		Keyword:   c.Query("keyword"),
		SortBy:    c.Query("sort_by"),
		SortOrder: c.Query("sort_order"),
	})
}

func parseOptionalBool(value string) (*bool, bool) {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" || value == "all" {
		return nil, true
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return nil, false
	}
	return &parsed, true
}

func parseOptionalInt(value string) (*int, bool) {
	value = strings.TrimSpace(value)
	if value == "" || value == "all" {
		return nil, true
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return nil, false
	}
	return &parsed, true
}
