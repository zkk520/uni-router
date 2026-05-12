package op

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/bestruirui/octopus/internal/db"
	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/utils/cache"
	"github.com/bestruirui/octopus/internal/utils/log"
	"github.com/bestruirui/octopus/internal/utils/xstrings"
)

var channelCache = cache.New[int, model.Channel](16)
var channelKeyCache = cache.New[int, model.ChannelKey](16)
var channelKeyCacheNeedUpdate = make(map[int]struct{})
var channelKeyCacheNeedUpdateLock sync.Mutex

func ChannelList(ctx context.Context) ([]model.Channel, error) {
	channels := make([]model.Channel, 0, channelCache.Len())
	for _, channel := range channelCache.GetAll() {
		channels = append(channels, channel)
	}
	return channels, nil
}

func ChannelCreate(channel *model.Channel, ctx context.Context) error {
	if channel.PricingRule.Enabled {
		channel.PricingRule = model.NormalizePricingRule(channel.PricingRule)
	}
	for i := range channel.Keys {
		if channel.Keys[i].PricingRule.Enabled {
			channel.Keys[i].PricingRule = model.NormalizePricingRule(channel.Keys[i].PricingRule)
		}
		channel.Keys[i].Models = normalizeModelList(channel.Keys[i].Models)
	}
	channel.Model = MergeChannelModels(*channel)
	if err := db.GetDB().WithContext(ctx).Create(channel).Error; err != nil {
		return err
	}
	channelCache.Set(channel.ID, *channel)
	for _, k := range channel.Keys {
		if k.ID != 0 {
			channelKeyCache.Set(k.ID, k)
		}
	}
	return nil
}

// ChannelKeyUpdate 仅更新 ChannelKey 的内存缓存（不落库），并标记为需要在 SaveCache 时写入数据库。
func ChannelKeyUpdate(key model.ChannelKey) error {
	if key.ID == 0 || key.ChannelID == 0 {
		return fmt.Errorf("invalid channel key")
	}
	ch, ok := channelCache.Get(key.ChannelID)
	if !ok {
		return fmt.Errorf("channel not found")
	}
	if len(ch.Keys) > 0 {
		keys := make([]model.ChannelKey, len(ch.Keys))
		copy(keys, ch.Keys)
		for i := range keys {
			if keys[i].ID == key.ID {
				keys[i] = key
				break
			}
		}
		ch.Keys = keys
	}
	channelCache.Set(key.ChannelID, ch)
	channelKeyCache.Set(key.ID, key)
	channelKeyCacheNeedUpdateLock.Lock()
	channelKeyCacheNeedUpdate[key.ID] = struct{}{}
	channelKeyCacheNeedUpdateLock.Unlock()
	return nil
}
func ChannelBaseUrlUpdate(channelID int, baseUrl []model.BaseUrl) error {
	ch, ok := channelCache.Get(channelID)
	if !ok {
		return fmt.Errorf("channel not found")
	}
	// Copy to decouple callers from internal cache storage.
	if baseUrl == nil {
		ch.BaseUrls = nil
	} else {
		cp := make([]model.BaseUrl, len(baseUrl))
		copy(cp, baseUrl)
		ch.BaseUrls = cp
	}
	channelCache.Set(channelID, ch)
	return nil
}

// ChannelKeySaveDB 将运行时更新过的 ChannelKey 缓存写入数据库。
func ChannelKeySaveDB(ctx context.Context) error {
	channelKeyCacheNeedUpdateLock.Lock()
	keyIDs := make([]int, 0, len(channelKeyCacheNeedUpdate))
	for id := range channelKeyCacheNeedUpdate {
		keyIDs = append(keyIDs, id)
	}
	channelKeyCacheNeedUpdate = make(map[int]struct{})
	channelKeyCacheNeedUpdateLock.Unlock()

	if len(keyIDs) == 0 {
		return nil
	}

	dbConn := db.GetDB().WithContext(ctx)
	for _, id := range keyIDs {
		k, ok := channelKeyCache.Get(id)
		if !ok {
			continue
		}
		if err := dbConn.Save(&k).Error; err != nil {
			return err
		}
	}
	return nil
}

func ChannelUpdate(req *model.ChannelUpdateRequest, ctx context.Context) (*model.Channel, error) {
	_, ok := channelCache.Get(req.ID)
	if !ok {
		return nil, fmt.Errorf("channel not found")
	}

	tx := db.GetDB().WithContext(ctx).Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	var selectFields []string
	updates := model.Channel{ID: req.ID}

	if req.Name != nil {
		selectFields = append(selectFields, "name")
		updates.Name = *req.Name
	}
	if req.Type != nil {
		selectFields = append(selectFields, "type")
		updates.Type = *req.Type
	}
	if req.Enabled != nil {
		selectFields = append(selectFields, "enabled")
		updates.Enabled = *req.Enabled
	}
	if req.BaseUrls != nil {
		selectFields = append(selectFields, "base_urls")
		updates.BaseUrls = *req.BaseUrls
	}
	if req.Model != nil {
		selectFields = append(selectFields, "model")
		updates.Model = strings.Join(normalizeModelList(xstrings.SplitTrimCompact(",", *req.Model)), ",")
	}
	if req.CustomModel != nil {
		selectFields = append(selectFields, "custom_model")
		updates.CustomModel = strings.Join(normalizeModelList(xstrings.SplitTrimCompact(",", *req.CustomModel)), ",")
	}
	if req.Proxy != nil {
		selectFields = append(selectFields, "proxy")
		updates.Proxy = *req.Proxy
	}
	if req.AutoSync != nil {
		selectFields = append(selectFields, "auto_sync")
		updates.AutoSync = *req.AutoSync
	}
	if req.CustomHeader != nil {
		selectFields = append(selectFields, "custom_header")
		updates.CustomHeader = *req.CustomHeader
	}
	if req.ChannelProxy != nil {
		selectFields = append(selectFields, "channel_proxy")
		updates.ChannelProxy = req.ChannelProxy
	}
	if req.ParamOverride != nil {
		selectFields = append(selectFields, "param_override")
		updates.ParamOverride = req.ParamOverride
	}
	if req.MatchRegex != nil {
		selectFields = append(selectFields, "match_regex")
		updates.MatchRegex = req.MatchRegex
	}
	if req.PricingRule != nil {
		selectFields = append(selectFields, "pricing_rule")
	}

	// 只有当有字段需要更新时才执行 UPDATE
	if len(selectFields) > 0 {
		updatePayload := map[string]any{}
		for _, field := range selectFields {
			switch field {
			case "name":
				updatePayload[field] = updates.Name
			case "type":
				updatePayload[field] = updates.Type
			case "enabled":
				updatePayload[field] = updates.Enabled
			case "base_urls":
				updatePayload[field] = updates.BaseUrls
			case "model":
				updatePayload[field] = updates.Model
			case "custom_model":
				updatePayload[field] = updates.CustomModel
			case "proxy":
				updatePayload[field] = updates.Proxy
			case "auto_sync":
				updatePayload[field] = updates.AutoSync
			case "custom_header":
				updatePayload[field] = updates.CustomHeader
			case "channel_proxy":
				updatePayload[field] = updates.ChannelProxy
			case "param_override":
				updatePayload[field] = updates.ParamOverride
			case "match_regex":
				updatePayload[field] = updates.MatchRegex
			case "pricing_rule":
				value, err := pricingRuleDBValue(*req.PricingRule)
				if err != nil {
					tx.Rollback()
					return nil, fmt.Errorf("failed to serialize channel pricing rule: %w", err)
				}
				updatePayload[field] = value
			}
		}
		if err := tx.Model(&model.Channel{}).Where("id = ?", req.ID).Updates(updatePayload).Error; err != nil {
			tx.Rollback()
			return nil, fmt.Errorf("failed to update channel: %w", err)
		}
	}

	// 删除 keys
	if len(req.KeysToDelete) > 0 {
		if err := tx.Where("id IN ? AND channel_id = ?", req.KeysToDelete, req.ID).Delete(&model.ChannelKey{}).Error; err != nil {
			tx.Rollback()
			return nil, fmt.Errorf("failed to delete channel keys: %w", err)
		}
		if err := tx.Where("channel_key_id IN ?", req.KeysToDelete).Delete(&model.StatsChannelKey{}).Error; err != nil {
			tx.Rollback()
			return nil, fmt.Errorf("failed to delete channel key stats: %w", err)
		}
	}

	// 更新 keys（逐条，只更新提供的字段）
	if len(req.KeysToUpdate) > 0 {
		for _, ku := range req.KeysToUpdate {
			updatePayload := map[string]any{}
			if ku.Enabled != nil {
				updatePayload["enabled"] = *ku.Enabled
			}
			if ku.ChannelKey != nil {
				updatePayload["channel_key"] = *ku.ChannelKey
			}
			if ku.Remark != nil {
				updatePayload["remark"] = *ku.Remark
			}
			if ku.Type.Set {
				if ku.Type.Value == nil {
					updatePayload["type"] = nil
				} else {
					updatePayload["type"] = *ku.Type.Value
				}
			}
			if ku.PricingRule != nil {
				value, err := pricingRuleDBValue(*ku.PricingRule)
				if err != nil {
					tx.Rollback()
					return nil, fmt.Errorf("failed to serialize channel key %d pricing rule: %w", ku.ID, err)
				}
				updatePayload["pricing_rule"] = value
			}
			if ku.Models != nil {
				updatePayload["models"] = normalizeModelList(*ku.Models)
			}
			if ku.ModelsSyncedAt != nil {
				updatePayload["models_synced_at"] = *ku.ModelsSyncedAt
			}
			if ku.ModelsSyncError != nil {
				updatePayload["models_sync_error"] = *ku.ModelsSyncError
			}
			if len(updatePayload) == 0 {
				continue
			}
			if err := tx.Model(&model.ChannelKey{}).
				Where("id = ? AND channel_id = ?", ku.ID, req.ID).
				Updates(updatePayload).Error; err != nil {
				tx.Rollback()
				return nil, fmt.Errorf("failed to update channel key %d: %w", ku.ID, err)
			}
		}
	}

	// 新增 keys
	if len(req.KeysToAdd) > 0 {
		newKeys := make([]model.ChannelKey, 0, len(req.KeysToAdd))
		for _, ka := range req.KeysToAdd {
			rule := ka.PricingRule
			if rule.Enabled {
				rule = model.NormalizePricingRule(rule)
			}
			newKeys = append(newKeys, model.ChannelKey{
				ChannelID:       req.ID,
				Enabled:         ka.Enabled,
				ChannelKey:      ka.ChannelKey,
				Remark:          ka.Remark,
				Type:            ka.Type,
				PricingRule:     rule,
				Models:          normalizeModelList(ka.Models),
				ModelsSyncedAt:  ka.ModelsSyncedAt,
				ModelsSyncError: ka.ModelsSyncError,
			})
		}
		if err := tx.Create(&newKeys).Error; err != nil {
			tx.Rollback()
			return nil, fmt.Errorf("failed to create channel keys: %w", err)
		}
	}

	if err := tx.Commit().Error; err != nil {
		return nil, fmt.Errorf("failed to commit transaction: %w", err)
	}

	// 刷新缓存并返回最新数据
	if err := channelRefreshCacheByID(req.ID, ctx); err != nil {
		return nil, err
	}
	for _, keyID := range req.KeysToDelete {
		_ = StatsChannelKeyDel(keyID)
	}

	channel, _ := channelCache.Get(req.ID)
	if err := refreshChannelModelUnion(req.ID, ctx); err != nil {
		return nil, err
	}
	channel, _ = channelCache.Get(req.ID)
	return &channel, nil
}

func ChannelEnabled(id int, enabled bool, ctx context.Context) error {
	oldChannel, ok := channelCache.Get(id)
	if !ok {
		return fmt.Errorf("channel not found")
	}
	if err := db.GetDB().WithContext(ctx).Model(&model.Channel{}).Where("id = ?", id).Update("enabled", enabled).Error; err != nil {
		return err
	}
	oldChannel.Enabled = enabled
	channelCache.Set(id, oldChannel)
	return nil
}

func ChannelDel(id int, ctx context.Context) error {
	ch, ok := channelCache.Get(id)
	if !ok {
		return fmt.Errorf("channel not found")
	}

	// 开启事务
	tx := db.GetDB().WithContext(ctx).Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 删除渠道 keys
	if err := tx.Where("channel_id = ?", id).Delete(&model.ChannelKey{}).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("failed to delete channel keys: %w", err)
	}

	// 删除统计数据
	if err := tx.Where("channel_id = ?", id).Delete(&model.StatsChannel{}).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("failed to delete channel stats: %w", err)
	}
	keyIDs := make([]int, 0, len(ch.Keys))
	for _, k := range ch.Keys {
		if k.ID != 0 {
			keyIDs = append(keyIDs, k.ID)
		}
	}
	if len(keyIDs) > 0 {
		if err := tx.Where("channel_key_id IN ?", keyIDs).Delete(&model.StatsChannelKey{}).Error; err != nil {
			tx.Rollback()
			return fmt.Errorf("failed to delete channel key stats: %w", err)
		}
	}

	// 删除渠道
	if err := tx.Delete(&model.Channel{}, id).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("failed to delete channel: %w", err)
	}

	if err := tx.Commit().Error; err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	// 删除缓存
	channelCache.Del(id)
	for _, k := range ch.Keys {
		if k.ID != 0 {
			channelKeyCache.Del(k.ID)
			_ = StatsChannelKeyDel(k.ID)
		}
	}
	StatsChannelDel(id)

	return nil
}

func ChannelLLMList(ctx context.Context) ([]model.LLMChannel, error) {
	models := []model.LLMChannel{}
	for _, channel := range channelCache.GetAll() {
		modelNames := ChannelModelNames(channel)
		for _, modelName := range modelNames {
			if modelName == "" {
				continue
			}
			models = append(models, model.LLMChannel{
				Name:        modelName,
				Enabled:     channel.Enabled,
				ChannelID:   channel.ID,
				ChannelName: channel.Name,
			})
		}
	}
	return models, nil
}

func ChannelModelNames(channel model.Channel) []string {
	return normalizeModelList(xstrings.SplitTrimCompact(",", MergeChannelModels(channel), channel.CustomModel))
}

func MergeChannelModels(channel model.Channel) string {
	models := make([]string, 0)
	for _, key := range channel.Keys {
		models = append(models, key.Models...)
	}
	if len(models) == 0 {
		models = xstrings.SplitTrimCompact(",", channel.Model)
	}
	return strings.Join(normalizeModelList(models), ",")
}

func ChannelKeyModelNames(channel model.Channel, keyID int) []string {
	for _, key := range channel.Keys {
		if key.ID == keyID {
			return normalizeModelList(key.Models)
		}
	}
	return nil
}

func refreshChannelModelUnion(channelID int, ctx context.Context) error {
	channel, ok := channelCache.Get(channelID)
	if !ok {
		return fmt.Errorf("channel not found")
	}
	modelStr := MergeChannelModels(channel)
	if err := db.GetDB().WithContext(ctx).
		Model(&model.Channel{}).
		Where("id = ?", channelID).
		Update("model", modelStr).Error; err != nil {
		return fmt.Errorf("failed to update channel model union: %w", err)
	}
	channel.Model = modelStr
	channelCache.Set(channelID, channel)
	return nil
}

func normalizeModelList(models []string) []string {
	out := make([]string, 0, len(models))
	seen := make(map[string]struct{}, len(models))
	for _, m := range models {
		m = strings.TrimSpace(m)
		if m == "" {
			continue
		}
		if _, ok := seen[m]; ok {
			continue
		}
		seen[m] = struct{}{}
		out = append(out, m)
	}
	return out
}

func ChannelGet(id int, ctx context.Context) (*model.Channel, error) {
	channel, ok := channelCache.Get(id)
	if !ok {
		return nil, fmt.Errorf("channel not found")
	}
	return &channel, nil
}

func channelRefreshCache(ctx context.Context) error {
	channels := []model.Channel{}
	if err := db.GetDB().WithContext(ctx).
		Preload("Keys").
		Preload("Stats").
		Find(&channels).Error; err != nil {
		log.Warnf("failed to get channels: %v", err)
		return err
	}
	channelKeyCache.Clear()
	channelKeyCacheNeedUpdateLock.Lock()
	channelKeyCacheNeedUpdate = make(map[int]struct{})
	channelKeyCacheNeedUpdateLock.Unlock()
	for _, channel := range channels {
		channelCache.Set(channel.ID, channel)
		for _, k := range channel.Keys {
			if k.ID != 0 {
				channelKeyCache.Set(k.ID, k)
			}
		}
	}
	return nil
}

func channelRefreshCacheByID(id int, ctx context.Context) error {
	if old, ok := channelCache.Get(id); ok {
		for _, k := range old.Keys {
			if k.ID != 0 {
				channelKeyCache.Del(k.ID)
			}
		}
	}
	var channel model.Channel
	if err := db.GetDB().WithContext(ctx).
		Preload("Keys").
		Preload("Stats").
		First(&channel, id).Error; err != nil {
		return err
	}
	channelCache.Set(channel.ID, channel)
	for _, k := range channel.Keys {
		if k.ID != 0 {
			channelKeyCache.Set(k.ID, k)
		}
	}
	return nil
}
