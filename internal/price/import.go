package price

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/bestruirui/octopus/internal/model"
)

type PriceImportParseRequest struct {
	Template string `json:"template"`
	Content  string `json:"content"`
}

type PriceImportSource struct {
	Site          string    `json:"site"`
	URL           string    `json:"url"`
	CapturedAt    time.Time `json:"captured_at"`
	CaptureMethod string    `json:"capture_method"`
}

type PriceImportModel struct {
	Name   string             `json:"name"`
	Groups []PriceImportGroup `json:"groups"`
}

type PriceImportGroup struct {
	Name        string  `json:"name"`
	BillingMode string  `json:"billing_mode"`
	Currency    string  `json:"currency"`
	Unit        string  `json:"unit"`
	Input       float64 `json:"input"`
	Output      float64 `json:"output"`
	CacheRead   float64 `json:"cache_read"`
	CacheWrite  float64 `json:"cache_write"`
	Request     float64 `json:"request"`
	Multiplier  float64 `json:"multiplier"`
}

type PriceImportDocument struct {
	Version int                `json:"version"`
	Source  PriceImportSource  `json:"source"`
	Models  []PriceImportModel `json:"models"`
}

type PriceImportRule struct {
	ProviderName    string    `json:"provider_name"`
	ModelName       string    `json:"model_name"`
	GroupName       string    `json:"group_name"`
	BillingMode     string    `json:"billing_mode"`
	Currency        string    `json:"currency"`
	Unit            string    `json:"unit"`
	InputPrice      float64   `json:"input_price"`
	OutputPrice     float64   `json:"output_price"`
	CacheReadPrice  float64   `json:"cache_read_price"`
	CacheWritePrice float64   `json:"cache_write_price"`
	RequestPrice    float64   `json:"request_price"`
	Multiplier      float64   `json:"multiplier"`
	SourceSite      string    `json:"source_site"`
	SourceURL       string    `json:"source_url"`
	CapturedAt      time.Time `json:"captured_at"`
	Raw             string    `json:"raw,omitempty"`
}

type PriceImportParseResult struct {
	Rules    []PriceImportRule `json:"rules"`
	Warnings []string          `json:"warnings"`
}

func ParsePriceImport(req PriceImportParseRequest) (PriceImportParseResult, error) {
	template := strings.ToLower(strings.TrimSpace(req.Template))
	content := strings.TrimSpace(req.Content)
	if content == "" {
		return PriceImportParseResult{}, fmt.Errorf("content is required")
	}
	switch template {
	case "", "auto":
		if looksLikeJSON(content) {
			return parseStandardJSON(content)
		}
		return parseNewAPIText(content)
	case "standard_json":
		return parseStandardJSON(content)
	case "new_api_text", "generic_table":
		return parseNewAPIText(content)
	default:
		return PriceImportParseResult{}, fmt.Errorf("unsupported template: %s", req.Template)
	}
}

func PriceImportRuleToModel(rule PriceImportRule, scopeType model.PriceRuleScope, scopeID int) model.PriceRule {
	now := time.Now().Unix()
	capturedAt := rule.CapturedAt
	if capturedAt.IsZero() {
		capturedAt = time.Now()
	}
	multiplier := rule.Multiplier
	if multiplier == 0 {
		multiplier = 1
	}
	billingMode := model.PriceBillingMode(rule.BillingMode)
	if billingMode == "" {
		billingMode = model.PriceBillingModeToken
	}
	currency := model.PriceCurrency(rule.Currency)
	if currency == "" {
		currency = model.PriceCurrencyUSD
	}
	unit := model.PriceUnit(rule.Unit)
	if unit == "" {
		unit = model.PriceUnitPer1MTokens
	}
	return model.PriceRule{
		ScopeType:       scopeType,
		ScopeID:         scopeID,
		ProviderName:    rule.ProviderName,
		ModelName:       strings.ToLower(strings.TrimSpace(rule.ModelName)),
		GroupName:       rule.GroupName,
		BillingMode:     billingMode,
		Currency:        currency,
		Unit:            unit,
		InputPrice:      rule.InputPrice,
		OutputPrice:     rule.OutputPrice,
		CacheReadPrice:  rule.CacheReadPrice,
		CacheWritePrice: rule.CacheWritePrice,
		RequestPrice:    rule.RequestPrice,
		Multiplier:      multiplier,
		SourceSite:      rule.SourceSite,
		SourceURL:       rule.SourceURL,
		CapturedAt:      capturedAt,
		Raw:             rule.Raw,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
}

func parseStandardJSON(content string) (PriceImportParseResult, error) {
	var doc PriceImportDocument
	if err := json.Unmarshal([]byte(content), &doc); err != nil {
		return PriceImportParseResult{}, err
	}
	if doc.Version != 1 {
		return PriceImportParseResult{}, fmt.Errorf("unsupported price import version: %d", doc.Version)
	}
	result := PriceImportParseResult{}
	provider := doc.Source.Site
	if provider == "" {
		provider = hostFromURL(doc.Source.URL)
	}
	for _, m := range doc.Models {
		modelName := strings.TrimSpace(m.Name)
		if modelName == "" {
			result.Warnings = append(result.Warnings, "skip model with empty name")
			continue
		}
		for _, g := range m.Groups {
			rule := PriceImportRule{
				ProviderName:    provider,
				ModelName:       modelName,
				GroupName:       strings.TrimSpace(g.Name),
				BillingMode:     normalizeBillingMode(g.BillingMode),
				Currency:        normalizeCurrency(g.Currency),
				Unit:            normalizeUnit(g.Unit),
				InputPrice:      g.Input,
				OutputPrice:     g.Output,
				CacheReadPrice:  g.CacheRead,
				CacheWritePrice: g.CacheWrite,
				RequestPrice:    g.Request,
				Multiplier:      normalizeMultiplier(g.Multiplier),
				SourceSite:      doc.Source.Site,
				SourceURL:       doc.Source.URL,
				CapturedAt:      doc.Source.CapturedAt,
				Raw:             content,
			}
			if g.CacheWrite == 0 {
				result.Warnings = append(result.Warnings, fmt.Sprintf("%s/%s missing cache_write, default to 0", modelName, rule.GroupName))
			}
			result.Rules = append(result.Rules, rule)
		}
	}
	return result, nil
}

func parseNewAPIText(content string) (PriceImportParseResult, error) {
	lines := normalizeLines(content)
	modelName := firstModelName(lines)
	if modelName == "" {
		return PriceImportParseResult{}, fmt.Errorf("model name not found")
	}
	result := PriceImportParseResult{}
	groupRe := regexp.MustCompile(`^\s*([^\s]+分组)(?:\s|$)`)
	priceRe := regexp.MustCompile(`(输入\s*价格|补全价格|输出价格|缓存读取价格|缓存创建价格|缓存写入价格|模型价格)\s*([¥$￥])\s*([0-9]+(?:\.[0-9]+)?)`)
	var current *PriceImportRule
	flush := func() {
		if current == nil {
			return
		}
		if current.CacheWritePrice == 0 {
			result.Warnings = append(result.Warnings, fmt.Sprintf("%s/%s missing cache_write, default to 0", current.ModelName, current.GroupName))
		}
		result.Rules = append(result.Rules, *current)
		current = nil
	}
	for _, line := range lines {
		if match := groupRe.FindStringSubmatch(line); len(match) == 2 {
			flush()
			current = &PriceImportRule{
				ModelName:   modelName,
				GroupName:   strings.TrimSpace(match[1]),
				BillingMode: string(model.PriceBillingModeToken),
				Currency:    string(model.PriceCurrencyCNY),
				Unit:        string(model.PriceUnitPer1MTokens),
				Multiplier:  1,
				Raw:         content,
			}
		}
		if current == nil {
			continue
		}
		if match := priceRe.FindStringSubmatch(line); len(match) == 4 {
			currency := normalizeCurrency(match[2])
			if currency != "" {
				current.Currency = currency
			}
			value, _ := strconv.ParseFloat(match[3], 64)
			switch strings.ReplaceAll(match[1], " ", "") {
			case "输入价格":
				current.InputPrice = value
			case "补全价格", "输出价格":
				current.OutputPrice = value
			case "缓存读取价格":
				current.CacheReadPrice = value
			case "缓存创建价格", "缓存写入价格":
				current.CacheWritePrice = value
			case "模型价格":
				current.RequestPrice = value
				current.BillingMode = string(model.PriceBillingModeRequest)
				current.Unit = string(model.PriceUnitPerRequest)
			}
		}
	}
	flush()
	if len(result.Rules) == 0 {
		return PriceImportParseResult{}, fmt.Errorf("price rules not found")
	}
	return result, nil
}

func normalizeLines(content string) []string {
	content = strings.ReplaceAll(content, "\r\n", "\n")
	content = strings.ReplaceAll(content, "\r", "\n")
	raw := strings.Split(content, "\n")
	lines := make([]string, 0, len(raw))
	for _, line := range raw {
		line = strings.TrimSpace(strings.Join(strings.Fields(line), " "))
		if line != "" {
			lines = append(lines, line)
		}
	}
	return lines
}

func firstModelName(lines []string) string {
	modelRe := regexp.MustCompile(`(?i)\b([a-z0-9][a-z0-9._:-]*(?:gpt|claude|gemini|qwen|deepseek|grok|codex)[a-z0-9._:-]*|gpt-[a-z0-9._:-]+)\b`)
	for _, line := range lines {
		if match := modelRe.FindStringSubmatch(line); len(match) == 2 {
			return strings.ToLower(match[1])
		}
	}
	return ""
}

func looksLikeJSON(content string) bool {
	return strings.HasPrefix(content, "{") || strings.HasPrefix(content, "[")
}

func normalizeBillingMode(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	switch value {
	case "", "token", "tokens", "按量计费":
		return string(model.PriceBillingModeToken)
	case "request", "per_request", "按次计费":
		return string(model.PriceBillingModeRequest)
	default:
		return string(model.PriceBillingModeCustom)
	}
}

func normalizeCurrency(value string) string {
	value = strings.ToUpper(strings.TrimSpace(value))
	switch value {
	case "¥", "￥", "CNY", "RMB":
		return string(model.PriceCurrencyCNY)
	case "$", "USD":
		return string(model.PriceCurrencyUSD)
	case "":
		return string(model.PriceCurrencyUSD)
	default:
		return string(model.PriceCurrencyCustom)
	}
}

func normalizeUnit(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	switch value {
	case "", "per_1m_tokens", "/ 1m tokens", "1m tokens":
		return string(model.PriceUnitPer1MTokens)
	case "per_request", "/次", "次":
		return string(model.PriceUnitPerRequest)
	default:
		return value
	}
}

func normalizeMultiplier(value float64) float64 {
	if value == 0 {
		return 1
	}
	return value
}

func hostFromURL(value string) string {
	value = strings.TrimSpace(value)
	value = strings.TrimPrefix(value, "https://")
	value = strings.TrimPrefix(value, "http://")
	if idx := strings.Index(value, "/"); idx >= 0 {
		return value[:idx]
	}
	return value
}
