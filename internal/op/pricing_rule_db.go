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
	data, err := jsonDBValue(rule)
	if err != nil {
		return nil, fmt.Errorf("marshal pricing rule: %w", err)
	}
	return data, nil
}

func jsonDBValue(value any) ([]byte, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return data, nil
}
