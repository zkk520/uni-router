package op

import (
	"testing"

	"github.com/bestruirui/octopus/internal/model"
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
