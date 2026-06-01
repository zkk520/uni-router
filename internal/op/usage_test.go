package op

import (
	"testing"
	"time"

	"github.com/zkk520/uni-router/internal/model"
)

func TestUsageBuildSeriesChartFillsEmptyBuckets(t *testing.T) {
	start := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	end := start.Add(2 * time.Hour)
	group := &usageChartAggregatedGroup{
		key:   "model:1:gpt-test",
		label: "gpt-test",
		metrics: model.StatsMetrics{
			RequestSuccess: 2,
		},
	}

	chart := usageBuildSeriesChart(
		start,
		end,
		map[int64]map[string]*usageChartAggregatedGroup{
			start.Add(time.Hour).Unix(): {group.key: group},
		},
		map[string]*usageChartAggregatedGroup{group.key: group},
		usageBucketHour,
		usageSortCount,
	)

	if len(chart.Points) != 3 {
		t.Fatalf("points = %d, want 3", len(chart.Points))
	}
	if chart.Points[0].Values[group.key] != 0 {
		t.Fatalf("first bucket = %v, want 0", chart.Points[0].Values[group.key])
	}
	if chart.Points[1].Values[group.key] != 2 {
		t.Fatalf("second bucket = %v, want 2", chart.Points[1].Values[group.key])
	}
	if chart.Points[2].Values[group.key] != 0 {
		t.Fatalf("third bucket = %v, want 0", chart.Points[2].Values[group.key])
	}
}

func TestUsageBuildReliabilityChartFillsEmptyBuckets(t *testing.T) {
	start := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	end := start.Add(2 * time.Hour)

	chart := usageBuildReliabilityChart(start, end, map[int64]model.StatsMetrics{
		start.Unix(): {RequestSuccess: 3, RequestFailed: 1},
	}, usageBucketHour)

	if len(chart.Points) != 3 {
		t.Fatalf("points = %d, want 3", len(chart.Points))
	}
	if chart.Points[0].SuccessRate != 75 {
		t.Fatalf("first bucket success rate = %v, want 75", chart.Points[0].SuccessRate)
	}
	if chart.Points[1].RequestSuccess != 0 || chart.Points[1].RequestFailed != 0 || chart.Points[1].SuccessRate != 0 {
		t.Fatalf("empty bucket = %#v, want zero metrics", chart.Points[1])
	}
}

func TestUsageAddLogToChartAggregatesUpdatesSummaryAndCharts(t *testing.T) {
	start := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	agg := usageNewChartAggregateSet()

	usageAddLogToChartAggregates(&agg, model.RelayLog{
		Time:            start.Unix(),
		ChannelId:       1,
		ChannelName:     "test-channel",
		ActualModelName: "gpt-test",
		InputTokens:     10,
		OutputTokens:    20,
		UseTime:         300,
		Cost:            0.42,
	}, usageBucketHour, usageDimModel)

	if agg.summary.OutputCost != 0.42 {
		t.Fatalf("summary output cost = %v, want 0.42", agg.summary.OutputCost)
	}
	if agg.summary.RequestSuccess != 1 {
		t.Fatalf("summary request success = %d, want 1", agg.summary.RequestSuccess)
	}
	if len(agg.distribution) != 1 {
		t.Fatalf("distribution groups = %d, want 1", len(agg.distribution))
	}
	if len(agg.buckets[start.Unix()]) != 1 {
		t.Fatalf("bucket groups = %d, want 1", len(agg.buckets[start.Unix()]))
	}
}

func TestUsageNormalizeChartDimensionDefaultsToModel(t *testing.T) {
	dimension, err := usageNormalizeChartDimension("")
	if err != nil {
		t.Fatalf("normalize dimension: %v", err)
	}
	if dimension != usageDimModel {
		t.Fatalf("dimension = %q, want %q", dimension, usageDimModel)
	}
}
