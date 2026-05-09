package op

import (
	"testing"
	"time"

	"github.com/bestruirui/octopus/internal/model"
)

func TestResolvePriceRulePrefersChannelKeyOverChannelAndProviderGroup(t *testing.T) {
	now := time.Now()
	rules := []model.PriceRule{
		{
			ScopeType:      model.PriceRuleScopeProviderGroup,
			ProviderName:   "星辰AI",
			ModelName:      "gpt-5.5",
			GroupName:      "gpt-pro分组",
			Currency:       model.PriceCurrencyCNY,
			BillingMode:    model.PriceBillingModeToken,
			Unit:           model.PriceUnitPer1MTokens,
			InputPrice:     1,
			OutputPrice:    6,
			CacheReadPrice: 0.1,
			Multiplier:     1,
			CapturedAt:     now,
		},
		{
			ScopeType:      model.PriceRuleScopeChannel,
			ScopeID:        2,
			ModelName:      "gpt-5.5",
			Currency:       model.PriceCurrencyCNY,
			BillingMode:    model.PriceBillingModeToken,
			Unit:           model.PriceUnitPer1MTokens,
			InputPrice:     2,
			OutputPrice:    12,
			CacheReadPrice: 0.2,
			Multiplier:     1,
			CapturedAt:     now,
		},
		{
			ScopeType:      model.PriceRuleScopeChannelKey,
			ScopeID:        9,
			ModelName:      "gpt-5.5",
			Currency:       model.PriceCurrencyCNY,
			BillingMode:    model.PriceBillingModeToken,
			Unit:           model.PriceUnitPer1MTokens,
			InputPrice:     0.5,
			OutputPrice:    3,
			CacheReadPrice: 0.05,
			Multiplier:     1,
			CapturedAt:     now,
		},
	}

	rule, ok := resolvePriceRuleFromRules(rules, PriceRuleResolveRequest{
		ChannelID:    2,
		ChannelKeyID: 9,
		ModelName:    "gpt-5.5",
		ProviderName: "星辰AI",
		GroupName:    "gpt-pro分组",
	})
	if !ok {
		t.Fatal("expected a matching rule")
	}
	if rule.ScopeType != model.PriceRuleScopeChannelKey || rule.ScopeID != 9 {
		t.Fatalf("expected channel_key rule, got %+v", rule)
	}
}

func TestCalculateTokenCostUsesUncachedInputAndCacheRead(t *testing.T) {
	cost := CalculateTokenCost(model.PriceRule{
		BillingMode:    model.PriceBillingModeToken,
		Unit:           model.PriceUnitPer1MTokens,
		InputPrice:     5,
		OutputPrice:    30,
		CacheReadPrice: 0.5,
		Multiplier:     0.1,
	}, TokenUsageForPrice{
		InputTokens:     58778,
		OutputTokens:    1011,
		CacheReadTokens: 48076,
	})

	if diff := cost - 0.0107878; diff > 0.0000001 || diff < -0.0000001 {
		t.Fatalf("expected 0.0107878, got %.10f", cost)
	}
}
