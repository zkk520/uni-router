package op

import (
	"testing"

	"github.com/bestruirui/octopus/internal/model"
)

func createTestRoute(t *testing.T, name string) *model.RouteProfile {
	t.Helper()
	route := &model.RouteProfile{Name: name}
	if err := RouteProfileCreate(route, t.Context()); err != nil {
		t.Fatalf("create route %q: %v", name, err)
	}
	return route
}

func TestAPIKeyCreateRejectsDuplicateRouterBinding(t *testing.T) {
	ctx := setupTestDB(t)
	route := createTestRoute(t, "route-api-key-create")

	first := &model.APIKey{
		Name:     "first",
		APIKey:   "sk-first",
		Enabled:  true,
		RouterID: route.ID,
	}
	if err := APIKeyCreate(first, ctx); err != nil {
		t.Fatalf("create first API key: %v", err)
	}

	second := &model.APIKey{
		Name:     "second",
		APIKey:   "sk-second",
		Enabled:  true,
		RouterID: route.ID,
	}
	if err := APIKeyCreate(second, ctx); err == nil {
		t.Fatal("expected duplicate router binding to fail")
	}
}

func TestAPIKeyUpdateRejectsRouterBoundByAnotherKey(t *testing.T) {
	ctx := setupTestDB(t)
	firstRoute := createTestRoute(t, "route-api-key-update-first")
	secondRoute := createTestRoute(t, "route-api-key-update-second")

	first := &model.APIKey{
		Name:     "first",
		APIKey:   "sk-first-update",
		Enabled:  true,
		RouterID: firstRoute.ID,
	}
	if err := APIKeyCreate(first, ctx); err != nil {
		t.Fatalf("create first API key: %v", err)
	}

	second := &model.APIKey{
		Name:     "second",
		APIKey:   "sk-second-update",
		Enabled:  true,
		RouterID: secondRoute.ID,
	}
	if err := APIKeyCreate(second, ctx); err != nil {
		t.Fatalf("create second API key: %v", err)
	}

	second.RouterID = firstRoute.ID
	if err := APIKeyUpdate(second, ctx); err == nil {
		t.Fatal("expected update to router bound by another key to fail")
	}
}

func TestRouteProfileDetailIncludesBoundAPIKey(t *testing.T) {
	ctx := setupTestDB(t)
	route := createTestRoute(t, "route-bound-key-detail")

	apiKey := &model.APIKey{
		Name:     "bound",
		APIKey:   "sk-bound-detail",
		Enabled:  true,
		RouterID: route.ID,
	}
	if err := APIKeyCreate(apiKey, ctx); err != nil {
		t.Fatalf("create API key: %v", err)
	}

	detail, err := RouteProfileGet(route.ID, ctx)
	if err != nil {
		t.Fatalf("get route detail: %v", err)
	}
	if detail.BoundAPIKeyCount != 1 {
		t.Fatalf("expected bound API key count 1, got %d", detail.BoundAPIKeyCount)
	}
	if detail.BoundAPIKey == nil {
		t.Fatal("expected bound API key")
	}
	if detail.BoundAPIKey.ID != apiKey.ID {
		t.Fatalf("expected bound API key ID %d, got %d", apiKey.ID, detail.BoundAPIKey.ID)
	}
	if detail.BoundAPIKey.APIKey != apiKey.APIKey {
		t.Fatalf("expected full API key to be returned")
	}
}
