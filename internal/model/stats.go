package model

type StatsMetrics struct {
	InputToken           int64                          `json:"input_token" gorm:"bigint"`
	OutputToken          int64                          `json:"output_token" gorm:"bigint"`
	InputCost            float64                        `json:"input_cost" gorm:"type:real"`
	OutputCost           float64                        `json:"output_cost" gorm:"type:real"`
	InputCostByCurrency  map[string]CostCurrencyMetrics `json:"input_cost_by_currency,omitempty" gorm:"serializer:json"`
	OutputCostByCurrency map[string]CostCurrencyMetrics `json:"output_cost_by_currency,omitempty" gorm:"serializer:json"`
	TotalCostByCurrency  map[string]CostCurrencyMetrics `json:"total_cost_by_currency,omitempty" gorm:"serializer:json"`
	WaitTime             int64                          `json:"wait_time" gorm:"bigint"`
	RequestSuccess       int64                          `json:"request_success" gorm:"bigint"`
	RequestFailed        int64                          `json:"request_failed" gorm:"bigint"`
}

type StatsTotal struct {
	ID int `gorm:"primaryKey"`
	StatsMetrics
}

type StatsHourly struct {
	Hour int    `json:"hour" gorm:"primaryKey"`
	Date string `json:"date" gorm:"not null"` // 记录最后更新日期，格式：20060102
	StatsMetrics
}

type StatsDaily struct {
	Date string `json:"date" gorm:"primaryKey"`
	StatsMetrics
}

type StatsModel struct {
	ID        int    `json:"id" gorm:"primaryKey"`
	Name      string `json:"name" gorm:"not null;uniqueIndex:idx_stats_model_name_channel"`
	ChannelID int    `json:"channel_id" gorm:"not null;uniqueIndex:idx_stats_model_name_channel"`
	StatsMetrics
}

type StatsChannel struct {
	ChannelID int `json:"channel_id" gorm:"primaryKey"`
	StatsMetrics
}

type StatsChannelKey struct {
	ChannelKeyID int `json:"channel_key_id" gorm:"primaryKey"`
	StatsMetrics
}

type StatsAPIKey struct {
	APIKeyID int `json:"api_key_id" gorm:"primaryKey"`
	StatsMetrics
}

// Add aggregates another StatsMetrics into the current one.
func (s *StatsMetrics) Add(delta StatsMetrics) {
	s.InputToken += delta.InputToken
	s.OutputToken += delta.OutputToken
	s.InputCost += delta.InputCost
	s.OutputCost += delta.OutputCost
	mergeCostCurrencyMetrics(&s.InputCostByCurrency, delta.InputCostByCurrency)
	mergeCostCurrencyMetrics(&s.OutputCostByCurrency, delta.OutputCostByCurrency)
	mergeCostCurrencyMetrics(&s.TotalCostByCurrency, delta.TotalCostByCurrency)
	s.WaitTime += delta.WaitTime
	s.RequestSuccess += delta.RequestSuccess
	s.RequestFailed += delta.RequestFailed
}

func (s *StatsMetrics) AddCurrencyCosts(info PricingInfo, inputCost, outputCost float64) {
	key := CostCurrencyKey(info.Currency)
	value := CostCurrencyMetrics{
		Currency:       key,
		CurrencySymbol: info.CurrencySymbol,
		InputCost:      inputCost,
		OutputCost:     outputCost,
		TotalCost:      inputCost + outputCost,
	}
	addCostCurrencyMetric(&s.InputCostByCurrency, key, CostCurrencyMetrics{
		Currency:       key,
		CurrencySymbol: info.CurrencySymbol,
		InputCost:      inputCost,
		TotalCost:      inputCost,
	})
	addCostCurrencyMetric(&s.OutputCostByCurrency, key, CostCurrencyMetrics{
		Currency:       key,
		CurrencySymbol: info.CurrencySymbol,
		OutputCost:     outputCost,
		TotalCost:      outputCost,
	})
	addCostCurrencyMetric(&s.TotalCostByCurrency, key, value)
}

func mergeCostCurrencyMetrics(dst *map[string]CostCurrencyMetrics, src map[string]CostCurrencyMetrics) {
	for key, value := range src {
		addCostCurrencyMetric(dst, key, value)
	}
}

func addCostCurrencyMetric(dst *map[string]CostCurrencyMetrics, key string, value CostCurrencyMetrics) {
	if key == "" {
		key = CostCurrencyKey(value.Currency)
	}
	if *dst == nil {
		*dst = make(map[string]CostCurrencyMetrics)
	}
	current := (*dst)[key]
	if current.Currency == "" {
		current.Currency = key
	}
	if current.CurrencySymbol == "" {
		current.CurrencySymbol = value.CurrencySymbol
	}
	current.InputCost += value.InputCost
	current.OutputCost += value.OutputCost
	current.TotalCost += value.TotalCost
	(*dst)[key] = current
}
