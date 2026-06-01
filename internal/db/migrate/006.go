package migrate

import (
	"fmt"

	"gorm.io/gorm"
)

func init() {
	RegisterAfterAutoMigration(Migration{
		Version: 6,
		Up:      createRelayLogUsageChartIndexes,
	})
}

// 006: add composite indexes used by usage chart time-range aggregation.
func createRelayLogUsageChartIndexes(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("db is nil")
	}

	indexes := []struct {
		name    string
		columns string
	}{
		{name: "idx_relay_logs_time_actual_model_name", columns: "time, actual_model_name"},
		{name: "idx_relay_logs_time_request_model_name", columns: "time, request_model_name"},
		{name: "idx_relay_logs_time_channel_id", columns: "time, channel_id"},
		{name: "idx_relay_logs_time_router_id", columns: "time, router_id"},
		{name: "idx_relay_logs_time_endpoint_id", columns: "time, endpoint_id"},
		{name: "idx_relay_logs_time_request_api_key_name", columns: "time, request_api_key_name"},
	}

	for _, item := range indexes {
		if db.Migrator().HasIndex("relay_logs", item.name) {
			continue
		}
		if err := db.Exec(fmt.Sprintf("CREATE INDEX %s ON relay_logs (%s)", item.name, item.columns)).Error; err != nil {
			return fmt.Errorf("failed to create index %s: %w", item.name, err)
		}
	}
	return nil
}
