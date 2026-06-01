package op

import (
	"testing"

	"github.com/zkk520/uni-router/internal/model"
)

func TestEnsureUniqueRouteEndpointsRejectsDuplicateCreateItems(t *testing.T) {
	err := ensureUniqueRouteEndpoints([]model.RouteEndpoint{
		{ChannelID: 1, ChannelKeyID: 10},
		{ChannelID: 1, ChannelKeyID: 10},
	})
	if err == nil {
		t.Fatal("expected duplicate endpoint error")
	}
}

func TestEnsureUniqueRouteEndpointAddsRejectsExistingEndpoint(t *testing.T) {
	err := ensureUniqueRouteEndpointAdds(
		[]model.RouteEndpoint{{ChannelID: 1, ChannelKeyID: 10}},
		[]model.RouteEndpointAddRequest{{ChannelID: 1, ChannelKeyID: 10}},
	)
	if err == nil {
		t.Fatal("expected duplicate endpoint error")
	}
}

func TestEnsureUniqueRouteEndpointAddsRejectsDuplicateAddItems(t *testing.T) {
	err := ensureUniqueRouteEndpointAdds(nil, []model.RouteEndpointAddRequest{
		{ChannelID: 1, ChannelKeyID: 10},
		{ChannelID: 1, ChannelKeyID: 10},
	})
	if err == nil {
		t.Fatal("expected duplicate endpoint error")
	}
}

func TestEnsureUniqueRouteEndpointAddsAllowsDeletedExistingEndpoint(t *testing.T) {
	err := ensureUniqueRouteEndpointAdds(
		[]model.RouteEndpoint{{ChannelID: 1, ChannelKeyID: 10}},
		[]model.RouteEndpointAddRequest{{ChannelID: 1, ChannelKeyID: 11}},
	)
	if err != nil {
		t.Fatalf("expected unique endpoints to pass: %v", err)
	}
}

func TestRouteProfileCreateFromRequestDefaultsFailoverEnabled(t *testing.T) {
	ctx := setupTestDB(t)

	detail, err := RouteProfileCreateFromRequest(&model.RouteProfileCreateRequest{
		Name: "route-create-default-failover",
	}, ctx)

	if err != nil {
		t.Fatalf("create route from request: %v", err)
	}
	if !detail.FailoverEnabled {
		t.Fatal("expected omitted failover_enabled to default to true")
	}
}

func TestRouteProfileCreateFromRequestPreservesDisabledFailover(t *testing.T) {
	ctx := setupTestDB(t)
	disabled := false

	detail, err := RouteProfileCreateFromRequest(&model.RouteProfileCreateRequest{
		Name:            "route-create-disabled-failover",
		FailoverEnabled: &disabled,
	}, ctx)

	if err != nil {
		t.Fatalf("create route from request: %v", err)
	}
	if detail.FailoverEnabled {
		t.Fatal("expected explicit failover_enabled=false to be preserved")
	}
}

func TestRouteSelectModelListEndpointPrefersPreferredEndpoint(t *testing.T) {
	route := model.RouteProfile{
		PreferredEndpointID: 2,
		Endpoints: []model.RouteEndpoint{
			{ID: 1, Priority: 1, Enabled: true, Status: model.RouteEndpointStatusNormal},
			{ID: 2, Priority: 2, Enabled: true, Status: model.RouteEndpointStatusNormal},
		},
	}

	ep, ok := RouteSelectModelListEndpoint(route)

	if !ok {
		t.Fatal("expected model list endpoint")
	}
	if ep.ID != 2 {
		t.Fatalf("expected preferred endpoint 2, got %d", ep.ID)
	}
}

func TestRouteSelectModelListEndpointFallsBackToLowestPriority(t *testing.T) {
	route := model.RouteProfile{
		Mode: model.RouteModeWeighted,
		Endpoints: []model.RouteEndpoint{
			{ID: 3, Priority: 3, Enabled: true, Status: model.RouteEndpointStatusNormal},
			{ID: 1, Priority: 1, Enabled: true, Status: model.RouteEndpointStatusError},
			{ID: 2, Priority: 2, Enabled: true, Status: model.RouteEndpointStatusNormal},
		},
	}

	ep, ok := RouteSelectModelListEndpoint(route)

	if !ok {
		t.Fatal("expected model list endpoint")
	}
	if ep.ID != 2 {
		t.Fatalf("expected endpoint 2, got %d", ep.ID)
	}
}

func TestRouteSelectModelListEndpointIgnoresRouteFailoverLimit(t *testing.T) {
	route := model.RouteProfile{
		FailoverEnabled:     false,
		PreferredEndpointID: 3,
		Endpoints: []model.RouteEndpoint{
			{ID: 1, Priority: 1, Enabled: true, Status: model.RouteEndpointStatusNormal},
			{ID: 3, Priority: 3, Enabled: true, Status: model.RouteEndpointStatusNormal},
		},
	}

	ep, ok := RouteSelectModelListEndpoint(route)

	if !ok {
		t.Fatal("expected model list endpoint")
	}
	if ep.ID != 3 {
		t.Fatalf("expected preferred endpoint 3, got %d", ep.ID)
	}
}

func TestRouteRequestModelIsForwardedUnchanged(t *testing.T) {
	requestModel := "gpt-5.4"

	actual := RouteRequestModel(requestModel)

	if actual != requestModel {
		t.Fatalf("expected model %q to pass through unchanged, got %q", requestModel, actual)
	}
}

func TestRouteSelectCandidatesManualUsesPreferredThenPriority(t *testing.T) {
	route := model.RouteProfile{
		Mode:                model.RouteModeManual,
		PreferredEndpointID: 2,
		FailoverEnabled:     true,
		Endpoints: []model.RouteEndpoint{
			{ID: 1, Priority: 1, Enabled: true, Status: model.RouteEndpointStatusNormal},
			{ID: 2, Priority: 2, Enabled: true, Status: model.RouteEndpointStatusNormal},
			{ID: 3, Priority: 3, Enabled: true, Status: model.RouteEndpointStatusNormal},
		},
	}

	candidates := RouteSelectCandidates(route)

	if len(candidates) != 3 {
		t.Fatalf("expected 3 candidates, got %d", len(candidates))
	}
	if candidates[0].ID != 2 || candidates[1].ID != 1 || candidates[2].ID != 3 {
		t.Fatalf("expected order 2,1,3; got %d,%d,%d", candidates[0].ID, candidates[1].ID, candidates[2].ID)
	}
}

func TestRouteSelectCandidatesManualWithoutFailoverReturnsPreferredOnly(t *testing.T) {
	route := model.RouteProfile{
		Mode:                model.RouteModeManual,
		PreferredEndpointID: 2,
		FailoverEnabled:     false,
		Endpoints: []model.RouteEndpoint{
			{ID: 1, Priority: 1, Enabled: true, Status: model.RouteEndpointStatusNormal},
			{ID: 2, Priority: 2, Enabled: true, Status: model.RouteEndpointStatusNormal},
			{ID: 3, Priority: 3, Enabled: true, Status: model.RouteEndpointStatusNormal},
		},
	}

	candidates := RouteSelectCandidates(route)

	if len(candidates) != 1 {
		t.Fatalf("expected 1 candidate, got %d", len(candidates))
	}
	if candidates[0].ID != 2 {
		t.Fatalf("expected preferred endpoint 2, got %d", candidates[0].ID)
	}
}

func TestRouteSelectCandidatesWeightedWithoutFailoverReturnsSingleCandidate(t *testing.T) {
	route := model.RouteProfile{
		Mode:            model.RouteModeWeighted,
		FailoverEnabled: false,
		Endpoints: []model.RouteEndpoint{
			{ID: 1, Weight: 80, Enabled: true, Status: model.RouteEndpointStatusNormal},
			{ID: 2, Weight: 20, Enabled: true, Status: model.RouteEndpointStatusNormal},
			{ID: 3, Weight: 10, Enabled: true, Status: model.RouteEndpointStatusNormal},
		},
	}

	candidates := RouteSelectCandidates(route)

	if len(candidates) != 1 {
		t.Fatalf("expected 1 candidate, got %d", len(candidates))
	}
}

func TestRouteSelectCandidatesWeightedWithFailoverReturnsAllCandidates(t *testing.T) {
	route := model.RouteProfile{
		Mode:            model.RouteModeWeighted,
		FailoverEnabled: true,
		Endpoints: []model.RouteEndpoint{
			{ID: 1, Weight: 80, Enabled: true, Status: model.RouteEndpointStatusNormal},
			{ID: 2, Weight: 20, Enabled: true, Status: model.RouteEndpointStatusNormal},
			{ID: 3, Weight: 10, Enabled: true, Status: model.RouteEndpointStatusNormal},
		},
	}

	candidates := RouteSelectCandidates(route)

	if len(candidates) != 3 {
		t.Fatalf("expected 3 candidates, got %d", len(candidates))
	}
	seen := map[int]bool{}
	for _, candidate := range candidates {
		seen[candidate.ID] = true
	}
	for _, id := range []int{1, 2, 3} {
		if !seen[id] {
			t.Fatalf("expected candidate %d to be present", id)
		}
	}
}
