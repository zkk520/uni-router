package op

import (
	"context"
	"fmt"
	"sort"

	"github.com/zkk520/uni-router/internal/db"
	"github.com/zkk520/uni-router/internal/model"
	"github.com/zkk520/uni-router/internal/utils/cache"
)

var apiKeyCache = cache.New[int, model.APIKey](16)
var apiKeyIDMap = cache.New[string, int](16)

func APIKeyCreate(key *model.APIKey, ctx context.Context) error {
	if key.RouterID <= 0 {
		return fmt.Errorf("router_id is required")
	}
	if _, ok := routeCache.Get(key.RouterID); !ok {
		return fmt.Errorf("router not found")
	}
	if err := ensureUniqueAPIKeyRouter(key.RouterID, 0, ctx); err != nil {
		return err
	}
	if err := db.GetDB().WithContext(ctx).Create(key).Error; err != nil {
		return fmt.Errorf("failed to create API key: %w", err)
	}
	apiKeyCache.Set(key.ID, *key)
	apiKeyIDMap.Set(key.APIKey, key.ID)
	return nil
}

func APIKeyUpdate(key *model.APIKey, ctx context.Context) error {
	existing, ok := apiKeyCache.Get(key.ID)
	if !ok {
		return fmt.Errorf("API key not found")
	}
	if key.RouterID <= 0 {
		return fmt.Errorf("router_id is required")
	}
	if _, ok := routeCache.Get(key.RouterID); !ok {
		return fmt.Errorf("router not found")
	}
	if err := ensureUniqueAPIKeyRouter(key.RouterID, key.ID, ctx); err != nil {
		return err
	}
	if err := db.GetDB().WithContext(ctx).Omit("api_key").Save(key).Error; err != nil {
		return fmt.Errorf("failed to update API key: %w", err)
	}
	key.APIKey = existing.APIKey
	apiKeyCache.Set(key.ID, *key)
	return nil
}

func APIKeyList(ctx context.Context) ([]model.APIKey, error) {
	keys := make([]model.APIKey, 0, apiKeyCache.Len())
	for _, apiKey := range apiKeyCache.GetAll() {
		keys = append(keys, apiKey)
	}
	return keys, nil
}

func APIKeyGet(id int, ctx context.Context) (model.APIKey, error) {
	apiKey, ok := apiKeyCache.Get(id)
	if !ok {
		return model.APIKey{}, fmt.Errorf("API key not found")
	}
	return apiKey, nil
}

func APIKeyGetByAPIKey(apiKey string, ctx context.Context) (model.APIKey, error) {
	id, ok := apiKeyIDMap.Get(apiKey)
	if !ok {
		return model.APIKey{}, fmt.Errorf("API key not found")
	}
	return APIKeyGet(id, ctx)
}

func APIKeyDelete(id int, ctx context.Context) error {
	existing, _ := apiKeyCache.Get(id)
	k := model.APIKey{
		ID: id,
	}
	if err := StatsAPIKeyDel(id); err != nil {
		return fmt.Errorf("failed to delete stats API key: %v", err)
	}
	result := db.GetDB().WithContext(ctx).Delete(&k)
	if result.RowsAffected == 0 {
		return fmt.Errorf("API key not found")
	}
	if result.Error != nil {
		return fmt.Errorf("failed to delete API key: %w", result.Error)
	}
	apiKeyCache.Del(k.ID)
	apiKeyIDMap.Del(existing.APIKey)
	return nil
}

func APIKeyCountByRouter(routerID int, ctx context.Context) int {
	count := int64(0)
	if routerID <= 0 {
		return 0
	}
	if err := db.GetDB().WithContext(ctx).
		Model(&model.APIKey{}).
		Where("router_id = ?", routerID).
		Count(&count).Error; err != nil {
		return 0
	}
	return int(count)
}

func APIKeyByRouter(routerID int, ctx context.Context) (*model.APIKey, int) {
	if routerID <= 0 {
		return nil, 0
	}
	keys := make([]model.APIKey, 0)
	for _, apiKey := range apiKeyCache.GetAll() {
		if apiKey.RouterID == routerID {
			keys = append(keys, apiKey)
		}
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i].ID < keys[j].ID })
	if len(keys) == 0 {
		return nil, APIKeyCountByRouter(routerID, ctx)
	}
	return &keys[0], APIKeyCountByRouter(routerID, ctx)
}

func ensureUniqueAPIKeyRouter(routerID, currentID int, ctx context.Context) error {
	count := int64(0)
	query := db.GetDB().WithContext(ctx).
		Model(&model.APIKey{}).
		Where("router_id = ?", routerID)
	if currentID > 0 {
		query = query.Where("id <> ?", currentID)
	}
	if err := query.Count(&count).Error; err != nil {
		return fmt.Errorf("failed to check router API key binding: %w", err)
	}
	if count > 0 {
		return fmt.Errorf("router already has an API key")
	}
	return nil
}

func apiKeyRefreshCache(ctx context.Context) error {
	apiKeys := []model.APIKey{}
	if err := db.GetDB().WithContext(ctx).Find(&apiKeys).Error; err != nil {
		return err
	}
	for _, apiKey := range apiKeys {
		apiKeyCache.Set(apiKey.ID, apiKey)
		apiKeyIDMap.Set(apiKey.APIKey, apiKey.ID)
	}
	return nil
}
