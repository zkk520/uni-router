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

func TestChannelBatchIDsEnableDisable(t *testing.T) {
	ctx := setupTestDB(t)
	channels := []*model.Channel{
		{Name: "batch-enable-a", Type: outbound.OutboundTypeOpenAIChat, Enabled: false, Model: "gpt-4o"},
		{Name: "batch-enable-b", Type: outbound.OutboundTypeAnthropic, Enabled: false, Model: "claude-3"},
	}
	for _, channel := range channels {
		if err := ChannelCreate(channel, ctx); err != nil {
			t.Fatalf("create channel %s: %v", channel.Name, err)
		}
	}

	result, err := ChannelBatch(model.ChannelBatchRequest{
		Action: model.ChannelBatchActionEnable,
		Scope:  model.ChannelBatchScopeIDs,
		IDs:    []int{channels[0].ID, channels[1].ID},
	}, ctx)
	if err != nil {
		t.Fatalf("batch enable: %v", err)
	}
	if result.Requested != 2 || result.Succeeded != 2 || result.Failed != 0 {
		t.Fatalf("result = %#v, want 2 successes", result)
	}
	for _, channel := range channels {
		got, err := ChannelGet(channel.ID, ctx)
		if err != nil || !got.Enabled {
			t.Fatalf("channel %d enabled = %#v, err = %v", channel.ID, got, err)
		}
	}

	result, err = ChannelBatch(model.ChannelBatchRequest{
		Action: model.ChannelBatchActionDisable,
		Scope:  model.ChannelBatchScopeIDs,
		IDs:    []int{channels[0].ID},
	}, ctx)
	if err != nil {
		t.Fatalf("batch disable: %v", err)
	}
	if result.Requested != 1 || result.Succeeded != 1 || result.SuccessIDs[0] != channels[0].ID {
		t.Fatalf("result = %#v, want first channel disabled", result)
	}
	got, err := ChannelGet(channels[0].ID, ctx)
	if err != nil || got.Enabled {
		t.Fatalf("channel %d enabled = %#v, err = %v", channels[0].ID, got, err)
	}
}

func TestChannelBatchFilterExcludesIDs(t *testing.T) {
	ctx := setupTestDB(t)
	channels := []*model.Channel{
		{Name: "batch-filter-openai-a", Type: outbound.OutboundTypeOpenAIChat, Enabled: true, Model: "gpt-4o"},
		{Name: "batch-filter-openai-b", Type: outbound.OutboundTypeOpenAIChat, Enabled: true, Model: "gpt-5"},
		{Name: "batch-filter-anthropic", Type: outbound.OutboundTypeAnthropic, Enabled: true, Model: "claude-3"},
	}
	for _, channel := range channels {
		if err := ChannelCreate(channel, ctx); err != nil {
			t.Fatalf("create channel %s: %v", channel.Name, err)
		}
	}
	channelType := int(outbound.OutboundTypeOpenAIChat)

	result, err := ChannelBatch(model.ChannelBatchRequest{
		Action: model.ChannelBatchActionDisable,
		Scope:  model.ChannelBatchScopeFilter,
		Filter: model.ChannelBatchFilter{
			Keyword: "openai",
			Type:    &channelType,
		},
		ExcludeIDs: []int{channels[1].ID},
	}, ctx)
	if err != nil {
		t.Fatalf("batch filter disable: %v", err)
	}
	if result.Requested != 1 || result.Succeeded != 1 || result.SuccessIDs[0] != channels[0].ID {
		t.Fatalf("result = %#v, want only first openai channel", result)
	}
	first, _ := ChannelGet(channels[0].ID, ctx)
	second, _ := ChannelGet(channels[1].ID, ctx)
	third, _ := ChannelGet(channels[2].ID, ctx)
	if first.Enabled || !second.Enabled || !third.Enabled {
		t.Fatalf("enabled states = %v %v %v, want false true true", first.Enabled, second.Enabled, third.Enabled)
	}
}

func TestChannelBatchDeletePartialFailure(t *testing.T) {
	ctx := setupTestDB(t)
	channel := &model.Channel{Name: "batch-delete-partial", Type: outbound.OutboundTypeOpenAIChat, Enabled: true, Model: "gpt-4o"}
	if err := ChannelCreate(channel, ctx); err != nil {
		t.Fatalf("create channel: %v", err)
	}

	result, err := ChannelBatch(model.ChannelBatchRequest{
		Action: model.ChannelBatchActionDelete,
		Scope:  model.ChannelBatchScopeIDs,
		IDs:    []int{channel.ID, 999999},
	}, ctx)
	if err != nil {
		t.Fatalf("batch delete: %v", err)
	}
	if result.Requested != 2 || result.Succeeded != 1 || result.Failed != 1 || len(result.FailedItems) != 1 {
		t.Fatalf("result = %#v, want one success and one failure", result)
	}
	if _, err := ChannelGet(channel.ID, ctx); err == nil {
		t.Fatalf("deleted channel %d still exists", channel.ID)
	}
}

func TestChannelBatchEmptyResult(t *testing.T) {
	ctx := setupTestDB(t)
	result, err := ChannelBatch(model.ChannelBatchRequest{
		Action: model.ChannelBatchActionDisable,
		Scope:  model.ChannelBatchScopeFilter,
		Filter: model.ChannelBatchFilter{Keyword: "no-such-channel"},
	}, ctx)
	if err != nil {
		t.Fatalf("batch empty: %v", err)
	}
	if result.Requested != 0 || result.Succeeded != 0 || result.Failed != 0 || len(result.SuccessIDs) != 0 || len(result.FailedItems) != 0 {
		t.Fatalf("result = %#v, want empty success", result)
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

func TestRouteProfilePageDefaultsToSortOrder(t *testing.T) {
	ctx := setupTestDB(t)
	routes := []*model.RouteProfile{
		{Name: "route-page-order-first"},
		{Name: "route-page-order-second"},
		{Name: "route-page-order-third"},
	}
	for _, route := range routes {
		if err := RouteProfileCreate(route, ctx); err != nil {
			t.Fatalf("create route %s: %v", route.Name, err)
		}
	}
	if _, err := RouteProfileReorder([]int{routes[2].ID, routes[0].ID, routes[1].ID}, ctx); err != nil {
		t.Fatalf("reorder routes: %v", err)
	}

	result, err := RouteProfilePage(ctx, RoutePageFilter{PageParams: PageParams{Page: 1, PageSize: 20}})
	if err != nil {
		t.Fatalf("route page: %v", err)
	}
	wantNames := []string{"route-page-order-third", "route-page-order-first", "route-page-order-second"}
	for index, wantName := range wantNames {
		if result.Items[index].Name != wantName {
			t.Fatalf("route page item %d = %q, want %q", index, result.Items[index].Name, wantName)
		}
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
