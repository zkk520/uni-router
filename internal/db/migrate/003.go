package migrate

import (
	"fmt"

	"gorm.io/gorm"
)

func init() {
	RegisterAfterAutoMigration(Migration{
		Version: 3,
		Up:      dropLegacyGroupRoutingObjects,
	})
}

// 003: remove legacy group-based routing schema after Router becomes the only relay path.
func dropLegacyGroupRoutingObjects(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("db is nil")
	}

	dialect := db.Dialector.Name()

	hasColumn := func(table, column string) bool {
		switch dialect {
		case "sqlite":
			var name string
			db.Raw("SELECT name FROM pragma_table_info(?) WHERE name = ? LIMIT 1", table, column).Scan(&name)
			return name == column
		case "mysql":
			var count int64
			db.Raw("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?", table, column).Scan(&count)
			return count > 0
		case "postgres":
			var count int64
			db.Raw("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = ? AND column_name = ?", table, column).Scan(&count)
			return count > 0
		default:
			return db.Migrator().HasColumn(table, column)
		}
	}

	dropColumn := func(table, column string) error {
		if !hasColumn(table, column) {
			return nil
		}
		switch dialect {
		case "sqlite":
			return db.Exec(fmt.Sprintf("ALTER TABLE %s DROP COLUMN %s", table, column)).Error
		case "mysql":
			return db.Exec(fmt.Sprintf("ALTER TABLE `%s` DROP COLUMN `%s`", table, column)).Error
		case "postgres":
			return db.Exec(fmt.Sprintf("ALTER TABLE %s DROP COLUMN IF EXISTS %s", table, column)).Error
		default:
			return db.Migrator().DropColumn(table, column)
		}
	}

	for _, item := range []struct {
		table  string
		column string
	}{
		{table: "api_keys", column: "supported_models"},
		{table: "route_endpoints", column: "model_mapping"},
		{table: "channels", column: "auto_group"},
	} {
		if err := dropColumn(item.table, item.column); err != nil {
			return fmt.Errorf("failed to drop %s.%s: %w", item.table, item.column, err)
		}
	}

	for _, table := range []string{"group_items", "groups"} {
		if db.Migrator().HasTable(table) {
			if err := db.Migrator().DropTable(table); err != nil {
				return fmt.Errorf("failed to drop table %s: %w", table, err)
			}
		}
	}

	return nil
}
