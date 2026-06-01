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

func TestUsageNormalizeChartDimensionDefaultsToModel(t *testing.T) {
	dimension, err := usageNormalizeChartDimension("")
	if err != nil {
		t.Fatalf("normalize dimension: %v", err)
	}
	if dimension != usageDimModel {
		t.Fatalf("dimension = %q, want %q", dimension, usageDimModel)
	}
}
