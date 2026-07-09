package op

import (
	"context"
	"sort"
	"strings"

	"github.com/zkk520/uni-router/internal/model"
)

const (
	DefaultPage     = 1
	DefaultPageSize = 20
	MaxPageSize     = 100
)

type PageParams struct {
	Page      int
	PageSize  int
	Keyword   string
	SortBy    string
	SortOrder string
}

type PageResult[T any] struct {
	Items    []T `json:"items"`
	Total    int `json:"total"`
	Page     int `json:"page"`
	PageSize int `json:"page_size"`
}

type ChannelPageFilter struct {
	PageParams
	Enabled *bool
	Type    *int
}

type LLMPageFilter struct {
	PageParams
	Provider string
	Priced   *bool
}

type RoutePageFilter struct {
	PageParams
	Mode string
}

type APIKeyPageFilter struct {
	PageParams
	Enabled  *bool
	RouterID int
}

func NormalizePageParams(params PageParams) PageParams {
	if params.Page < 1 {
		params.Page = DefaultPage
	}
	if params.PageSize < 1 || params.PageSize > MaxPageSize {
		params.PageSize = DefaultPageSize
	}
	params.Keyword = strings.ToLower(strings.TrimSpace(params.Keyword))
	params.SortBy = strings.ToLower(strings.TrimSpace(params.SortBy))
	params.SortOrder = strings.ToLower(strings.TrimSpace(params.SortOrder))
	if params.SortOrder != "asc" && params.SortOrder != "desc" {
		params.SortOrder = "desc"
	}
	return params
}

func PageSlice[T any](items []T, params PageParams) PageResult[T] {
	params = NormalizePageParams(params)
	total := len(items)
	offset := (params.Page - 1) * params.PageSize
	if offset >= total {
		return PageResult[T]{
			Items:    []T{},
			Total:    total,
			Page:     params.Page,
			PageSize: params.PageSize,
		}
	}
	end := offset + params.PageSize
	if end > total {
		end = total
	}
	return PageResult[T]{
		Items:    items[offset:end],
		Total:    total,
		Page:     params.Page,
		PageSize: params.PageSize,
	}
}

func ChannelPage(ctx context.Context, filter ChannelPageFilter) (PageResult[model.Channel], error) {
	params := NormalizePageParams(filter.PageParams)
	items, err := ChannelFilter(ctx, ChannelPageFilter{
		PageParams: PageParams{Keyword: params.Keyword, SortBy: params.SortBy, SortOrder: params.SortOrder},
		Enabled:    filter.Enabled,
		Type:       filter.Type,
	})
	if err != nil {
		return PageResult[model.Channel]{}, err
	}
	return PageSlice(items, params), nil
}

func ChannelFilter(ctx context.Context, filter ChannelPageFilter) ([]model.Channel, error) {
	params := NormalizePageParams(filter.PageParams)
	channels, err := ChannelList(ctx)
	if err != nil {
		return nil, err
	}
	items := make([]model.Channel, 0, len(channels))
	for _, channel := range channels {
		if params.Keyword != "" && !strings.Contains(strings.ToLower(channel.Name), params.Keyword) && !strings.Contains(strings.ToLower(channel.Model), params.Keyword) {
			continue
		}
		if filter.Enabled != nil && channel.Enabled != *filter.Enabled {
			continue
		}
		if filter.Type != nil && int(channel.Type) != *filter.Type {
			continue
		}
		items = append(items, channel)
	}
	sort.SliceStable(items, func(i, j int) bool {
		less := items[i].ID < items[j].ID
		switch params.SortBy {
		case "name":
			less = strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
		case "type":
			less = items[i].Type < items[j].Type
		case "enabled":
			less = !items[i].Enabled && items[j].Enabled
		}
		if params.SortOrder == "desc" {
			return !less
		}
		return less
	})
	return items, nil
}

func LLMPage(ctx context.Context, filter LLMPageFilter) (PageResult[model.LLMInfo], error) {
	params := NormalizePageParams(filter.PageParams)
	if params.SortBy == "" {
		params.SortBy = "name"
	}
	if filter.PageParams.SortOrder == "" {
		params.SortOrder = "asc"
	}
	models, err := LLMList(ctx)
	if err != nil {
		return PageResult[model.LLMInfo]{}, err
	}
	items := make([]model.LLMInfo, 0, len(models))
	for _, item := range models {
		if params.Keyword != "" && !strings.Contains(strings.ToLower(item.Name), params.Keyword) {
			continue
		}
		if filter.Provider != "" && llmProvider(item.Name) != strings.ToLower(filter.Provider) {
			continue
		}
		if filter.Priced != nil && llmHasPrice(item) != *filter.Priced {
			continue
		}
		items = append(items, item)
	}
	sort.SliceStable(items, func(i, j int) bool {
		less := strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
		switch params.SortBy {
		case "input":
			less = items[i].Input < items[j].Input
		case "output":
			less = items[i].Output < items[j].Output
		case "cache_read":
			less = items[i].CacheRead < items[j].CacheRead
		case "cache_write":
			less = items[i].CacheWrite < items[j].CacheWrite
		}
		if params.SortOrder == "desc" {
			return !less
		}
		return less
	})
	return PageSlice(items, params), nil
}

func RouteProfilePage(ctx context.Context, filter RoutePageFilter) (PageResult[RouteProfileDetail], error) {
	params := NormalizePageParams(filter.PageParams)
	if filter.PageParams.SortBy == "" {
		params.SortBy = "sort_order"
	}
	if filter.PageParams.SortOrder == "" {
		params.SortOrder = "asc"
	}
	routes, err := RouteProfileList(ctx)
	if err != nil {
		return PageResult[RouteProfileDetail]{}, err
	}
	items := make([]RouteProfileDetail, 0, len(routes))
	for _, route := range routes {
		if params.Keyword != "" && !strings.Contains(strings.ToLower(route.Name), params.Keyword) {
			continue
		}
		if filter.Mode != "" && string(route.Mode) != filter.Mode {
			continue
		}
		items = append(items, route)
	}
	sort.SliceStable(items, func(i, j int) bool {
		compare := 0
		switch params.SortBy {
		case "name":
			compare = strings.Compare(strings.ToLower(items[i].Name), strings.ToLower(items[j].Name))
		case "mode":
			compare = strings.Compare(string(items[i].Mode), string(items[j].Mode))
		case "created_at":
			compare = compareInt64(items[i].CreatedAt, items[j].CreatedAt)
		case "updated_at":
			compare = compareInt64(items[i].UpdatedAt, items[j].UpdatedAt)
		case "sort_order":
			compare = compareInt(items[i].SortOrder, items[j].SortOrder)
		default:
			compare = compareInt(items[i].ID, items[j].ID)
		}
		if compare == 0 {
			compare = compareInt(items[i].ID, items[j].ID)
		}
		if compare == 0 {
			return false
		}
		if params.SortOrder == "desc" {
			return compare > 0
		}
		return compare < 0
	})
	return PageSlice(items, params), nil
}

func compareInt(left, right int) int {
	if left < right {
		return -1
	}
	if left > right {
		return 1
	}
	return 0
}

func compareInt64(left, right int64) int {
	if left < right {
		return -1
	}
	if left > right {
		return 1
	}
	return 0
}

func APIKeyPage(ctx context.Context, filter APIKeyPageFilter) (PageResult[model.APIKey], error) {
	params := NormalizePageParams(filter.PageParams)
	keys, err := APIKeyList(ctx)
	if err != nil {
		return PageResult[model.APIKey]{}, err
	}
	items := make([]model.APIKey, 0, len(keys))
	for _, key := range keys {
		if params.Keyword != "" && !strings.Contains(strings.ToLower(key.Name), params.Keyword) && !strings.Contains(strings.ToLower(key.APIKey), params.Keyword) {
			continue
		}
		if filter.Enabled != nil && key.Enabled != *filter.Enabled {
			continue
		}
		if filter.RouterID > 0 && key.RouterID != filter.RouterID {
			continue
		}
		items = append(items, key)
	}
	sort.SliceStable(items, func(i, j int) bool {
		less := items[i].ID < items[j].ID
		switch params.SortBy {
		case "name":
			less = strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
		case "enabled":
			less = !items[i].Enabled && items[j].Enabled
		case "router_id":
			less = items[i].RouterID < items[j].RouterID
		case "expire_at":
			less = items[i].ExpireAt < items[j].ExpireAt
		case "max_cost":
			less = items[i].MaxCost < items[j].MaxCost
		}
		if params.SortOrder == "desc" {
			return !less
		}
		return less
	})
	return PageSlice(items, params), nil
}

func llmHasPrice(item model.LLMInfo) bool {
	return item.Input+item.Output+item.CacheRead+item.CacheWrite > 0
}

func llmProvider(modelName string) string {
	name := strings.ToLower(modelName)
	if slash := strings.LastIndex(name, "/"); slash >= 0 {
		name = name[slash+1:]
	}
	switch {
	case strings.HasPrefix(name, "gpt-"), strings.HasPrefix(name, "o1"), strings.HasPrefix(name, "o3"), strings.HasPrefix(name, "o4"), strings.HasPrefix(name, "openai"), strings.HasPrefix(name, "chatgpt"), strings.HasPrefix(name, "text-embedding"):
		return "openai"
	case strings.HasPrefix(name, "claude"), strings.HasPrefix(name, "anthropic"):
		return "anthropic"
	case strings.HasPrefix(name, "gemini"), strings.HasPrefix(name, "gemma"), strings.HasPrefix(name, "google"):
		return "google"
	case strings.HasPrefix(name, "deepseek"):
		return "deepseek"
	case strings.HasPrefix(name, "grok"), strings.HasPrefix(name, "xai"):
		return "xai"
	case strings.HasPrefix(name, "qwen"), strings.HasPrefix(name, "qwq"), strings.HasPrefix(name, "alibaba"):
		return "alibaba"
	default:
		return "other"
	}
}
