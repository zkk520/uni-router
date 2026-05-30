package op

import (
	"testing"

	"github.com/zkk520/uni-router/internal/model"
	"github.com/zkk520/uni-router/internal/transformer/outbound"
)

func TestChannelPageFiltersSortsAndSlices(t *testing.T) {
	ctx := setupTestDB(t)
	fixtures := []*model.Channel{
		{Name: "alpha-openai", Type: outbound.OutboundTypeOpenAIChat, Enabled: true, Model: "gpt-4o"},
		{Name: "beta-disabled", Type: outbound.OutboundTypeAnthropic, Enabled: false, Model: "claude-3"},
		{Name: "gamma-openai", Type: outbound.OutboundTypeOpenAIChat, Enabled: true, Model: "gpt-5"},
	}
	for _, fixture := range fixtures {
		if err := ChannelCreate(fixture, ctx); err != nil {
			t.Fatalf("create channel %s: %v", fixture.Name, err)
		}
	}

	enabled := true
	result, err := ChannelPage(ctx, ChannelPageFilter{
		PageParams: PageParams{Page: 1, PageSize: 1, Keyword: "openai", SortBy: "name", SortOrder: "desc"},
		Enabled:    &enabled,
	})
	if err != nil {
		t.Fatalf("channel page: %v", err)
	}
	if result.Total != 2 {
		t.Fatalf("total = %d, want 2", result.Total)
	}
	if len(result.Items) != 1 || result.Items[0].Name != "gamma-openai" {
		t.Fatalf("items = %#v, want gamma-openai first", result.Items)
	}
}

func TestLLMPageProviderAndPricedFilter(t *testing.T) {
	ctx := setupTestDB(t)
	for _, item := range []model.LLMInfo{
		{Name: "gpt-5.5", LLMPrice: model.LLMPrice{Input: 1, Output: 2}},
		{Name: "claude-4-opus"},
		{Name: "openai/text-embedding-3-large", LLMPrice: model.LLMPrice{Input: 0.1}},
	} {
		if err := LLMCreate(item, ctx); err != nil {
			t.Fatalf("create model %s: %v", item.Name, err)
		}
	}

	priced := true
	result, err := LLMPage(ctx, LLMPageFilter{
		PageParams: PageParams{Page: 1, PageSize: 20, SortBy: "name", SortOrder: "asc"},
		Provider:   "openai",
		Priced:     &priced,
	})
	if err != nil {
		t.Fatalf("llm page: %v", err)
	}
	if result.Total != 2 {
		t.Fatalf("total = %d, want 2", result.Total)
	}
	if result.Items[0].Name != "gpt-5.5" || result.Items[1].Name != "openai/text-embedding-3-large" {
		t.Fatalf("items = %#v, want openai priced models sorted by name", result.Items)
	}
}

func TestRouteAndAPIKeyPages(t *testing.T) {
	ctx := setupTestDB(t)
	channel := &model.Channel{
		Name:    "route-page-channel",
		Type:    outbound.OutboundTypeOpenAIChat,
		Enabled: true,
		Model:   "gpt-5",
		Keys:    []model.ChannelKey{{Enabled: true, ChannelKey: "sk-route-page"}},
	}
	if err := ChannelCreate(channel, ctx); err != nil {
		t.Fatalf("create channel: %v", err)
	}
	for _, route := range []*model.RouteProfile{
		{Name: "manual-route", Mode: model.RouteModeManual},
		{Name: "weighted-route", Mode: model.RouteModeWeighted},
	} {
		if err := RouteProfileCreate(route, ctx); err != nil {
			t.Fatalf("create route %s: %v", route.Name, err)
		}
		if err := APIKeyCreate(&model.APIKey{Name: route.Name + "-key", APIKey: "sk-" + route.Name, Enabled: route.Mode == model.RouteModeManual, RouterID: route.ID}, ctx); err != nil {
			t.Fatalf("create api key: %v", err)
		}
	}

	routeResult, err := RouteProfilePage(ctx, RoutePageFilter{
		PageParams: PageParams{Page: 1, PageSize: 20},
		Mode:       string(model.RouteModeWeighted),
	})
	if err != nil {
		t.Fatalf("route page: %v", err)
	}
	if routeResult.Total != 1 || routeResult.Items[0].Name != "weighted-route" {
		t.Fatalf("route page = %#v, want weighted route", routeResult)
	}

	enabled := true
	keyResult, err := APIKeyPage(ctx, APIKeyPageFilter{
		PageParams: PageParams{Page: 1, PageSize: 20, Keyword: "manual"},
		Enabled:    &enabled,
	})
	if err != nil {
		t.Fatalf("api key page: %v", err)
	}
	if keyResult.Total != 1 || keyResult.Items[0].Name != "manual-route-key" {
		t.Fatalf("api key page = %#v, want manual route key", keyResult)
	}
}

func TestRelayLogCountWithFilterIncludesCacheAndDB(t *testing.T) {
	ctx := setupTestLogDB(t)
	for _, item := range []model.RelayLog{
		{Time: 1, RequestModelName: "gpt-5", RequestAPIKeyName: "key-a", ChannelName: "ch", ActualModelName: "gpt-5", Error: ""},
		{Time: 2, RequestModelName: "gpt-5", RequestAPIKeyName: "key-b", ChannelName: "ch", ActualModelName: "gpt-5", Error: "failed"},
	} {
		if err := RelayLogAdd(ctx, item); err != nil {
			t.Fatalf("add log: %v", err)
		}
	}

	total, err := RelayLogCountWithFilter(ctx, RelayLogFilter{Status: "failed"})
	if err != nil {
		t.Fatalf("count logs: %v", err)
	}
	if total != 1 {
		t.Fatalf("total = %d, want 1", total)
	}
}
