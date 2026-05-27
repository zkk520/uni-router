package migrate

import (
	"fmt"

	"gorm.io/gorm"
)

func init() {
	RegisterAfterAutoMigration(Migration{
		Version: 5,
		Up:      createRelayLogIndexes,
	})
}

// 005: add indexes used by log retention cleanup and log list filters.
func createRelayLogIndexes(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("db is nil")
	}

	indexes := []struct {
		name   string
		column string
	}{
		{name: "idx_relay_logs_time", column: "time"},
		{name: "idx_relay_logs_request_api_key_name", column: "request_api_key_name"},
		{name: "idx_relay_logs_router_id", column: "router_id"},
		{name: "idx_relay_logs_endpoint_id", column: "endpoint_id"},
	}

	for _, item := range indexes {
		if db.Migrator().HasIndex("relay_logs", item.name) {
			continue
		}
		if err := db.Exec(fmt.Sprintf("CREATE INDEX %s ON relay_logs (%s)", item.name, item.column)).Error; err != nil {
			return fmt.Errorf("failed to create index %s: %w", item.name, err)
		}
	}
	return nil
}
