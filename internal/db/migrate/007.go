package migrate

import (
	"fmt"

	"gorm.io/gorm"
)

func init() {
	RegisterAfterAutoMigration(Migration{
		Version: 7,
		Up:      backfillRouteProfileSortOrder,
	})
}

// 007: backfill route order so existing routes keep a stable visible order.
func backfillRouteProfileSortOrder(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("db is nil")
	}

	return db.Exec(`
		UPDATE route_profiles
		SET sort_order = id * 10
		WHERE sort_order IS NULL OR sort_order = 0
	`).Error
}
