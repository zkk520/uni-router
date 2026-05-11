package op

import (
	"encoding/json"
	"fmt"

	"github.com/bestruirui/octopus/internal/model"
)

func pricingRuleDBValue(rule model.PricingRule) ([]byte, error) {
	if rule.Enabled {
		rule = model.NormalizePricingRule(rule)
	}
	data, err := json.Marshal(rule)
	if err != nil {
		return nil, fmt.Errorf("marshal pricing rule: %w", err)
	}
	return data, nil
}
