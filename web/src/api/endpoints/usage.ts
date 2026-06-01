import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../client';
import { formatCount, formatCurrencyCosts, formatTime, type CostCurrencyMetrics } from '@/lib/utils';

export type UsagePeriod = 'today' | 'week' | 'month';
export type UsageGranularity = 'hour' | 'day' | 'week';
export type UsageDimension = 'channel' | 'router' | 'endpoint' | 'model' | 'apikey';
export type UsageSort = 'cost' | 'count' | 'tokens';

export interface UsageMetrics {
    input_token: number;
    output_token: number;
    input_cost: number;
    output_cost: number;
    input_cost_by_currency?: Record<string, CostCurrencyMetrics>;
    output_cost_by_currency?: Record<string, CostCurrencyMetrics>;
    total_cost_by_currency?: Record<string, CostCurrencyMetrics>;
    wait_time: number;
    request_success: number;
    request_failed: number;
    request_count: number;
    total_token: number;
    total_cost: number;
    success_rate: number;
    avg_wait_time: number;
}

export interface UsageMetricsFormatted {
    input_token: ReturnType<typeof formatCount>;
    output_token: ReturnType<typeof formatCount>;
    input_cost: ReturnType<typeof formatCurrencyCosts>;
    output_cost: ReturnType<typeof formatCurrencyCosts>;
    wait_time: ReturnType<typeof formatTime>;
    request_success: ReturnType<typeof formatCount>;
    request_failed: ReturnType<typeof formatCount>;
    request_count: ReturnType<typeof formatCount>;
    total_token: ReturnType<typeof formatCount>;
    total_cost: ReturnType<typeof formatCurrencyCosts>;
    success_rate: ReturnType<typeof formatPercent>;
    avg_wait_time: ReturnType<typeof formatTime>;
}

export interface UsageSummary extends UsageMetrics {
    period: UsagePeriod;
    start_time: number;
    end_time: number;
}

export interface UsageSummaryFormatted extends UsageMetricsFormatted {
    period: UsagePeriod;
    start_time: number;
    end_time: number;
}

export interface UsageTrendItem extends UsageMetrics {
    bucket_start: number;
    bucket_end: number;
    label: string;
    granularity: UsageGranularity;
}

export interface UsageTrendItemFormatted extends UsageMetricsFormatted {
    bucket_start: number;
    bucket_end: number;
    label: string;
    granularity: UsageGranularity;
}

export interface UsageRankItem extends UsageMetrics {
    key: string;
    label: string;
    dimension: UsageDimension;
}

export interface UsageRankItemFormatted extends UsageMetricsFormatted {
    key: string;
    label: string;
    dimension: UsageDimension;
}

export interface UsageChartKey {
    key: string;
    label: string;
}

export interface UsageSeriesPoint {
    bucket_start: number;
    bucket_end: number;
    label: string;
    values: Record<string, number>;
}

export interface UsageSeriesChart {
    keys: UsageChartKey[];
    points: UsageSeriesPoint[];
}

export interface UsageDistributionItem extends UsageMetrics {
    key: string;
    label: string;
    value: number;
    percent: number;
}

export interface UsageDistributionItemFormatted extends UsageMetricsFormatted {
    key: string;
    label: string;
    value: ReturnType<typeof formatCount>;
    percent: ReturnType<typeof formatPercent>;
}

export interface UsageDistributionChart {
    items: UsageDistributionItem[];
    total: number;
}

export interface UsageDistributionChartFormatted {
    items: UsageDistributionItemFormatted[];
    total: ReturnType<typeof formatCount>;
}

export interface UsageReliabilityPoint {
    bucket_start: number;
    bucket_end: number;
    label: string;
    request_success: number;
    request_failed: number;
    success_rate: number;
}

export interface UsageReliabilityPointFormatted {
    bucket_start: number;
    bucket_end: number;
    label: string;
    request_success: ReturnType<typeof formatCount>;
    request_failed: ReturnType<typeof formatCount>;
    success_rate: ReturnType<typeof formatPercent>;
}

export interface UsageReliabilityChart {
    points: UsageReliabilityPoint[];
}

export interface UsageReliabilityChartFormatted {
    points: UsageReliabilityPointFormatted[];
}

export interface UsageChartsResponse {
    period: UsagePeriod;
    dimension: UsageDimension;
    granularity: UsageGranularity;
    start_time: number;
    end_time: number;
    summary: UsageSummary;
    cost_distribution: UsageSeriesChart;
    call_trend: UsageSeriesChart;
    call_distribution: UsageDistributionChart;
    call_bars: UsageDistributionChart;
    reliability_trend: UsageReliabilityChart;
}

export interface UsageChartsResponseFormatted {
    period: UsagePeriod;
    dimension: UsageDimension;
    granularity: UsageGranularity;
    start_time: number;
    end_time: number;
    summary: UsageSummaryFormatted;
    cost_distribution: UsageSeriesChart;
    call_trend: UsageSeriesChart;
    call_distribution: UsageDistributionChartFormatted;
    call_bars: UsageDistributionChartFormatted;
    reliability_trend: UsageReliabilityChartFormatted;
}

function toQuery(params: Record<string, string | number | boolean | undefined>) {
    const query: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === '' || value === 'all') continue;
        query[key] = value;
    }
    return query;
}

function formatPercent(value: number | undefined) {
    const raw = value ?? 0;
    return {
        raw,
        formatted: {
            value: raw.toFixed(1),
            unit: '%',
        },
    };
}

function formatUsageMetrics(metrics: UsageMetrics): UsageMetricsFormatted {
    return {
        input_token: formatCount(metrics.input_token),
        output_token: formatCount(metrics.output_token),
        input_cost: formatCurrencyCosts(metrics.input_cost_by_currency, metrics.input_cost),
        output_cost: formatCurrencyCosts(metrics.output_cost_by_currency, metrics.output_cost),
        wait_time: formatTime(metrics.wait_time),
        request_success: formatCount(metrics.request_success),
        request_failed: formatCount(metrics.request_failed),
        request_count: formatCount(metrics.request_count),
        total_token: formatCount(metrics.total_token),
        total_cost: formatCurrencyCosts(metrics.total_cost_by_currency, metrics.total_cost),
        success_rate: formatPercent(metrics.success_rate),
        avg_wait_time: formatTime(metrics.avg_wait_time),
    };
}

function selectUsageSummary(data: UsageSummary): UsageSummaryFormatted {
    return {
        ...formatUsageMetrics(data),
        period: data.period,
        start_time: data.start_time,
        end_time: data.end_time,
    };
}

function selectUsageTrendItem(data: UsageTrendItem): UsageTrendItemFormatted {
    return {
        ...formatUsageMetrics(data),
        bucket_start: data.bucket_start,
        bucket_end: data.bucket_end,
        label: data.label,
        granularity: data.granularity,
    };
}

function selectUsageRankItem(data: UsageRankItem): UsageRankItemFormatted {
    return {
        ...formatUsageMetrics(data),
        key: data.key,
        label: data.label,
        dimension: data.dimension,
    };
}

function selectUsageDistributionItem(data: UsageDistributionItem): UsageDistributionItemFormatted {
    return {
        ...formatUsageMetrics(data),
        key: data.key,
        label: data.label,
        value: formatCount(data.value),
        percent: formatPercent(data.percent),
    };
}

function selectUsageReliabilityPoint(data: UsageReliabilityPoint): UsageReliabilityPointFormatted {
    return {
        bucket_start: data.bucket_start,
        bucket_end: data.bucket_end,
        label: data.label,
        request_success: formatCount(data.request_success),
        request_failed: formatCount(data.request_failed),
        success_rate: formatPercent(data.success_rate),
    };
}

function selectUsageCharts(data: UsageChartsResponse): UsageChartsResponseFormatted {
    return {
        period: data.period,
        dimension: data.dimension,
        granularity: data.granularity,
        start_time: data.start_time,
        end_time: data.end_time,
        summary: selectUsageSummary(data.summary),
        cost_distribution: data.cost_distribution,
        call_trend: data.call_trend,
        call_distribution: {
            items: data.call_distribution.items.map(selectUsageDistributionItem),
            total: formatCount(data.call_distribution.total),
        },
        call_bars: {
            items: data.call_bars.items.map(selectUsageDistributionItem),
            total: formatCount(data.call_bars.total),
        },
        reliability_trend: {
            points: data.reliability_trend.points.map(selectUsageReliabilityPoint),
        },
    };
}

export function useUsageSummary(period: UsagePeriod = 'today') {
    return useQuery({
        queryKey: ['usage', 'summary', period],
        queryFn: async () => apiClient.get<UsageSummary>('/api/v1/usage/summary', toQuery({ period })),
        select: selectUsageSummary,
        refetchInterval: 30000,
        refetchOnMount: 'always',
    });
}

export function useUsageTrend(period: UsagePeriod = 'today', granularity: UsageGranularity = 'hour') {
    return useQuery({
        queryKey: ['usage', 'trend', period, granularity],
        queryFn: async () => apiClient.get<UsageTrendItem[]>('/api/v1/usage/trend', toQuery({ period, granularity })),
        select: (data) => data.map(selectUsageTrendItem),
        refetchInterval: 30000,
        refetchOnMount: 'always',
    });
}

export function useUsageRank(
    period: UsagePeriod = 'today',
    dimension: UsageDimension = 'channel',
    sort: UsageSort = 'cost'
) {
    return useQuery({
        queryKey: ['usage', 'rank', period, dimension, sort],
        queryFn: async () => apiClient.get<UsageRankItem[]>('/api/v1/usage/rank', toQuery({ period, dimension, sort })),
        select: (data) => data.map(selectUsageRankItem),
        refetchInterval: 30000,
        refetchOnMount: 'always',
    });
}

export function useUsageCharts(
    period: UsagePeriod = 'today',
    dimension: UsageDimension = 'model',
    granularity?: UsageGranularity
) {
    return useQuery({
        queryKey: ['usage', 'charts', period, dimension, granularity],
        queryFn: async () => apiClient.get<UsageChartsResponse>('/api/v1/usage/charts', toQuery({ period, dimension, granularity })),
        select: selectUsageCharts,
        refetchInterval: 30000,
        refetchOnMount: 'always',
    });
}
