package op

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/zkk520/uni-router/internal/db"
	"github.com/zkk520/uni-router/internal/model"
	"github.com/zkk520/uni-router/internal/utils/log"
	"github.com/zkk520/uni-router/internal/utils/snowflake"
	"gorm.io/gorm"
)

const relayLogMaxSize = 20
const relayLogMaxSizeNoDB = 100 // 当不保存到数据库时，允许更大的缓存用于实时查询
const relayLogContentTruncatedSuffix = "...(truncated)"

var relayLogCache = make([]model.RelayLog, 0, relayLogMaxSize)
var relayLogCacheLock sync.Mutex

var relayLogFlushLock sync.Mutex

var relayLogSubscribers = make(map[chan model.RelayLog]struct{})
var relayLogSubscribersLock sync.RWMutex

var relayLogStreamTokens = make(map[string]struct{})
var relayLogStreamTokensLock sync.RWMutex

func RelayLogStreamTokenCreate() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	token := hex.EncodeToString(bytes)

	relayLogStreamTokensLock.Lock()
	relayLogStreamTokens[token] = struct{}{}
	relayLogStreamTokensLock.Unlock()

	return token, nil
}

func RelayLogStreamTokenVerify(token string) bool {
	relayLogStreamTokensLock.RLock()
	_, ok := relayLogStreamTokens[token]
	relayLogStreamTokensLock.RUnlock()
	return ok
}

func RelayLogStreamTokenRevoke(token string) {
	relayLogStreamTokensLock.Lock()
	delete(relayLogStreamTokens, token)
	relayLogStreamTokensLock.Unlock()
}

func RelayLogSubscribe() chan model.RelayLog {
	ch := make(chan model.RelayLog, 10)
	relayLogSubscribersLock.Lock()
	relayLogSubscribers[ch] = struct{}{}
	relayLogSubscribersLock.Unlock()
	return ch
}

func RelayLogUnsubscribe(ch chan model.RelayLog) {
	relayLogSubscribersLock.Lock()
	delete(relayLogSubscribers, ch)
	relayLogSubscribersLock.Unlock()
	close(ch)
}

func notifySubscribers(relayLog model.RelayLog) {
	relayLogSubscribersLock.RLock()
	defer relayLogSubscribersLock.RUnlock()

	for ch := range relayLogSubscribers {
		select {
		case ch <- relayLog:
		default:
		}
	}
}

func relayLogFlushToDB(ctx context.Context) error {
	relayLogFlushLock.Lock()
	defer relayLogFlushLock.Unlock()

	relayLogCacheLock.Lock()
	if len(relayLogCache) == 0 {
		relayLogCacheLock.Unlock()
		return nil
	}
	batch := make([]model.RelayLog, len(relayLogCache))
	copy(batch, relayLogCache)
	flushedUpto := len(batch)
	relayLogCacheLock.Unlock()

	result := db.GetDB().WithContext(ctx).Create(&batch)
	if result.Error != nil {
		return result.Error
	}

	relayLogCacheLock.Lock()
	if len(relayLogCache) >= flushedUpto {
		relayLogCache = relayLogCache[flushedUpto:]
	} else {
		relayLogCache = relayLogCache[:0]
	}
	if len(relayLogCache) == 0 {
		relayLogCache = make([]model.RelayLog, 0, relayLogMaxSize)
	}
	relayLogCacheLock.Unlock()

	return nil
}

func RelayLogAdd(ctx context.Context, relayLog model.RelayLog) error {
	enabled, err := SettingGetBool(model.SettingKeyRelayLogKeepEnabled)
	if err != nil {
		return err
	}
	if err := relayLogApplyContentLimits(&relayLog); err != nil {
		return err
	}
	maxSize := relayLogMaxSize
	if !enabled {
		maxSize = relayLogMaxSizeNoDB
	}
	relayLog.ID = snowflake.GenerateID()
	go notifySubscribers(relayLog)

	relayLogCacheLock.Lock()
	relayLogCache = append(relayLogCache, relayLog)
	if len(relayLogCache) >= maxSize {
		if enabled {
			relayLogCacheLock.Unlock()
			return relayLogFlushToDB(ctx)
		}
		// 如果未启用日志保存，移除最旧的日志，保留最新的日志用于实时查询
		keepSize := maxSize / 2
		if len(relayLogCache) > keepSize {
			relayLogCache = relayLogCache[len(relayLogCache)-keepSize:]
		}
	}
	relayLogCacheLock.Unlock()
	return nil
}

func relayLogApplyContentLimits(relayLog *model.RelayLog) error {
	requestMaxBytes, err := SettingGetInt(model.SettingKeyRelayLogRequestMaxBytes)
	if err != nil {
		return err
	}
	responseMaxBytes, err := SettingGetInt(model.SettingKeyRelayLogResponseMaxBytes)
	if err != nil {
		return err
	}
	relayLog.RequestContent = truncateRelayLogContent(relayLog.RequestContent, requestMaxBytes)
	relayLog.ResponseContent = truncateRelayLogContent(relayLog.ResponseContent, responseMaxBytes)
	return nil
}

func truncateRelayLogContent(content string, maxBytes int) string {
	if maxBytes <= 0 {
		return ""
	}
	if len(content) <= maxBytes {
		return content
	}
	suffix := relayLogContentTruncatedSuffix
	if maxBytes <= len(suffix) {
		return suffix[:maxBytes]
	}
	cutLimit := maxBytes - len(suffix)
	cut := 0
	for idx, r := range content {
		next := idx + utf8.RuneLen(r)
		if next > cutLimit {
			break
		}
		cut = next
	}
	return content[:cut] + suffix
}

func RelayLogSaveDBTask(ctx context.Context) error {
	log.Debugf("relay log save db task started")
	startTime := time.Now()
	defer func() {
		log.Debugf("relay log save db task finished, save time: %s", time.Since(startTime))
	}()
	enabled, err := SettingGetBool(model.SettingKeyRelayLogKeepEnabled)
	if err != nil {
		return err
	}

	if enabled {
		if err := relayLogFlushToDB(ctx); err != nil {
			return err
		}
		return relayLogCleanup(ctx)
	}

	// 如果未启用日志保存，检查缓存大小，如果超过限制则清理旧日志
	relayLogCacheLock.Lock()
	if len(relayLogCache) > relayLogMaxSizeNoDB {
		keepSize := relayLogMaxSizeNoDB / 2
		relayLogCache = relayLogCache[len(relayLogCache)-keepSize:]
	}
	relayLogCacheLock.Unlock()

	return nil
}

func relayLogCleanup(ctx context.Context) error {
	keepPeriod, err := SettingGetInt(model.SettingKeyRelayLogKeepPeriod)
	if err != nil {
		return err
	}

	if keepPeriod <= 0 {
		return nil
	}

	cutoffTime := time.Now().Add(-time.Duration(keepPeriod) * 24 * time.Hour).Unix()
	return db.GetDB().WithContext(ctx).Where("time < ?", cutoffTime).Delete(&model.RelayLog{}).Error
}

// RelayLogList 查询日志列表，支持可选的时间范围过滤
// startTime 和 endTime 为 nil 时表示不限制时间范围
type RelayLogFilter struct {
	StartTime  *int
	EndTime    *int
	APIKeyName string
	RouterID   int
	EndpointID int
	Status     string
}

func RelayLogList(ctx context.Context, startTime, endTime *int, page, pageSize int) ([]model.RelayLog, error) {
	return RelayLogListWithFilter(ctx, RelayLogFilter{StartTime: startTime, EndTime: endTime}, page, pageSize)
}

func RelayLogListWithFilter(ctx context.Context, filter RelayLogFilter, page, pageSize int) ([]model.RelayLog, error) {
	enabled, err := SettingGetBool(model.SettingKeyRelayLogKeepEnabled)
	if err != nil {
		return nil, err
	}
	hasTimeFilter := filter.StartTime != nil && filter.EndTime != nil

	// 获取缓存中符合条件的日志
	relayLogCacheLock.Lock()
	var cachedLogs []model.RelayLog
	for _, item := range relayLogCache {
		if relayLogMatchFilter(item, filter, hasTimeFilter) {
			cachedLogs = append(cachedLogs, item)
		}
	}
	relayLogCacheLock.Unlock()

	// 反转缓存日志顺序（原本新的在末尾，反转后新的在前面，方便分页）
	for i, j := 0, len(cachedLogs)-1; i < j; i, j = i+1, j-1 {
		cachedLogs[i], cachedLogs[j] = cachedLogs[j], cachedLogs[i]
	}

	cacheCount := len(cachedLogs)
	offset := (page - 1) * pageSize

	result := make([]model.RelayLog, 0, pageSize)

	// 先从缓存中取（缓存是最新的日志）
	if offset < cacheCount {
		cacheEnd := offset + pageSize
		if cacheEnd > cacheCount {
			cacheEnd = cacheCount
		}
		result = append(result, cachedLogs[offset:cacheEnd]...)
	}

	// 如果启用了日志保存，缓存不够时从数据库补充
	if enabled {
		remaining := pageSize - len(result)
		if remaining > 0 {
			dbOffset := 0
			if offset > cacheCount {
				dbOffset = offset - cacheCount
			}

			query := db.GetDB().WithContext(ctx)
			if hasTimeFilter {
				query = query.Where("time >= ? AND time <= ?", *filter.StartTime, *filter.EndTime)
			}
			if filter.APIKeyName != "" {
				query = query.Where("request_api_key_name = ?", filter.APIKeyName)
			}
			if filter.RouterID > 0 {
				query = query.Where("router_id = ?", filter.RouterID)
			}
			if filter.EndpointID > 0 {
				query = query.Where("endpoint_id = ?", filter.EndpointID)
			}
			if filter.Status == "success" {
				query = query.Where("error = ''")
			}
			if filter.Status == "failed" {
				query = query.Where("error <> ''")
			}

			var dbLogs []model.RelayLog
			if err := query.Order("id DESC").Offset(dbOffset).Limit(remaining).Find(&dbLogs).Error; err != nil {
				return nil, err
			}
			result = append(result, dbLogs...)
		}
	}

	return result, nil
}

func RelayLogSummaryListWithFilter(ctx context.Context, filter RelayLogFilter, page, pageSize int) ([]model.RelayLogSummary, error) {
	enabled, err := SettingGetBool(model.SettingKeyRelayLogKeepEnabled)
	if err != nil {
		return nil, err
	}
	hasTimeFilter := filter.StartTime != nil && filter.EndTime != nil

	relayLogCacheLock.Lock()
	var cachedLogs []model.RelayLogSummary
	for _, item := range relayLogCache {
		if relayLogMatchFilter(item, filter, hasTimeFilter) {
			cachedLogs = append(cachedLogs, RelayLogToSummary(item))
		}
	}
	relayLogCacheLock.Unlock()

	for i, j := 0, len(cachedLogs)-1; i < j; i, j = i+1, j-1 {
		cachedLogs[i], cachedLogs[j] = cachedLogs[j], cachedLogs[i]
	}

	cacheCount := len(cachedLogs)
	offset := (page - 1) * pageSize
	result := make([]model.RelayLogSummary, 0, pageSize)

	if offset < cacheCount {
		cacheEnd := offset + pageSize
		if cacheEnd > cacheCount {
			cacheEnd = cacheCount
		}
		result = append(result, cachedLogs[offset:cacheEnd]...)
	}

	if enabled {
		remaining := pageSize - len(result)
		if remaining > 0 {
			dbOffset := 0
			if offset > cacheCount {
				dbOffset = offset - cacheCount
			}
			query := applyRelayLogFilter(db.GetDB().WithContext(ctx).Model(&model.RelayLog{}), filter, hasTimeFilter)

			var dbLogs []model.RelayLogSummary
			if err := query.Select(relayLogSummarySelect()).
				Order("id DESC").
				Offset(dbOffset).
				Limit(remaining).
				Scan(&dbLogs).Error; err != nil {
				return nil, err
			}
			result = append(result, dbLogs...)
		}
	}

	return result, nil
}

func RelayLogCountWithFilter(ctx context.Context, filter RelayLogFilter) (int, error) {
	enabled, err := SettingGetBool(model.SettingKeyRelayLogKeepEnabled)
	if err != nil {
		return 0, err
	}
	hasTimeFilter := filter.StartTime != nil && filter.EndTime != nil
	total := 0

	relayLogCacheLock.Lock()
	for _, item := range relayLogCache {
		if relayLogMatchFilter(item, filter, hasTimeFilter) {
			total++
		}
	}
	relayLogCacheLock.Unlock()

	if enabled {
		var dbTotal int64
		query := applyRelayLogFilter(db.GetDB().WithContext(ctx).Model(&model.RelayLog{}), filter, hasTimeFilter)
		if err := query.Count(&dbTotal).Error; err != nil {
			return 0, err
		}
		total += int(dbTotal)
	}

	return total, nil
}

func RelayLogGet(ctx context.Context, id int64) (model.RelayLog, error) {
	relayLogCacheLock.Lock()
	for _, item := range relayLogCache {
		if item.ID == id {
			relayLogCacheLock.Unlock()
			return item, nil
		}
	}
	relayLogCacheLock.Unlock()

	var relayLog model.RelayLog
	err := db.GetDB().WithContext(ctx).First(&relayLog, "id = ?", id).Error
	return relayLog, err
}

func RelayLogToSummary(relayLog model.RelayLog) model.RelayLogSummary {
	summary := model.RelayLogSummary{
		RelayLog:              relayLog,
		RequestContentLength:  len(relayLog.RequestContent),
		ResponseContentLength: len(relayLog.ResponseContent),
		HasRequestContent:     relayLog.RequestContent != "",
		HasResponseContent:    relayLog.ResponseContent != "",
	}
	summary.RequestContent = ""
	summary.ResponseContent = ""
	return summary
}

func relayLogSummarySelect() []string {
	return []string{
		"id",
		"time",
		"request_model_name",
		"request_api_key_name",
		"router_id",
		"router_name",
		"endpoint_id",
		"endpoint_name",
		"channel_id",
		"channel_key_id",
		"channel_name",
		"actual_model_name",
		"input_tokens",
		"output_tokens",
		"ftut",
		"use_time",
		"cost",
		"cost_currency",
		"cost_currency_symbol",
		"pricing_multiplier",
		"pricing_unit",
		"pricing_rule_source",
		"input_cost_by_currency",
		"output_cost_by_currency",
		"total_cost_by_currency",
		"error",
		"attempts",
		"total_attempts",
		"LENGTH(request_content) AS request_content_length",
		"LENGTH(response_content) AS response_content_length",
		"CASE WHEN request_content <> '' THEN 1 ELSE 0 END AS has_request_content",
		"CASE WHEN response_content <> '' THEN 1 ELSE 0 END AS has_response_content",
	}
}

func applyRelayLogFilter(query *gorm.DB, filter RelayLogFilter, hasTimeFilter bool) *gorm.DB {
	if hasTimeFilter {
		query = query.Where("time >= ? AND time <= ?", *filter.StartTime, *filter.EndTime)
	}
	if filter.APIKeyName != "" {
		query = query.Where("request_api_key_name = ?", filter.APIKeyName)
	}
	if filter.RouterID > 0 {
		query = query.Where("router_id = ?", filter.RouterID)
	}
	if filter.EndpointID > 0 {
		query = query.Where("endpoint_id = ?", filter.EndpointID)
	}
	if filter.Status == "success" {
		query = query.Where("error = ''")
	}
	if filter.Status == "failed" {
		query = query.Where("error <> ''")
	}
	return query
}

func relayLogMatchFilter(item model.RelayLog, filter RelayLogFilter, hasTimeFilter bool) bool {
	if hasTimeFilter && (item.Time < int64(*filter.StartTime) || item.Time > int64(*filter.EndTime)) {
		return false
	}
	if filter.APIKeyName != "" && item.RequestAPIKeyName != filter.APIKeyName {
		return false
	}
	if filter.RouterID > 0 && item.RouterID != filter.RouterID {
		return false
	}
	if filter.EndpointID > 0 && item.EndpointID != filter.EndpointID {
		return false
	}
	if filter.Status == "success" && item.Error != "" {
		return false
	}
	if filter.Status == "failed" && item.Error == "" {
		return false
	}
	return true
}

func RelayLogClear(ctx context.Context) error {
	relayLogCacheLock.Lock()
	relayLogCache = make([]model.RelayLog, 0, relayLogMaxSize)
	relayLogCacheLock.Unlock()
	return db.GetDB().WithContext(ctx).Where("1 = 1").Delete(&model.RelayLog{}).Error
}
