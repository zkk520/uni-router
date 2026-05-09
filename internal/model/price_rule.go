package model

import "time"

type PriceRuleScope string

const (
	PriceRuleScopeGlobal        PriceRuleScope = "global"
	PriceRuleScopeChannel       PriceRuleScope = "channel"
	PriceRuleScopeChannelKey    PriceRuleScope = "channel_key"
	PriceRuleScopeProviderGroup PriceRuleScope = "provider_group"
)

type PriceBillingMode string

const (
	PriceBillingModeToken   PriceBillingMode = "token"
	PriceBillingModeRequest PriceBillingMode = "request"
	PriceBillingModeCustom  PriceBillingMode = "custom"
)

type PriceCurrency string

const (
	PriceCurrencyCNY    PriceCurrency = "CNY"
	PriceCurrencyUSD    PriceCurrency = "USD"
	PriceCurrencyCustom PriceCurrency = "CUSTOM"
)

type PriceUnit string

const (
	PriceUnitPer1MTokens PriceUnit = "per_1m_tokens"
	PriceUnitPerRequest  PriceUnit = "per_request"
)

type PriceRule struct {
	ID int `json:"id" gorm:"primaryKey"`

	ScopeType PriceRuleScope `json:"scope_type" gorm:"index:idx_price_rule_match,priority:1;not null"`
	ScopeID   int            `json:"scope_id" gorm:"index:idx_price_rule_match,priority:2"`

	ProviderName string `json:"provider_name" gorm:"index"`
	ModelName    string `json:"model_name" gorm:"index:idx_price_rule_match,priority:3;not null"`
	GroupName    string `json:"group_name" gorm:"index"`

	BillingMode PriceBillingMode `json:"billing_mode" gorm:"not null;default:token"`
	Currency    PriceCurrency    `json:"currency" gorm:"not null;default:USD"`
	Unit        PriceUnit        `json:"unit" gorm:"not null;default:per_1m_tokens"`

	InputPrice      float64 `json:"input_price"`
	OutputPrice     float64 `json:"output_price"`
	CacheReadPrice  float64 `json:"cache_read_price"`
	CacheWritePrice float64 `json:"cache_write_price"`
	RequestPrice    float64 `json:"request_price"`
	Multiplier      float64 `json:"multiplier" gorm:"not null;default:1"`

	SourceSite string    `json:"source_site"`
	SourceURL  string    `json:"source_url"`
	CapturedAt time.Time `json:"captured_at"`
	Raw        string    `json:"raw" gorm:"type:text"`
	CreatedAt  int64     `json:"created_at"`
	UpdatedAt  int64     `json:"updated_at"`
}
