package op

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/bestruirui/octopus/internal/db"
	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/utils/cache"
	"gorm.io/gorm"
)

var priceRuleCache = cache.New[int, model.PriceRule](16)

type PriceRuleResolveRequest struct {
	ChannelID    int
	ChannelKeyID int
	ModelName    string
	ProviderName string
	GroupName    string
}

type TokenUsageForPrice struct {
	InputTokens      int
	OutputTokens     int
	CacheReadTokens  int
	CacheWriteTokens int
}

func PriceRuleList(ctx context.Context) ([]model.PriceRule, error) {
	rules := make([]model.PriceRule, 0, priceRuleCache.Len())
	for _, rule := range priceRuleCache.GetAll() {
		rules = append(rules, rule)
	}
	sort.SliceStable(rules, func(i, j int) bool {
		return rules[i].ID < rules[j].ID
	})
	return rules, nil
}

func PriceRuleUpsert(rule model.PriceRule, ctx context.Context) (model.PriceRule, error) {
	normalizePriceRule(&rule)
	if rule.ModelName == "" {
		return model.PriceRule{}, fmt.Errorf("model_name is required")
	}
	if rule.ScopeType == "" {
		rule.ScopeType = model.PriceRuleScopeGlobal
	}
	if rule.ID == 0 {
		existing := model.PriceRule{}
		query := db.GetDB().WithContext(ctx).
			Where("scope_type = ? AND scope_id = ? AND model_name = ?", rule.ScopeType, rule.ScopeID, rule.ModelName)
		if rule.ScopeType == model.PriceRuleScopeProviderGroup {
			query = query.Where("group_name = ?", rule.GroupName)
		}
		err := query.First(&existing).Error
		if err == nil {
			rule.ID = existing.ID
			rule.CreatedAt = existing.CreatedAt
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return model.PriceRule{}, err
		}
	}
	now := time.Now().Unix()
	if rule.ID == 0 && rule.CreatedAt == 0 {
		rule.CreatedAt = now
	}
	rule.UpdatedAt = now
	if err := db.GetDB().WithContext(ctx).Save(&rule).Error; err != nil {
		return model.PriceRule{}, err
	}
	priceRuleCache.Set(rule.ID, rule)
	return rule, nil
}

func PriceRuleBatchUpsert(rules []model.PriceRule, ctx context.Context) ([]model.PriceRule, error) {
	result := make([]model.PriceRule, 0, len(rules))
	for _, rule := range rules {
		saved, err := PriceRuleUpsert(rule, ctx)
		if err != nil {
			return nil, err
		}
		result = append(result, saved)
	}
	return result, nil
}

func PriceRuleDelete(id int, ctx context.Context) error {
	result := db.GetDB().WithContext(ctx).Delete(&model.PriceRule{ID: id})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("price rule not found")
	}
	priceRuleCache.Del(id)
	return nil
}

func ResolvePriceRule(req PriceRuleResolveRequest) (model.PriceRule, bool) {
	rules := make([]model.PriceRule, 0, priceRuleCache.Len())
	for _, rule := range priceRuleCache.GetAll() {
		rules = append(rules, rule)
	}
	return resolvePriceRuleFromRules(rules, req)
}

func resolvePriceRuleFromRules(rules []model.PriceRule, req PriceRuleResolveRequest) (model.PriceRule, bool) {
	modelName := strings.ToLower(strings.TrimSpace(req.ModelName))
	if modelName == "" {
		return model.PriceRule{}, false
	}
	bestRank := -1
	var best model.PriceRule
	for _, rule := range rules {
		if strings.ToLower(strings.TrimSpace(rule.ModelName)) != modelName {
			continue
		}
		rank := priceRuleMatchRank(rule, req)
		if rank > bestRank {
			bestRank = rank
			best = rule
		}
	}
	return best, bestRank >= 0
}

func priceRuleMatchRank(rule model.PriceRule, req PriceRuleResolveRequest) int {
	switch rule.ScopeType {
	case model.PriceRuleScopeChannelKey:
		if rule.ScopeID == req.ChannelKeyID && req.ChannelKeyID > 0 {
			return 4
		}
	case model.PriceRuleScopeChannel:
		if rule.ScopeID == req.ChannelID && req.ChannelID > 0 {
			return 3
		}
	case model.PriceRuleScopeProviderGroup:
		if sameOptionalText(rule.ProviderName, req.ProviderName) && sameOptionalText(rule.GroupName, req.GroupName) {
			return 2
		}
	case model.PriceRuleScopeGlobal:
		return 1
	}
	return -1
}

func CalculateTokenCost(rule model.PriceRule, usage TokenUsageForPrice) float64 {
	multiplier := rule.Multiplier
	if multiplier == 0 {
		multiplier = 1
	}
	if rule.BillingMode == model.PriceBillingModeRequest || rule.Unit == model.PriceUnitPerRequest {
		return rule.RequestPrice * multiplier
	}
	inputTokens := usage.InputTokens - usage.CacheReadTokens
	if inputTokens < 0 {
		inputTokens = 0
	}
	cost := (float64(inputTokens)*rule.InputPrice +
		float64(usage.CacheReadTokens)*rule.CacheReadPrice +
		float64(usage.CacheWriteTokens)*rule.CacheWritePrice +
		float64(usage.OutputTokens)*rule.OutputPrice) / 1_000_000
	return cost * multiplier
}

func priceRuleRefreshCache(ctx context.Context) error {
	rules := []model.PriceRule{}
	if err := db.GetDB().WithContext(ctx).Find(&rules).Error; err != nil {
		return err
	}
	priceRuleCache.Clear()
	for _, rule := range rules {
		normalizePriceRule(&rule)
		priceRuleCache.Set(rule.ID, rule)
	}
	return nil
}

func normalizePriceRule(rule *model.PriceRule) {
	rule.ModelName = strings.ToLower(strings.TrimSpace(rule.ModelName))
	rule.ProviderName = strings.TrimSpace(rule.ProviderName)
	rule.GroupName = strings.TrimSpace(rule.GroupName)
	if rule.BillingMode == "" {
		rule.BillingMode = model.PriceBillingModeToken
	}
	if rule.Currency == "" {
		rule.Currency = model.PriceCurrencyUSD
	}
	if rule.Unit == "" {
		rule.Unit = model.PriceUnitPer1MTokens
	}
	if rule.Multiplier == 0 {
		rule.Multiplier = 1
	}
}

func sameOptionalText(ruleValue, requestValue string) bool {
	ruleValue = strings.TrimSpace(ruleValue)
	requestValue = strings.TrimSpace(requestValue)
	return ruleValue == "" || requestValue == "" || strings.EqualFold(ruleValue, requestValue)
}
