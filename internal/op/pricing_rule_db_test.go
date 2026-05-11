package op

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/bestruirui/octopus/internal/db"
	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/transformer/outbound"
)

func setupTestDB(t *testing.T) context.Context {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test.db")
	if err := db.InitDB("sqlite", dbPath, false); err != nil {
		t.Fatalf("init db: %v", err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Fatalf("close db: %v", err)
		}
	})
	if err := InitCache(); err != nil {
		t.Fatalf("init cache: %v", err)
	}
	return context.Background()
}

func TestChannelUpdatePersistsPricingRulesAsJSON(t *testing.T) {
	ctx := setupTestDB(t)

	channel := &model.Channel{
		Name:    "channel-json",
		Type:    outbound.OutboundTypeOpenAIChat,
		Enabled: true,
		Model:   "gpt-5.4",
		Keys: []model.ChannelKey{
			{
				Enabled:    true,
				ChannelKey: "sk-test",
				Remark:     "primary",
			},
		},
	}
	if err := ChannelCreate(channel, ctx); err != nil {
		t.Fatalf("create channel: %v", err)
	}

	keyRule := model.PricingRule{Enabled: true, Currency: "CNY"}
	channelRule := model.PricingRule{Enabled: false}
	updated, err := ChannelUpdate(&model.ChannelUpdateRequest{
		ID: channel.ID,
		KeysToUpdate: []model.ChannelKeyUpdateRequest{
			{ID: channel.Keys[0].ID, PricingRule: &keyRule},
		},
		PricingRule: &channelRule,
	}, ctx)
	if err != nil {
		t.Fatalf("update channel: %v", err)
	}

	gotKeyRule := updated.Keys[0].PricingRule
	if !gotKeyRule.Enabled {
		t.Fatalf("expected key pricing rule enabled")
	}
	if gotKeyRule.CurrencySymbol != model.DefaultPricingSymbol {
		t.Fatalf("expected key currency symbol %q, got %q", model.DefaultPricingSymbol, gotKeyRule.CurrencySymbol)
	}
	if gotKeyRule.Unit != model.DefaultPricingUnit {
		t.Fatalf("expected key unit %q, got %q", model.DefaultPricingUnit, gotKeyRule.Unit)
	}
	if gotKeyRule.Multiplier != model.DefaultPricingMultiplier {
		t.Fatalf("expected key multiplier %v, got %v", model.DefaultPricingMultiplier, gotKeyRule.Multiplier)
	}

	if updated.PricingRule.Enabled {
		t.Fatalf("expected channel pricing rule disabled")
	}
	if updated.PricingRule.Currency != "" {
		t.Fatalf("expected disabled channel pricing rule to keep empty currency, got %q", updated.PricingRule.Currency)
	}
}

func TestRouteProfileUpdatePersistsPricingOverrideAsJSON(t *testing.T) {
	ctx := setupTestDB(t)

	channel := &model.Channel{
		Name:    "route-channel",
		Type:    outbound.OutboundTypeOpenAIChat,
		Enabled: true,
		Model:   "gpt-5.4",
		Keys: []model.ChannelKey{
			{
				Enabled:    true,
				ChannelKey: "sk-route",
			},
		},
	}
	if err := ChannelCreate(channel, ctx); err != nil {
		t.Fatalf("create channel: %v", err)
	}

	route := &model.RouteProfile{
		Name: "route-json",
		Endpoints: []model.RouteEndpoint{
			{
				Name:         "ep-1",
				ChannelID:    channel.ID,
				ChannelKeyID: channel.Keys[0].ID,
				Enabled:      true,
			},
		},
	}
	if err := RouteProfileCreate(route, ctx); err != nil {
		t.Fatalf("create route: %v", err)
	}

	override := model.PricingRule{Enabled: true, Currency: "CNY"}
	result, err := RouteProfileUpdate(&model.RouteProfileUpdateRequest{
		ID: route.ID,
		EndpointsToUpdate: []model.RouteEndpointUpdateRequest{
			{
				ID:                  route.Endpoints[0].ID,
				PricingRuleOverride: &override,
			},
		},
	}, ctx)
	if err != nil {
		t.Fatalf("update route: %v", err)
	}

	got := result.Endpoints[0].PricingRuleOverride
	if !got.Enabled {
		t.Fatalf("expected pricing override enabled")
	}
	if got.CurrencySymbol != model.DefaultPricingSymbol {
		t.Fatalf("expected override currency symbol %q, got %q", model.DefaultPricingSymbol, got.CurrencySymbol)
	}
	if got.Unit != model.DefaultPricingUnit {
		t.Fatalf("expected override unit %q, got %q", model.DefaultPricingUnit, got.Unit)
	}
}
