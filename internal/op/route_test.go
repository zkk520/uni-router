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
