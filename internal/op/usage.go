package op

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/zkk520/uni-router/internal/db"
	"github.com/zkk520/uni-router/internal/model"
)

const (
	usagePeriodToday  = "today"
	usagePeriodWeek   = "week"
	usagePeriodMonth  = "month"
	usageBucketHour   = "hour"
	usageBucketDay    = "day"
	usageBucketWeek   = "week"
	usageSortCost     = "cost"
	usageSortCount    = "count"
	usageSortTokens   = "tokens"
	usageDimChannel   = "channel"
	usageDimEndpoint  = "endpoint"
	usageDimModel     = "model"
	usageDimAPIKey    = "apikey"
)

type UsageMetrics struct {
	model.StatsMetrics
	RequestCount int64   `json:"request_count"`
	TotalToken   int64   `json:"total_token"`
	TotalCost    float64 `json:"total_cost"`
	SuccessRate  float64 `json:"success_rate"`
	AvgWaitTime  float64 `json:"avg_wait_time"`
}

type UsageSummary struct {
	Period string `json:"period"`
	StartTime int64 `json:"start_time"`
	EndTime int64 `json:"end_time"`
	UsageMetrics
}

type UsageTrendItem struct {
	BucketStart int64  `json:"bucket_start"`
	BucketEnd   int64  `json:"bucket_end"`
	Label       string `json:"label"`
	Granularity string `json:"granularity"`
	UsageMetrics
}

type UsageRankItem struct {
	Key       string `json:"key"`
	Label     string `json:"label"`
	Dimension string `json:"dimension"`
	UsageMetrics
}

func UsageSummaryGet(ctx context.Context, period string) (UsageSummary, error) {
	start, end, err := usagePeriodRange(period, time.Now())
	if err != nil {
		return UsageSummary{}, err
	}
	period = usageNormalizePeriod(period)

	logs, err := usageLogsInRange(ctx, start, end)
	if err != nil {
		return UsageSummary{}, err
	}

	metrics := usageAggregateLogs(logs)
	return UsageSummary{
		Period: period,
		StartTime: start.Unix(),
		EndTime: end.Unix(),
		UsageMetrics: usageMetricsFromStats(metrics),
	}, nil
}

func UsageTrendList(ctx context.Context, period, granularity string) ([]UsageTrendItem, error) {
	start, end, err := usagePeriodRange(period, time.Now())
	if err != nil {
		return nil, err
	}
	granularity, err = usageNormalizeGranularity(granularity, period)
	if err != nil {
		return nil, err
	}

	logs, err := usageLogsInRange(ctx, start, end)
	if err != nil {
		return nil, err
	}

	buckets := usageBuildTrendBuckets(start, end, granularity)
	for _, log := range logs {
		bucketStart := usageBucketStart(time.Unix(log.Time, 0), granularity)
		bucket, ok := buckets[bucketStart.Unix()]
		if !ok {
			continue
		}
		bucket.metrics.Add(usageLogMetrics(log))
		buckets[bucketStart.Unix()] = bucket
	}

	orderedKeys := make([]int64, 0, len(buckets))
	for key := range buckets {
		orderedKeys = append(orderedKeys, key)
	}
	sort.Slice(orderedKeys, func(i, j int) bool { return orderedKeys[i] < orderedKeys[j] })

	result := make([]UsageTrendItem, 0, len(orderedKeys))
	for _, key := range orderedKeys {
		bucket := buckets[key]
		result = append(result, UsageTrendItem{
			BucketStart: bucket.start.Unix(),
			BucketEnd: bucket.end.Unix(),
			Label: bucket.label,
			Granularity: granularity,
			UsageMetrics: usageMetricsFromStats(bucket.metrics),
		})
	}

	return result, nil
}

func UsageRankList(ctx context.Context, period, dimension, sortBy string) ([]UsageRankItem, error) {
	start, end, err := usagePeriodRange(period, time.Now())
	if err != nil {
		return nil, err
	}
	dimension, err = usageNormalizeDimension(dimension)
	if err != nil {
		return nil, err
	}
	sortBy, err = usageNormalizeSort(sortBy)
	if err != nil {
		return nil, err
	}

	logs, err := usageLogsInRange(ctx, start, end)
	if err != nil {
		return nil, err
	}

	groups := make(map[string]*usageRankGroup)
	for _, log := range logs {
		key, label := usageRankLabel(log, dimension)
		group, ok := groups[key]
		if !ok {
			group = &usageRankGroup{key: key, label: label}
			groups[key] = group
		}
		group.metrics.Add(usageLogMetrics(log))
	}

	result := make([]UsageRankItem, 0, len(groups))
	for _, group := range groups {
		result = append(result, UsageRankItem{
			Key: group.key,
			Label: group.label,
			Dimension: dimension,
			UsageMetrics: usageMetricsFromStats(group.metrics),
		})
	}

	sort.SliceStable(result, func(i, j int) bool {
		left := usageSortValue(result[i], sortBy)
		right := usageSortValue(result[j], sortBy)
		if left == right {
			return result[i].Label < result[j].Label
		}
		return left > right
	})

	return result, nil
}

type usageRankGroup struct {
	key string
	label string
	metrics model.StatsMetrics
}

type usageTrendBucket struct {
	start time.Time
	end time.Time
	label string
	metrics model.StatsMetrics
}

func usageLogsInRange(ctx context.Context, start, end time.Time) ([]model.RelayLog, error) {
	filter := RelayLogFilter{
		StartTime: intPtr(int(start.Unix())),
		EndTime: intPtr(int(end.Unix())),
	}

	logs := make([]model.RelayLog, 0)
	relayLogCacheLock.Lock()
	for _, item := range relayLogCache {
		if relayLogMatchFilter(item, filter, true) {
			logs = append(logs, item)
		}
	}
	relayLogCacheLock.Unlock()

	enabled, err := SettingGetBool(model.SettingKeyRelayLogKeepEnabled)
	if err != nil {
		return nil, err
	}

	if enabled {
		var dbLogs []model.RelayLog
		query := applyRelayLogFilter(db.GetDB().WithContext(ctx).Model(&model.RelayLog{}), filter, true)
		if err := query.Select(relayLogUsageSelect()).Find(&dbLogs).Error; err != nil {
			return nil, err
		}
		logs = append(logs, dbLogs...)
	}

	return logs, nil
}

func usageAggregateLogs(logs []model.RelayLog) model.StatsMetrics {
	var metrics model.StatsMetrics
	for _, log := range logs {
		metrics.Add(usageLogMetrics(log))
	}
	return metrics
}

func usageLogMetrics(log model.RelayLog) model.StatsMetrics {
	metrics := model.StatsMetrics{
		InputToken: int64(log.InputTokens),
		OutputToken: int64(log.OutputTokens),
		WaitTime: int64(log.UseTime),
	}

	if log.Error == "" {
		metrics.RequestSuccess = 1
	} else {
		metrics.RequestFailed = 1
	}

	if len(log.InputCostByCurrency) > 0 {
		metrics.InputCostByCurrency = log.InputCostByCurrency
		metrics.InputCost = usageSumInputCost(log.InputCostByCurrency)
	}
	if len(log.OutputCostByCurrency) > 0 {
		metrics.OutputCostByCurrency = log.OutputCostByCurrency
		metrics.OutputCost = usageSumOutputCost(log.OutputCostByCurrency)
	}
	if len(log.TotalCostByCurrency) > 0 {
		metrics.TotalCostByCurrency = log.TotalCostByCurrency
	}
	if metrics.InputCost == 0 && metrics.OutputCost == 0 && log.Cost != 0 {
		metrics.OutputCost = log.Cost
	}

	return metrics
}

func usageMetricsFromStats(metrics model.StatsMetrics) UsageMetrics {
	requestCount := metrics.RequestSuccess + metrics.RequestFailed
	totalToken := metrics.InputToken + metrics.OutputToken
	totalCost := metrics.InputCost + metrics.OutputCost
	if totalCost == 0 && len(metrics.TotalCostByCurrency) > 0 {
		totalCost = usageSumTotalCost(metrics.TotalCostByCurrency)
	}
	return UsageMetrics{
		StatsMetrics: metrics,
		RequestCount: requestCount,
		TotalToken: totalToken,
		TotalCost: totalCost,
		SuccessRate: usageSuccessRate(metrics.RequestSuccess, requestCount),
		AvgWaitTime: usageAverageWaitTime(metrics.WaitTime, requestCount),
	}
}

func usageSuccessRate(success, total int64) float64 {
	if total <= 0 {
		return 0
	}
	return float64(success) / float64(total) * 100
}

func usageAverageWaitTime(waitTime, total int64) float64 {
	if total <= 0 {
		return 0
	}
	return float64(waitTime) / float64(total)
}

func usageNormalizePeriod(period string) string {
	period = strings.ToLower(strings.TrimSpace(period))
	if period == "" {
		return usagePeriodToday
	}
	return period
}

func usagePeriodRange(period string, now time.Time) (time.Time, time.Time, error) {
	period = usageNormalizePeriod(period)

	loc := now.Location()
	var start time.Time
	switch period {
	case usagePeriodToday:
		start = startOfDay(now)
	case usagePeriodWeek:
		start = startOfWeek(now)
	case usagePeriodMonth:
		start = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc)
	default:
		return time.Time{}, time.Time{}, fmt.Errorf("invalid usage period: %s", period)
	}

	return start, now, nil
}

func usageNormalizeGranularity(granularity, period string) (string, error) {
	granularity = strings.ToLower(strings.TrimSpace(granularity))
	if granularity == "" {
		switch period {
		case usagePeriodToday:
			return usageBucketHour, nil
		default:
			return usageBucketDay, nil
		}
	}
	switch granularity {
	case usageBucketHour, usageBucketDay, usageBucketWeek:
		return granularity, nil
	default:
		return "", fmt.Errorf("invalid usage granularity: %s", granularity)
	}
}

func usageNormalizeDimension(dimension string) (string, error) {
	dimension = strings.ToLower(strings.TrimSpace(dimension))
	if dimension == "" {
		return usageDimChannel, nil
	}
	switch dimension {
	case usageDimChannel, usageDimEndpoint, usageDimModel, usageDimAPIKey:
		return dimension, nil
	default:
		return "", fmt.Errorf("invalid usage dimension: %s", dimension)
	}
}

func usageNormalizeSort(sortBy string) (string, error) {
	sortBy = strings.ToLower(strings.TrimSpace(sortBy))
	if sortBy == "" {
		return usageSortCost, nil
	}
	switch sortBy {
	case usageSortCost, usageSortCount, usageSortTokens:
		return sortBy, nil
	default:
		return "", fmt.Errorf("invalid usage sort: %s", sortBy)
	}
}

func usageBuildTrendBuckets(start, end time.Time, granularity string) map[int64]usageTrendBucket {
	buckets := make(map[int64]usageTrendBucket)
	current := usageBucketStart(start, granularity)
	limit := usageBucketStart(end, granularity)
	for !current.After(limit) {
		next := usageNextBucket(current, granularity)
		buckets[current.Unix()] = usageTrendBucket{
			start: current,
			end: next.Add(-time.Second),
			label: usageBucketLabel(current, granularity),
		}
		current = next
	}
	return buckets
}

func usageBucketStart(t time.Time, granularity string) time.Time {
	switch granularity {
	case usageBucketHour:
		return t.Truncate(time.Hour)
	case usageBucketWeek:
		return startOfWeek(t)
	default:
		return startOfDay(t)
	}
}

func usageNextBucket(t time.Time, granularity string) time.Time {
	switch granularity {
	case usageBucketHour:
		return t.Add(time.Hour)
	case usageBucketWeek:
		return t.AddDate(0, 0, 7)
	default:
		return t.AddDate(0, 0, 1)
	}
}

func usageBucketLabel(t time.Time, granularity string) string {
	switch granularity {
	case usageBucketHour:
		return t.Format("01/02 15:00")
	case usageBucketWeek:
		return t.Format("01/02")
	default:
		return t.Format("01/02")
	}
}

func usageRankLabel(log model.RelayLog, dimension string) (string, string) {
	switch dimension {
	case usageDimEndpoint:
		key := fmt.Sprintf("endpoint:%d", log.EndpointID)
		label := log.EndpointName
		if label == "" {
			if log.EndpointID > 0 {
				label = fmt.Sprintf("Endpoint #%d", log.EndpointID)
			} else {
				label = "-"
			}
		}
		if log.RouterName != "" && log.EndpointName != "" {
			label = fmt.Sprintf("%s / %s", log.RouterName, log.EndpointName)
		}
		return key, label
	case usageDimModel:
		modelName := log.ActualModelName
		if modelName == "" {
			modelName = log.RequestModelName
		}
		key := fmt.Sprintf("model:%d:%s", log.ChannelId, modelName)
		label := modelName
		if log.ChannelName != "" && modelName != "" {
			label = fmt.Sprintf("%s / %s", log.ChannelName, modelName)
		}
		if label == "" {
			label = "-"
		}
		return key, label
	case usageDimAPIKey:
		name := log.RequestAPIKeyName
		if name == "" {
			name = "-"
		}
		return fmt.Sprintf("apikey:%s", name), name
	default:
		name := log.ChannelName
		if name == "" {
			if log.ChannelId > 0 {
				name = fmt.Sprintf("Channel #%d", log.ChannelId)
			} else {
				name = "-"
			}
		}
		return fmt.Sprintf("channel:%d", log.ChannelId), name
	}
}

func usageSortValue(item UsageRankItem, sortBy string) float64 {
	switch sortBy {
	case usageSortCount:
		return float64(item.RequestCount)
	case usageSortTokens:
		return float64(item.TotalToken)
	default:
		return item.TotalCost
	}
}

func usageSumInputCost(costs map[string]model.CostCurrencyMetrics) float64 {
	var total float64
	for _, item := range costs {
		total += item.InputCost
	}
	return total
}

func usageSumOutputCost(costs map[string]model.CostCurrencyMetrics) float64 {
	var total float64
	for _, item := range costs {
		total += item.OutputCost
	}
	return total
}

func usageSumTotalCost(costs map[string]model.CostCurrencyMetrics) float64 {
	var total float64
	for _, item := range costs {
		total += item.TotalCost
	}
	return total
}

func relayLogUsageSelect() []string {
	return []string{
		"id",
		"time",
		"request_api_key_name",
		"router_id",
		"router_name",
		"endpoint_id",
		"endpoint_name",
		"channel_id",
		"channel_name",
		"actual_model_name",
		"request_model_name",
		"input_tokens",
		"output_tokens",
		"use_time",
		"cost",
		"input_cost_by_currency",
		"output_cost_by_currency",
		"total_cost_by_currency",
		"error",
	}
}

func intPtr(value int) *int {
	return &value
}

func startOfDay(t time.Time) time.Time {
	loc := t.Location()
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, loc)
}

func startOfWeek(t time.Time) time.Time {
	loc := t.Location()
	dayStart := startOfDay(t)
	weekday := int(dayStart.Weekday())
	if weekday == 0 {
		weekday = 7
	}
	return dayStart.AddDate(0, 0, -(weekday - 1)).In(loc)
}
