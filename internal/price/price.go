package price

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/bestruirui/octopus/internal/client"
	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/op"
	"github.com/bestruirui/octopus/internal/utils/log"
)

const llmPriceUrl = "https://models.dev/api.json"

var Provider = []string{
	"openai",     // GPT 系列
	"anthropic",  // Claude 系列
	"google",     // Gemini 系列
	"deepseek",   // DeepSeek 系列
	"xai",        // Grok 系列
	"alibaba",    // Qwen 系列
	"zhipuai",    // GLM 系列
	"minimax",    // MiniMax 系列
	"moonshotai", // Kimi/Moonshot
	"v0",         // v0 系列
}

var lastUpdateTime time.Time

func UpdateLLMPrice(ctx context.Context) error {
	log.Debugf("update LLM price task started")
	startTime := time.Now()
	defer func() {
		log.Debugf("update LLM price task finished, update time: %s", time.Since(startTime))
	}()
	client, err := client.GetHTTPClientSystemProxy(false)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, llmPriceUrl, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to fetch LLM info: %s", resp.Status)
	}
	var rawPrice map[string]struct {
		Models map[string]struct {
			ID   string         `json:"id"`
			Cost model.LLMPrice `json:"cost"`
		} `json:"models"`
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response body: %w", err)
	}
	if err := json.Unmarshal(body, &rawPrice); err != nil {
		return fmt.Errorf("failed to parse LLM info: %w", err)
	}
	llmPriceLock.Lock()
	for _, provider := range Provider {
		for _, model := range rawPrice[provider].Models {
			model.ID = strings.ToLower(model.ID)
			llmPrice[model.ID] = model.Cost
		}
	}
	llmPriceLock.Unlock()
	lastUpdateTime = time.Now()
	return nil
}

func GetLastUpdateTime() time.Time {
	return lastUpdateTime
}

func ListLLMPricePresets() []model.LLMInfo {
	llmPriceLock.RLock()
	defer llmPriceLock.RUnlock()

	presets := make([]model.LLMInfo, 0, len(llmPrice))
	for name, price := range llmPrice {
		presets = append(presets, model.LLMInfo{
			Name:     name,
			LLMPrice: price,
		})
	}
	sort.Slice(presets, func(i, j int) bool {
		return presets[i].Name < presets[j].Name
	})
	return presets
}

func GetLLMPrice(modelName string) *model.LLMPrice {
	modelName = strings.ToLower(modelName)
	price, err := op.LLMGet(modelName)
	if err == nil {
		return &price
	}
	llmPriceLock.RLock()
	defer llmPriceLock.RUnlock()
	price, ok := llmPrice[modelName]
	if !ok {
		return nil
	}
	return &price
}

type ResolvedLLMPrice struct {
	BasePrice model.LLMPrice    `json:"base_price"`
	Price     model.LLMPrice    `json:"price"`
	Info      model.PricingInfo `json:"pricing_info"`
}

func ResolveLLMPrice(modelName string, channel *model.Channel, key *model.ChannelKey) *ResolvedLLMPrice {
	basePrice := GetLLMPrice(modelName)
	if basePrice == nil {
		return nil
	}
	rule := resolvePricingRule(channel, key)
	price := model.LLMPrice{
		Input:      basePrice.Input * rule.Multiplier,
		Output:     basePrice.Output * rule.Multiplier,
		CacheRead:  basePrice.CacheRead * rule.Multiplier,
		CacheWrite: basePrice.CacheWrite * rule.Multiplier,
	}
	return &ResolvedLLMPrice{
		BasePrice: *basePrice,
		Price:     price,
		Info: model.PricingInfo{
			Currency:       rule.Currency,
			CurrencySymbol: rule.CurrencySymbol,
			Unit:           rule.Unit,
			Multiplier:     rule.Multiplier,
			BaseSource:     rule.BaseSource,
			RuleSource:     pricingRuleSource(channel, key),
		},
	}
}

func resolvePricingRule(channel *model.Channel, key *model.ChannelKey) model.PricingRule {
	if key != nil && key.PricingRule.Enabled {
		rule := model.NormalizePricingRule(key.PricingRule)
		rule.Enabled = true
		return rule
	}
	if channel != nil && channel.PricingRule.Enabled {
		return model.NormalizePricingRule(channel.PricingRule)
	}
	return model.DefaultPricingRule()
}

func pricingRuleSource(channel *model.Channel, key *model.ChannelKey) string {
	if key != nil && key.PricingRule.Enabled {
		return "channel_key"
	}
	if channel != nil && channel.PricingRule.Enabled {
		return "channel_default"
	}
	return "system_default"
}
