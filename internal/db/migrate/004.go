package migrate

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/zkk520/uni-router/internal/model"
	"gorm.io/gorm"
)

const usdToCNYForLegacyCosts = 7.2

func init() {
	RegisterAfterAutoMigration(Migration{
		Version: 4,
		Up:      migrateLegacyUSDCostsToCNY,
	})
}

// 004: default pricing switched from USD to CNY. Existing cost scalars were
// previously recorded in USD, so migrate persisted logs/stats to the new
// default display currency while preserving request/log history.
func migrateLegacyUSDCostsToCNY(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("db is nil")
	}
	return db.Transaction(func(tx *gorm.DB) error {
		if err := migrateRelayLogsToCNY(tx); err != nil {
			return err
		}
		if err := migrateStatsTotalToCNY(tx); err != nil {
			return err
		}
		if err := migrateStatsDailyToCNY(tx); err != nil {
			return err
		}
		if err := migrateStatsHourlyToCNY(tx); err != nil {
			return err
		}
		if err := migrateStatsModelToCNY(tx); err != nil {
			return err
		}
		if err := migrateStatsChannelToCNY(tx); err != nil {
			return err
		}
		if err := migrateStatsChannelKeyToCNY(tx); err != nil {
			return err
		}
		if err := migrateStatsAPIKeyToCNY(tx); err != nil {
			return err
		}
		if err := migrateChannelPricingRulesToCNY(tx); err != nil {
			return err
		}
		return tx.Exec("UPDATE channel_keys SET total_cost = total_cost * ? WHERE total_cost <> 0", usdToCNYForLegacyCosts).Error
	})
}

func migrateChannelPricingRulesToCNY(tx *gorm.DB) error {
	var channels []model.Channel
	if err := tx.Find(&channels).Error; err != nil {
		return fmt.Errorf("read channels: %w", err)
	}
	for i := range channels {
		if !legacyPricingRuleNeedsCNY(channels[i].PricingRule) {
			continue
		}
		channels[i].PricingRule = model.DefaultPricingRule()
		channels[i].PricingRule.Enabled = false
		pricingRuleJSON, err := json.Marshal(channels[i].PricingRule)
		if err != nil {
			return fmt.Errorf("marshal channel pricing_rule %d: %w", channels[i].ID, err)
		}
		if err := tx.Model(&model.Channel{}).Where("id = ?", channels[i].ID).Update("pricing_rule", pricingRuleJSON).Error; err != nil {
			return fmt.Errorf("update channel pricing_rule %d: %w", channels[i].ID, err)
		}
	}

	var keys []model.ChannelKey
	if err := tx.Find(&keys).Error; err != nil {
		return fmt.Errorf("read channel_keys: %w", err)
	}
	for i := range keys {
		if !legacyPricingRuleNeedsCNY(keys[i].PricingRule) {
			continue
		}
		keys[i].PricingRule = model.DefaultPricingRule()
		keys[i].PricingRule.Enabled = false
		pricingRuleJSON, err := json.Marshal(keys[i].PricingRule)
		if err != nil {
			return fmt.Errorf("marshal channel_key pricing_rule %d: %w", keys[i].ID, err)
		}
		if err := tx.Model(&model.ChannelKey{}).Where("id = ?", keys[i].ID).Update("pricing_rule", pricingRuleJSON).Error; err != nil {
			return fmt.Errorf("update channel_key pricing_rule %d: %w", keys[i].ID, err)
		}
	}
	return nil
}

func migrateRelayLogsToCNY(tx *gorm.DB) error {
	var logs []model.RelayLog
	if err := tx.Find(&logs).Error; err != nil {
		return fmt.Errorf("read relay_logs: %w", err)
	}
	for i := range logs {
		log := &logs[i]
		if !legacyCurrencyNeedsCNY(log.CostCurrency, log.TotalCostByCurrency) {
			continue
		}
		inputCost := 0.0
		outputCost := 0.0
		if log.TotalCostByCurrency != nil {
			inputCost = legacyCostFromCurrencyMap(log.InputCostByCurrency, log.Cost)
			outputCost = legacyCostFromCurrencyMap(log.OutputCostByCurrency, 0)
		}
		if inputCost == 0 && outputCost == 0 {
			inputCost = log.Cost
		}
		inputCNY := inputCost * usdToCNYForLegacyCosts
		outputCNY := outputCost * usdToCNYForLegacyCosts
		log.Cost = (inputCost + outputCost) * usdToCNYForLegacyCosts
		log.CostCurrency = model.DefaultPricingCurrency
		log.CostCurrencySymbol = model.DefaultPricingSymbol
		if log.PricingMultiplier > 0 && log.PricingMultiplier < usdToCNYForLegacyCosts {
			log.PricingMultiplier *= usdToCNYForLegacyCosts
		} else {
			log.PricingMultiplier = model.DefaultPricingMultiplier
		}
		log.InputCostByCurrency = cnyCostMap(inputCNY, 0)
		log.OutputCostByCurrency = cnyCostMap(0, outputCNY)
		log.TotalCostByCurrency = cnyCostMap(inputCNY, outputCNY)
		if err := tx.Save(log).Error; err != nil {
			return fmt.Errorf("save relay_log %d: %w", log.ID, err)
		}
	}
	return nil
}

func migrateStatsTotalToCNY(tx *gorm.DB) error {
	var rows []model.StatsTotal
	if err := tx.Find(&rows).Error; err != nil {
		return fmt.Errorf("read stats_total: %w", err)
	}
	for i := range rows {
		if convertStatsMetricsToCNY(&rows[i].StatsMetrics) {
			if err := tx.Save(&rows[i]).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

func migrateStatsDailyToCNY(tx *gorm.DB) error {
	var rows []model.StatsDaily
	if err := tx.Find(&rows).Error; err != nil {
		return fmt.Errorf("read stats_daily: %w", err)
	}
	for i := range rows {
		if convertStatsMetricsToCNY(&rows[i].StatsMetrics) {
			if err := tx.Save(&rows[i]).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

func migrateStatsHourlyToCNY(tx *gorm.DB) error {
	var rows []model.StatsHourly
	if err := tx.Find(&rows).Error; err != nil {
		return fmt.Errorf("read stats_hourly: %w", err)
	}
	for i := range rows {
		if convertStatsMetricsToCNY(&rows[i].StatsMetrics) {
			if err := tx.Save(&rows[i]).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

func migrateStatsModelToCNY(tx *gorm.DB) error {
	var rows []model.StatsModel
	if err := tx.Find(&rows).Error; err != nil {
		return fmt.Errorf("read stats_model: %w", err)
	}
	for i := range rows {
		if convertStatsMetricsToCNY(&rows[i].StatsMetrics) {
			if err := tx.Save(&rows[i]).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

func migrateStatsChannelToCNY(tx *gorm.DB) error {
	var rows []model.StatsChannel
	if err := tx.Find(&rows).Error; err != nil {
		return fmt.Errorf("read stats_channel: %w", err)
	}
	for i := range rows {
		if convertStatsMetricsToCNY(&rows[i].StatsMetrics) {
			if err := tx.Save(&rows[i]).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

func migrateStatsChannelKeyToCNY(tx *gorm.DB) error {
	var rows []model.StatsChannelKey
	if err := tx.Find(&rows).Error; err != nil {
		return fmt.Errorf("read stats_channel_key: %w", err)
	}
	for i := range rows {
		if convertStatsMetricsToCNY(&rows[i].StatsMetrics) {
			if err := tx.Save(&rows[i]).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

func migrateStatsAPIKeyToCNY(tx *gorm.DB) error {
	var rows []model.StatsAPIKey
	if err := tx.Find(&rows).Error; err != nil {
		return fmt.Errorf("read stats_api_key: %w", err)
	}
	for i := range rows {
		if convertStatsMetricsToCNY(&rows[i].StatsMetrics) {
			if err := tx.Save(&rows[i]).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

func convertStatsMetricsToCNY(metrics *model.StatsMetrics) bool {
	if metrics == nil || hasCNYCost(metrics.TotalCostByCurrency) {
		return false
	}
	inputUSD := legacyCostFromCurrencyMap(metrics.InputCostByCurrency, metrics.InputCost)
	outputUSD := legacyCostFromCurrencyMap(metrics.OutputCostByCurrency, metrics.OutputCost)
	inputCNY := inputUSD * usdToCNYForLegacyCosts
	outputCNY := outputUSD * usdToCNYForLegacyCosts
	metrics.InputCost = inputCNY
	metrics.OutputCost = outputCNY
	metrics.InputCostByCurrency = cnyCostMap(inputCNY, 0)
	metrics.OutputCostByCurrency = cnyCostMap(0, outputCNY)
	metrics.TotalCostByCurrency = cnyCostMap(inputCNY, outputCNY)
	return inputCNY != 0 || outputCNY != 0
}

func legacyCurrencyNeedsCNY(currency string, costs map[string]model.CostCurrencyMetrics) bool {
	if hasCNYCost(costs) {
		return false
	}
	return currency == "" || strings.EqualFold(currency, "USD")
}

func legacyPricingRuleNeedsCNY(rule model.PricingRule) bool {
	if rule.Enabled {
		return false
	}
	currency := strings.TrimSpace(rule.Currency)
	symbol := strings.TrimSpace(rule.CurrencySymbol)
	return currency == "" || strings.EqualFold(currency, "USD") || symbol == "" || symbol == "$"
}

func hasCNYCost(costs map[string]model.CostCurrencyMetrics) bool {
	for key, value := range costs {
		if strings.EqualFold(key, model.DefaultPricingCurrency) || strings.EqualFold(value.Currency, model.DefaultPricingCurrency) {
			return true
		}
	}
	return false
}

func legacyCostFromCurrencyMap(costs map[string]model.CostCurrencyMetrics, fallback float64) float64 {
	if len(costs) == 0 {
		return fallback
	}
	for key, value := range costs {
		if strings.EqualFold(key, "USD") || strings.EqualFold(value.Currency, "USD") || value.Currency == "" {
			if value.TotalCost != 0 {
				return value.TotalCost
			}
			return value.InputCost + value.OutputCost
		}
	}
	return fallback
}

func cnyCostMap(inputCost, outputCost float64) map[string]model.CostCurrencyMetrics {
	totalCost := inputCost + outputCost
	return map[string]model.CostCurrencyMetrics{
		model.DefaultPricingCurrency: {
			Currency:       model.DefaultPricingCurrency,
			CurrencySymbol: model.DefaultPricingSymbol,
			InputCost:      inputCost,
			OutputCost:     outputCost,
			TotalCost:      totalCost,
		},
	}
}
