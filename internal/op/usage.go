package op

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/zkk520/uni-router/internal/db"
	"github.com/zkk520/uni-router/internal/model"
	"gorm.io/gorm"
)

const (
	usagePeriodToday   = "today"
	usagePeriodWeek    = "week"
	usagePeriodMonth   = "month"
	usageBucketHour    = "hour"
	usageBucketDay     = "day"
	usageBucketWeek    = "week"
	usageSortCost      = "cost"
	usageSortCount     = "count"
	usageSortTokens    = "tokens"
	usageDimChannel    = "channel"
	usageDimRouter     = "router"
	usageDimEndpoint   = "endpoint"
	usageDimModel      = "model"
	usageDimAPIKey     = "apikey"
	usageChartTopN     = 8
	usageChartOtherKey = "__other__"
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
	Period    string `json:"period"`
	StartTime int64  `json:"start_time"`
	EndTime   int64  `json:"end_time"`
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

type UsageChartKey struct {
	Key   string `json:"key"`
	Label string `json:"label"`
}

type UsageSeriesPoint struct {
	BucketStart int64              `json:"bucket_start"`
	BucketEnd   int64              `json:"bucket_end"`
	Label       string             `json:"label"`
	Values      map[string]float64 `json:"values"`
}

type UsageSeriesChart struct {
	Keys   []UsageChartKey    `json:"keys"`
	Points []UsageSeriesPoint `json:"points"`
}

type UsageDistributionItem struct {
	Key     string  `json:"key"`
	Label   string  `json:"label"`
	Value   float64 `json:"value"`
	Percent float64 `json:"percent"`
	UsageMetrics
}

type UsageDistributionChart struct {
	Items []UsageDistributionItem `json:"items"`
	Total float64                 `json:"total"`
}

type UsageReliabilityPoint struct {
	BucketStart    int64   `json:"bucket_start"`
	BucketEnd      int64   `json:"bucket_end"`
	Label          string  `json:"label"`
	RequestSuccess int64   `json:"request_success"`
	RequestFailed  int64   `json:"request_failed"`
	SuccessRate    float64 `json:"success_rate"`
}

type UsageReliabilityChart struct {
	Points []UsageReliabilityPoint `json:"points"`
}

type UsageCharts struct {
	Period           string                 `json:"period"`
	Dimension        string                 `json:"dimension"`
	Granularity      string                 `json:"granularity"`
	StartTime        int64                  `json:"start_time"`
	EndTime          int64                  `json:"end_time"`
	Summary          UsageSummary           `json:"summary"`
	CostDistribution UsageSeriesChart       `json:"cost_distribution"`
	CallTrend        UsageSeriesChart       `json:"call_trend"`
	CallDistribution UsageDistributionChart `json:"call_distribution"`
	CallBars         UsageDistributionChart `json:"call_bars"`
	ReliabilityTrend UsageReliabilityChart  `json:"reliability_trend"`
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
		Period:       period,
		StartTime:    start.Unix(),
		EndTime:      end.Unix(),
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
			BucketStart:  bucket.start.Unix(),
			BucketEnd:    bucket.end.Unix(),
			Label:        bucket.label,
			Granularity:  granularity,
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
			Key:          group.key,
			Label:        group.label,
			Dimension:    dimension,
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

func UsageChartsGet(ctx context.Context, period, dimension, granularity string) (UsageCharts, error) {
	start, end, err := usagePeriodRange(period, time.Now())
	if err != nil {
		return UsageCharts{}, err
	}
	period = usageNormalizePeriod(period)
	dimension, err = usageNormalizeChartDimension(dimension)
	if err != nil {
		return UsageCharts{}, err
	}
	granularity, err = usageNormalizeGranularity(granularity, period)
	if err != nil {
		return UsageCharts{}, err
	}

	agg, err := usageChartAggregates(ctx, start, end, granularity, dimension)
	if err != nil {
		return UsageCharts{}, err
	}
	metrics := usageMetricsFromStats(agg.summary)
	summary := UsageSummary{
		Period:       period,
		StartTime:    start.Unix(),
		EndTime:      end.Unix(),
		UsageMetrics: metrics,
	}

	return UsageCharts{
		Period:           period,
		Dimension:        dimension,
		Granularity:      granularity,
		StartTime:        start.Unix(),
		EndTime:          end.Unix(),
		Summary:          summary,
		CostDistribution: usageBuildSeriesChart(start, end, agg.buckets, agg.distribution, granularity, usageSortCost),
		CallTrend:        usageBuildSeriesChart(start, end, agg.buckets, agg.distribution, granularity, usageSortCount),
		CallDistribution: usageBuildDistributionChart(agg.distribution, usageSortCount),
		CallBars:         usageBuildDistributionChart(agg.distribution, usageSortCount),
		ReliabilityTrend: usageBuildReliabilityChart(start, end, agg.reliability, granularity),
	}, nil
}

type usageRankGroup struct {
	key     string
	label   string
	metrics model.StatsMetrics
}

type usageChartAggregatedGroup struct {
	key     string
	label   string
	metrics model.StatsMetrics
}

type usageChartAggregateSet struct {
	summary      model.StatsMetrics
	distribution map[string]*usageChartAggregatedGroup
	buckets      map[int64]map[string]*usageChartAggregatedGroup
	reliability  map[int64]model.StatsMetrics
}

type usageChartSQLRow struct {
	BucketStart       int64   `gorm:"column:bucket_start"`
	ChannelID         int     `gorm:"column:channel_id"`
	ChannelName       string  `gorm:"column:channel_name"`
	RouterID          int     `gorm:"column:router_id"`
	RouterName        string  `gorm:"column:router_name"`
	EndpointID        int     `gorm:"column:endpoint_id"`
	EndpointName      string  `gorm:"column:endpoint_name"`
	ActualModelName   string  `gorm:"column:actual_model_name"`
	RequestModelName  string  `gorm:"column:request_model_name"`
	RequestAPIKeyName string  `gorm:"column:request_api_key_name"`
	InputToken        int64   `gorm:"column:input_token"`
	OutputToken       int64   `gorm:"column:output_token"`
	WaitTime          int64   `gorm:"column:wait_time"`
	RequestSuccess    int64   `gorm:"column:request_success"`
	RequestFailed     int64   `gorm:"column:request_failed"`
	Cost              float64 `gorm:"column:cost"`
}

type usageChartDimensionColumns struct {
	selectColumns []string
	groupColumns  []string
}

type usageTrendBucket struct {
	start   time.Time
	end     time.Time
	label   string
	metrics model.StatsMetrics
}

func usageChartAggregates(ctx context.Context, start, end time.Time, granularity, dimension string) (usageChartAggregateSet, error) {
	agg := usageNewChartAggregateSet()

	enabled, err := SettingGetBool(model.SettingKeyRelayLogKeepEnabled)
	if err != nil {
		return agg, err
	}
	if enabled {
		if err := usageAddSQLChartRows(ctx, agg, start, end, granularity, dimension); err != nil {
			return agg, err
		}
	}

	filter := RelayLogFilter{
		StartTime: intPtr(int(start.Unix())),
		EndTime:   intPtr(int(end.Unix())),
	}
	relayLogCacheLock.Lock()
	for _, item := range relayLogCache {
		if relayLogMatchFilter(item, filter, true) {
			usageAddLogToChartAggregates(agg, item, granularity, dimension)
		}
	}
	relayLogCacheLock.Unlock()

	return agg, nil
}

func usageNewChartAggregateSet() usageChartAggregateSet {
	return usageChartAggregateSet{
		distribution: make(map[string]*usageChartAggregatedGroup),
		buckets:      make(map[int64]map[string]*usageChartAggregatedGroup),
		reliability:  make(map[int64]model.StatsMetrics),
	}
}

func usageAddSQLChartRows(ctx context.Context, agg usageChartAggregateSet, start, end time.Time, granularity, dimension string) error {
	rows, err := usageQueryChartDistributionRows(ctx, start, end, dimension)
	if err != nil {
		return err
	}
	for _, row := range rows {
		key, label := usageChartRowLabel(row, dimension)
		metrics := usageStatsFromSQLRow(row)
		agg.summary.Add(metrics)
		usageAddMetricsToGroup(agg.distribution, key, label, metrics)
	}

	rows, err = usageQueryChartSeriesRows(ctx, start, end, granularity, dimension)
	if err != nil {
		return err
	}
	for _, row := range rows {
		key, label := usageChartRowLabel(row, dimension)
		bucketGroups := agg.buckets[row.BucketStart]
		if bucketGroups == nil {
			bucketGroups = make(map[string]*usageChartAggregatedGroup)
			agg.buckets[row.BucketStart] = bucketGroups
		}
		usageAddMetricsToGroup(bucketGroups, key, label, usageStatsFromSQLRow(row))
	}

	rows, err = usageQueryReliabilityRows(ctx, start, end, granularity)
	if err != nil {
		return err
	}
	for _, row := range rows {
		agg.reliability[row.BucketStart] = usageStatsFromSQLRow(row)
	}
	return nil
}

func usageAddLogToChartAggregates(agg usageChartAggregateSet, log model.RelayLog, granularity, dimension string) {
	key, label := usageRankLabel(log, dimension)
	metrics := usageLogMetrics(log)
	agg.summary.Add(metrics)
	usageAddMetricsToGroup(agg.distribution, key, label, metrics)

	bucketStart := usageBucketStart(time.Unix(log.Time, 0), granularity).Unix()
	bucketGroups := agg.buckets[bucketStart]
	if bucketGroups == nil {
		bucketGroups = make(map[string]*usageChartAggregatedGroup)
		agg.buckets[bucketStart] = bucketGroups
	}
	usageAddMetricsToGroup(bucketGroups, key, label, metrics)

	reliability := agg.reliability[bucketStart]
	reliability.Add(metrics)
	agg.reliability[bucketStart] = reliability
}

func usageAddMetricsToGroup(groups map[string]*usageChartAggregatedGroup, key, label string, metrics model.StatsMetrics) {
	group, ok := groups[key]
	if !ok {
		group = &usageChartAggregatedGroup{key: key, label: label}
		groups[key] = group
	}
	group.metrics.Add(metrics)
}

func usageQueryChartDistributionRows(ctx context.Context, start, end time.Time, dimension string) ([]usageChartSQLRow, error) {
	columns := usageChartDimensionSQLColumns(dimension)
	selectParts := append([]string{}, columns.selectColumns...)
	selectParts = append(selectParts, usageChartMetricSelectSQL()...)
	query := db.GetDB().WithContext(ctx).
		Table("relay_logs").
		Select(strings.Join(selectParts, ", ")).
		Where("time >= ? AND time <= ?", start.Unix(), end.Unix())
	if len(columns.groupColumns) > 0 {
		query = query.Group(strings.Join(columns.groupColumns, ", "))
	}
	var rows []usageChartSQLRow
	if err := query.Scan(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

func usageQueryChartSeriesRows(ctx context.Context, start, end time.Time, granularity, dimension string) ([]usageChartSQLRow, error) {
	columns := usageChartDimensionSQLColumns(dimension)
	bucketExpr, bucketArgs := usageBucketSQLExpr(db.GetDB(), granularity, start)
	innerSQL := fmt.Sprintf("SELECT %s AS bucket_start, * FROM relay_logs WHERE time >= ? AND time <= ?", bucketExpr)
	args := append(bucketArgs, start.Unix(), end.Unix())
	selectParts := append([]string{"bucket_start"}, columns.selectColumns...)
	selectParts = append(selectParts, usageChartMetricSelectSQL()...)
	groupParts := append([]string{"bucket_start"}, columns.groupColumns...)
	query := fmt.Sprintf(
		"SELECT %s FROM (%s) AS scoped GROUP BY %s",
		strings.Join(selectParts, ", "),
		innerSQL,
		strings.Join(groupParts, ", "),
	)
	var rows []usageChartSQLRow
	if err := db.GetDB().WithContext(ctx).Raw(query, args...).Scan(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

func usageQueryReliabilityRows(ctx context.Context, start, end time.Time, granularity string) ([]usageChartSQLRow, error) {
	bucketExpr, bucketArgs := usageBucketSQLExpr(db.GetDB(), granularity, start)
	innerSQL := fmt.Sprintf("SELECT %s AS bucket_start, * FROM relay_logs WHERE time >= ? AND time <= ?", bucketExpr)
	args := append(bucketArgs, start.Unix(), end.Unix())
	query := fmt.Sprintf(
		"SELECT bucket_start, %s FROM (%s) AS scoped GROUP BY bucket_start",
		strings.Join(usageChartMetricSelectSQL(), ", "),
		innerSQL,
	)
	var rows []usageChartSQLRow
	if err := db.GetDB().WithContext(ctx).Raw(query, args...).Scan(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

func usageChartDimensionSQLColumns(dimension string) usageChartDimensionColumns {
	switch dimension {
	case usageDimModel:
		columns := []string{"channel_id", "channel_name", "actual_model_name", "request_model_name"}
		return usageChartDimensionColumns{selectColumns: columns, groupColumns: columns}
	case usageDimRouter:
		columns := []string{"router_id", "router_name"}
		return usageChartDimensionColumns{selectColumns: columns, groupColumns: columns}
	case usageDimEndpoint:
		columns := []string{"router_id", "router_name", "endpoint_id", "endpoint_name"}
		return usageChartDimensionColumns{selectColumns: columns, groupColumns: columns}
	case usageDimAPIKey:
		columns := []string{"request_api_key_name"}
		return usageChartDimensionColumns{selectColumns: columns, groupColumns: columns}
	default:
		columns := []string{"channel_id", "channel_name"}
		return usageChartDimensionColumns{selectColumns: columns, groupColumns: columns}
	}
}

func usageChartMetricSelectSQL() []string {
	return []string{
		"COALESCE(SUM(input_tokens), 0) AS input_token",
		"COALESCE(SUM(output_tokens), 0) AS output_token",
		"COALESCE(SUM(use_time), 0) AS wait_time",
		"COALESCE(SUM(CASE WHEN error = '' THEN 1 ELSE 0 END), 0) AS request_success",
		"COALESCE(SUM(CASE WHEN error <> '' THEN 1 ELSE 0 END), 0) AS request_failed",
		"COALESCE(SUM(cost), 0) AS cost",
	}
}

func usageBucketSQLExpr(database *gorm.DB, granularity string, start time.Time) (string, []any) {
	bucketSeconds := int64(time.Hour.Seconds())
	if granularity == usageBucketDay {
		bucketSeconds = int64((24 * time.Hour).Seconds())
	}
	if granularity == usageBucketWeek {
		bucketSeconds = int64((7 * 24 * time.Hour).Seconds())
	}
	startUnix := start.Unix()
	if database != nil && database.Dialector != nil {
		switch database.Dialector.Name() {
		case "postgres":
			return "(FLOOR((time - ?)::numeric / ?)::bigint * ? + ?)", []any{startUnix, bucketSeconds, bucketSeconds, startUnix}
		case "mysql":
			return "(FLOOR((time - ?) / ?) * ? + ?)", []any{startUnix, bucketSeconds, bucketSeconds, startUnix}
		}
	}
	return "(CAST((time - ?) / ? AS INTEGER) * ? + ?)", []any{startUnix, bucketSeconds, bucketSeconds, startUnix}
}

func usageStatsFromSQLRow(row usageChartSQLRow) model.StatsMetrics {
	return model.StatsMetrics{
		InputToken:     row.InputToken,
		OutputToken:    row.OutputToken,
		OutputCost:     row.Cost,
		WaitTime:       row.WaitTime,
		RequestSuccess: row.RequestSuccess,
		RequestFailed:  row.RequestFailed,
	}
}

func usageChartRowLabel(row usageChartSQLRow, dimension string) (string, string) {
	log := model.RelayLog{
		ChannelId:         row.ChannelID,
		ChannelName:       row.ChannelName,
		RouterID:          row.RouterID,
		RouterName:        row.RouterName,
		EndpointID:        row.EndpointID,
		EndpointName:      row.EndpointName,
		ActualModelName:   row.ActualModelName,
		RequestModelName:  row.RequestModelName,
		RequestAPIKeyName: row.RequestAPIKeyName,
	}
	return usageRankLabel(log, dimension)
}

func usageBuildSeriesChart(start, end time.Time, buckets map[int64]map[string]*usageChartAggregatedGroup, distribution map[string]*usageChartAggregatedGroup, granularity, sortBy string) UsageSeriesChart {
	topKeys := usageTopChartKeys(distribution, sortBy)
	keySet := make(map[string]UsageChartKey, len(topKeys)+1)
	for _, item := range topKeys {
		keySet[item.Key] = item
	}

	trendBuckets := usageBuildTrendBuckets(start, end, granularity)
	orderedBuckets := make([]int64, 0, len(trendBuckets))
	for bucket := range trendBuckets {
		orderedBuckets = append(orderedBuckets, bucket)
	}
	sort.Slice(orderedBuckets, func(i, j int) bool { return orderedBuckets[i] < orderedBuckets[j] })

	points := make([]UsageSeriesPoint, 0, len(orderedBuckets))
	otherUsed := false
	for _, bucket := range orderedBuckets {
		values := make(map[string]float64)
		for _, key := range topKeys {
			values[key.Key] = 0
		}
		var otherValue float64
		for key, group := range buckets[bucket] {
			value := usageChartGroupValue(group.metrics, sortBy)
			if _, ok := keySet[key]; ok {
				values[key] += value
				continue
			}
			otherValue += value
		}
		if otherValue > 0 {
			values[usageChartOtherKey] = otherValue
			otherUsed = true
		}
		bucketInfo := trendBuckets[bucket]
		points = append(points, UsageSeriesPoint{
			BucketStart: bucket,
			BucketEnd:   bucketInfo.end.Unix(),
			Label:       bucketInfo.label,
			Values:      values,
		})
	}
	if otherUsed {
		topKeys = append(topKeys, UsageChartKey{Key: usageChartOtherKey, Label: "Other"})
	}
	return UsageSeriesChart{Keys: topKeys, Points: points}
}

func usageBuildDistributionChart(groups map[string]*usageChartAggregatedGroup, sortBy string) UsageDistributionChart {
	ordered := usageSortedChartGroups(groups, sortBy)
	items := make([]UsageDistributionItem, 0, min(len(ordered), usageChartTopN)+1)
	var total float64
	for _, group := range ordered {
		total += usageChartGroupValue(group.metrics, sortBy)
	}

	var other model.StatsMetrics
	for index, group := range ordered {
		value := usageChartGroupValue(group.metrics, sortBy)
		if index >= usageChartTopN {
			other.Add(group.metrics)
			continue
		}
		items = append(items, UsageDistributionItem{
			Key:          group.key,
			Label:        group.label,
			Value:        value,
			Percent:      usagePercent(value, total),
			UsageMetrics: usageMetricsFromStats(group.metrics),
		})
	}
	if usageMetricsFromStats(other).RequestCount > 0 {
		value := usageChartGroupValue(other, sortBy)
		items = append(items, UsageDistributionItem{
			Key:          usageChartOtherKey,
			Label:        "Other",
			Value:        value,
			Percent:      usagePercent(value, total),
			UsageMetrics: usageMetricsFromStats(other),
		})
	}
	return UsageDistributionChart{Items: items, Total: total}
}

func usageBuildReliabilityChart(start, end time.Time, points map[int64]model.StatsMetrics, granularity string) UsageReliabilityChart {
	trendBuckets := usageBuildTrendBuckets(start, end, granularity)
	orderedBuckets := make([]int64, 0, len(trendBuckets))
	for bucket := range trendBuckets {
		orderedBuckets = append(orderedBuckets, bucket)
	}
	sort.Slice(orderedBuckets, func(i, j int) bool { return orderedBuckets[i] < orderedBuckets[j] })

	result := make([]UsageReliabilityPoint, 0, len(orderedBuckets))
	for _, bucket := range orderedBuckets {
		metrics := points[bucket]
		requestCount := metrics.RequestSuccess + metrics.RequestFailed
		bucketInfo := trendBuckets[bucket]
		result = append(result, UsageReliabilityPoint{
			BucketStart:    bucket,
			BucketEnd:      bucketInfo.end.Unix(),
			Label:          bucketInfo.label,
			RequestSuccess: metrics.RequestSuccess,
			RequestFailed:  metrics.RequestFailed,
			SuccessRate:    usageSuccessRate(metrics.RequestSuccess, requestCount),
		})
	}
	return UsageReliabilityChart{Points: result}
}

func usageTopChartKeys(groups map[string]*usageChartAggregatedGroup, sortBy string) []UsageChartKey {
	ordered := usageSortedChartGroups(groups, sortBy)
	limit := min(len(ordered), usageChartTopN)
	keys := make([]UsageChartKey, 0, limit)
	for _, group := range ordered[:limit] {
		keys = append(keys, UsageChartKey{Key: group.key, Label: group.label})
	}
	return keys
}

func usageSortedChartGroups(groups map[string]*usageChartAggregatedGroup, sortBy string) []*usageChartAggregatedGroup {
	ordered := make([]*usageChartAggregatedGroup, 0, len(groups))
	for _, group := range groups {
		ordered = append(ordered, group)
	}
	sort.SliceStable(ordered, func(i, j int) bool {
		left := usageChartGroupValue(ordered[i].metrics, sortBy)
		right := usageChartGroupValue(ordered[j].metrics, sortBy)
		if left == right {
			return ordered[i].label < ordered[j].label
		}
		return left > right
	})
	return ordered
}

func usageChartGroupValue(metrics model.StatsMetrics, sortBy string) float64 {
	switch sortBy {
	case usageSortCount:
		return float64(metrics.RequestSuccess + metrics.RequestFailed)
	case usageSortTokens:
		return float64(metrics.InputToken + metrics.OutputToken)
	default:
		usageMetrics := usageMetricsFromStats(metrics)
		return usageMetrics.TotalCost
	}
}

func usagePercent(value, total float64) float64 {
	if total <= 0 {
		return 0
	}
	return value / total * 100
}

func usageLogsInRange(ctx context.Context, start, end time.Time) ([]model.RelayLog, error) {
	filter := RelayLogFilter{
		StartTime: intPtr(int(start.Unix())),
		EndTime:   intPtr(int(end.Unix())),
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
		InputToken:  int64(log.InputTokens),
		OutputToken: int64(log.OutputTokens),
		WaitTime:    int64(log.UseTime),
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
		TotalToken:   totalToken,
		TotalCost:    totalCost,
		SuccessRate:  usageSuccessRate(metrics.RequestSuccess, requestCount),
		AvgWaitTime:  usageAverageWaitTime(metrics.WaitTime, requestCount),
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
	case usageDimChannel, usageDimRouter, usageDimEndpoint, usageDimModel, usageDimAPIKey:
		return dimension, nil
	default:
		return "", fmt.Errorf("invalid usage dimension: %s", dimension)
	}
}

func usageNormalizeChartDimension(dimension string) (string, error) {
	dimension = strings.ToLower(strings.TrimSpace(dimension))
	if dimension == "" {
		return usageDimModel, nil
	}
	return usageNormalizeDimension(dimension)
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
			end:   next.Add(-time.Second),
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
	case usageDimRouter:
		key := fmt.Sprintf("router:%d", log.RouterID)
		label := log.RouterName
		if label == "" {
			if log.RouterID > 0 {
				label = fmt.Sprintf("Router #%d", log.RouterID)
			} else {
				label = "-"
			}
		}
		return key, label
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
