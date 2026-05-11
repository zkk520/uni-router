package model

const (
	DefaultPricingCurrency   = "CNY"
	DefaultPricingSymbol     = "¥"
	DefaultPricingUnit       = "1M Tokens"
	DefaultPricingSource     = "model_price"
	DefaultPricingMultiplier = 7.2
)

type PricingRule struct {
	Enabled        bool    `json:"enabled"`
	Currency       string  `json:"currency"`
	CurrencySymbol string  `json:"currency_symbol"`
	Unit           string  `json:"unit"`
	Multiplier     float64 `json:"multiplier"`
	BaseSource     string  `json:"base_source"`
}

type PricingInfo struct {
	Currency       string  `json:"currency"`
	CurrencySymbol string  `json:"currency_symbol"`
	Unit           string  `json:"unit"`
	Multiplier     float64 `json:"multiplier"`
	BaseSource     string  `json:"base_source"`
	RuleSource     string  `json:"rule_source"`
}

type CostCurrencyMetrics struct {
	Currency       string  `json:"currency"`
	CurrencySymbol string  `json:"currency_symbol"`
	InputCost      float64 `json:"input_cost"`
	OutputCost     float64 `json:"output_cost"`
	TotalCost      float64 `json:"total_cost"`
}

func DefaultPricingRule() PricingRule {
	return PricingRule{
		Enabled:        true,
		Currency:       DefaultPricingCurrency,
		CurrencySymbol: DefaultPricingSymbol,
		Unit:           DefaultPricingUnit,
		Multiplier:     DefaultPricingMultiplier,
		BaseSource:     DefaultPricingSource,
	}
}

func NormalizePricingRule(rule PricingRule) PricingRule {
	if rule.Currency == "" {
		rule.Currency = DefaultPricingCurrency
	}
	if rule.CurrencySymbol == "" {
		rule.CurrencySymbol = DefaultPricingSymbol
	}
	if rule.Unit == "" {
		rule.Unit = DefaultPricingUnit
	}
	if rule.Multiplier <= 0 {
		rule.Multiplier = DefaultPricingMultiplier
	}
	if rule.BaseSource == "" {
		rule.BaseSource = DefaultPricingSource
	}
	return rule
}

func CostCurrencyKey(currency string) string {
	if currency == "" {
		return DefaultPricingCurrency
	}
	return currency
}
