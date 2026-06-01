'use client';

import { useCallback, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, Pie, PieChart, XAxis, YAxis } from 'recharts';
import { Activity, BadgePercent, Clock, Coins, DollarSign, TrendingUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
    useUsageCharts,
    type UsageChartKey,
    type UsageDimension,
    type UsageDistributionItemFormatted,
    type UsageGranularity,
    type UsagePeriod,
    type UsageSeriesChart,
} from '@/api/endpoints/usage';
import { AnimatedNumber } from '@/components/common/AnimatedNumber';
import { PageWrapper } from '@/components/common/PageWrapper';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Tabs, TabsList, TabsTrigger } from '@/components/animate-ui/components/animate/tabs';
import { cn, formatCount, formatMoney } from '@/lib/utils';

const PERIODS: UsagePeriod[] = ['today', 'week', 'month'];
const GRANULARITIES: UsageGranularity[] = ['hour', 'day', 'week'];
const DIMENSIONS: UsageDimension[] = ['model', 'channel', 'router', 'endpoint', 'apikey'];
const CHART_COLORS = [
    'var(--chart-1)',
    'var(--chart-2)',
    'var(--chart-3)',
    'var(--chart-4)',
    'var(--chart-5)',
    '#6366f1',
    '#14b8a6',
    '#f97316',
    '#94a3b8',
];

type SeriesField = {
    key: string;
    field: string;
    label: string;
    color: string;
};

type ChartDatum = Record<string, string | number>;

function formatCountLabel(value: unknown) {
    const formatted = formatCount(Number(value) || 0);
    return `${formatted.formatted.value}${formatted.formatted.unit}`;
}

function formatMoneyLabel(value: unknown) {
    const formatted = formatMoney(Number(value) || 0);
    return `${formatted.formatted.value}${formatted.formatted.unit}`;
}

function formatPercentLabel(value: unknown) {
    return `${(Number(value) || 0).toFixed(1)}%`;
}

function tooltipValue(label: unknown, value: string) {
    return (
        <div className="flex min-w-36 flex-1 items-center justify-between gap-4 leading-none">
            <span className="text-muted-foreground">{String(label)}</span>
            <span className="font-mono font-medium tabular-nums text-foreground">{value}</span>
        </div>
    );
}

function countTooltip(value: unknown, name: unknown) {
    return tooltipValue(name, formatCountLabel(value));
}

function moneyTooltip(value: unknown, name: unknown) {
    return tooltipValue(name, formatMoneyLabel(value));
}

function reliabilityTooltip(value: unknown, name: unknown, item: { dataKey?: unknown }) {
    if (item.dataKey === 'successRate') {
        return tooltipValue(name, formatPercentLabel(value));
    }
    return tooltipValue(name, formatCountLabel(value));
}

function buildSeriesData(chart: UsageSeriesChart | undefined, getLabel: (key: UsageChartKey) => string) {
    const fields: SeriesField[] = (chart?.keys ?? []).map((item, index) => ({
        key: item.key,
        field: `series_${index}`,
        label: getLabel(item),
        color: CHART_COLORS[index % CHART_COLORS.length],
    }));

    const data = (chart?.points ?? []).map((point) => {
        const row: ChartDatum = { label: point.label };
        for (const field of fields) {
            row[field.field] = point.values[field.key] ?? 0;
        }
        return row;
    });

    const config = Object.fromEntries(fields.map((field) => [field.field, {
        label: field.label,
        color: field.color,
    }]));

    return { data, fields, config };
}

function hasSeriesData(data: ChartDatum[], fields: SeriesField[]) {
    return fields.length > 0 && data.some((item) => fields.some((field) => Number(item[field.field] ?? 0) > 0));
}

function buildDistributionData(items: UsageDistributionItemFormatted[] | undefined, getLabel: (key: string, label: string) => string) {
    return (items ?? []).map((item, index) => ({
        key: item.key,
        label: getLabel(item.key, item.label),
        value: item.value.raw,
        percent: item.percent.raw,
        fill: CHART_COLORS[index % CHART_COLORS.length],
    }));
}

function MetricCard({
    title,
    value,
    unit,
    icon: Icon,
    tone,
}: {
    title: string;
    value: string | number | undefined;
    unit?: string;
    icon: ComponentType<{ className?: string }>;
    tone: string;
}) {
    return (
        <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <div className="text-sm text-muted-foreground">{title}</div>
                    <div className="mt-2 flex items-baseline gap-1.5 font-semibold tracking-tight">
                        <span className="text-2xl tabular-nums">
                            <AnimatedNumber value={value} />
                        </span>
                        {unit ? <span className="text-sm text-muted-foreground">{unit}</span> : null}
                    </div>
                </div>
                <div className={cn('flex size-11 shrink-0 items-center justify-center rounded-xl', tone)}>
                    <Icon className="size-5" />
                </div>
            </div>
        </div>
    );
}

function ChartCard({ title, description, children, className }: { title: string; description: string; children: ReactNode; className?: string }) {
    return (
        <section className={cn('rounded-2xl border border-border/70 bg-card p-5 shadow-sm', className)}>
            <div>
                <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            </div>
            {children}
        </section>
    );
}

function EmptyChart({ label }: { label: string }) {
    return (
        <div className="mt-5 flex h-72 items-center justify-center rounded-xl border border-dashed border-border/70 bg-background/60 text-sm text-muted-foreground">
            {label}
        </div>
    );
}

export function Usage() {
    const t = useTranslations('usage');
    const [period, setPeriod] = useState<UsagePeriod>('today');
    const [granularity, setGranularity] = useState<UsageGranularity>('hour');
    const [dimension, setDimension] = useState<UsageDimension>('model');

    const { data: charts } = useUsageCharts(period, dimension, granularity);
    const summary = charts?.summary;
    const labelForKey = useCallback(
        (key: string, label: string) => (key === '__other__' ? t('charts.other') : label || '-'),
        [t]
    );

    const costSeries = useMemo(
        () => buildSeriesData(charts?.cost_distribution, (item) => labelForKey(item.key, item.label)),
        [charts?.cost_distribution, labelForKey]
    );
    const callSeries = useMemo(
        () => buildSeriesData(charts?.call_trend, (item) => labelForKey(item.key, item.label)),
        [charts?.call_trend, labelForKey]
    );
    const callShareData = useMemo(() => buildDistributionData(charts?.call_distribution.items, labelForKey), [charts?.call_distribution.items, labelForKey]);
    const callBarData = useMemo(() => buildDistributionData(charts?.call_bars.items, labelForKey), [charts?.call_bars.items, labelForKey]);
    const reliabilityData = useMemo(() => (charts?.reliability_trend.points ?? []).map((item) => ({
        label: item.label,
        success: item.request_success.raw,
        failed: item.request_failed.raw,
        successRate: item.success_rate.raw,
    })), [charts?.reliability_trend.points]);

    const reliabilityConfig = useMemo(() => ({
        success: { label: t('charts.success'), color: 'var(--chart-2)' },
        failed: { label: t('charts.failed'), color: 'var(--chart-5)' },
        successRate: { label: t('charts.successRate'), color: 'var(--chart-4)' },
    }), [t]);
    const shareConfig = useMemo(() => ({ value: { label: t('charts.callShare.value'), color: 'var(--chart-1)' } }), [t]);
    const callBarConfig = useMemo(() => ({ value: { label: t('charts.callBars.value'), color: 'var(--chart-2)' } }), [t]);

    const summaryCards = [
        { title: t('summary.totalCost'), value: summary?.total_cost.formatted.value, unit: summary?.total_cost.formatted.unit, icon: DollarSign, tone: 'bg-primary/10 text-primary' },
        { title: t('summary.requestCount'), value: summary?.request_count.formatted.value, unit: summary?.request_count.formatted.unit, icon: Activity, tone: 'bg-chart-2/10 text-chart-2' },
        { title: t('summary.totalToken'), value: summary?.total_token.formatted.value, unit: summary?.total_token.formatted.unit, icon: Coins, tone: 'bg-chart-3/10 text-chart-3' },
        { title: t('summary.successRate'), value: summary?.success_rate.formatted.value, unit: '%', icon: BadgePercent, tone: 'bg-chart-4/10 text-chart-4' },
        { title: t('summary.avgWaitTime'), value: summary?.avg_wait_time.formatted.value, unit: summary?.avg_wait_time.formatted.unit, icon: Clock, tone: 'bg-chart-5/10 text-chart-5' },
        { title: t('summary.inputCost'), value: summary?.input_cost.formatted.value, unit: summary?.input_cost.formatted.unit, icon: ArrowDownIcon, tone: 'bg-sky-500/10 text-sky-600 dark:text-sky-400' },
        { title: t('summary.outputCost'), value: summary?.output_cost.formatted.value, unit: summary?.output_cost.formatted.unit, icon: ArrowUpIcon, tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
    ] as const;

    return (
        <PageWrapper className="h-full min-h-0 space-y-6 overflow-y-auto overscroll-contain pb-4">
            <section className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div className="min-w-0">
                        <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                            <TrendingUp className="size-3.5" />
                            {t('eyebrow')}
                        </div>
                        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{t('title')}</h1>
                        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('description')}</p>
                    </div>
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                        <div>
                            <div className="mb-1 text-xs text-muted-foreground">{t('controls.period')}</div>
                            <Tabs value={period} onValueChange={(value) => setPeriod(value as UsagePeriod)}>
                                <TabsList>{PERIODS.map((item) => <TabsTrigger key={item} value={item}>{t(`period.${item}`)}</TabsTrigger>)}</TabsList>
                            </Tabs>
                        </div>
                        <div>
                            <div className="mb-1 text-xs text-muted-foreground">{t('controls.dimension')}</div>
                            <Tabs value={dimension} onValueChange={(value) => setDimension(value as UsageDimension)}>
                                <TabsList>{DIMENSIONS.map((item) => <TabsTrigger key={item} value={item}>{t(`dimension.${item}`)}</TabsTrigger>)}</TabsList>
                            </Tabs>
                        </div>
                        <div>
                            <div className="mb-1 text-xs text-muted-foreground">{t('controls.granularity')}</div>
                            <Tabs value={granularity} onValueChange={(value) => setGranularity(value as UsageGranularity)}>
                                <TabsList>{GRANULARITIES.map((item) => <TabsTrigger key={item} value={item}>{t(`granularity.${item}`)}</TabsTrigger>)}</TabsList>
                            </Tabs>
                        </div>
                    </div>
                </div>
            </section>

            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{summaryCards.slice(0, 4).map((card) => <MetricCard key={card.title} {...card} />)}</section>
            <section className="grid gap-4 md:grid-cols-3">{summaryCards.slice(4).map((card) => <MetricCard key={card.title} {...card} />)}</section>

            <div className="grid gap-6 xl:grid-cols-2">
                <ChartCard title={t('charts.costDistribution.title')} description={t('charts.costDistribution.description')} className="xl:col-span-2">
                    {!hasSeriesData(costSeries.data, costSeries.fields) ? <EmptyChart label={t('charts.empty')} /> : (
                        <ChartContainer config={costSeries.config} className="mt-5 h-80 w-full">
                            <BarChart accessibilityLayer data={costSeries.data}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={18} />
                                <YAxis tickLine={false} axisLine={false} tickFormatter={formatMoneyLabel} />
                                <ChartTooltip cursor={false} content={<ChartTooltipContent formatter={moneyTooltip} />} />
                                <ChartLegend content={<ChartLegendContent />} />
                                {costSeries.fields.map((field) => <Bar key={field.key} dataKey={field.field} stackId="cost" fill={field.color} radius={[4, 4, 0, 0]} />)}
                            </BarChart>
                        </ChartContainer>
                    )}
                </ChartCard>

                <ChartCard title={t('charts.callTrend.title')} description={t('charts.callTrend.description')}>
                    {!hasSeriesData(callSeries.data, callSeries.fields) ? <EmptyChart label={t('charts.empty')} /> : (
                        <ChartContainer config={callSeries.config} className="mt-5 h-72 w-full">
                            <LineChart accessibilityLayer data={callSeries.data}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={18} />
                                <YAxis tickLine={false} axisLine={false} tickFormatter={formatCountLabel} />
                                <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" formatter={countTooltip} />} />
                                <ChartLegend content={<ChartLegendContent />} />
                                {callSeries.fields.map((field) => <Line key={field.key} type="monotone" dataKey={field.field} stroke={field.color} strokeWidth={2} dot={false} />)}
                            </LineChart>
                        </ChartContainer>
                    )}
                </ChartCard>

                <ChartCard title={t('charts.callShare.title')} description={t('charts.callShare.description')}>
                    {callShareData.length === 0 ? <EmptyChart label={t('charts.empty')} /> : (
                        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                            <ChartContainer config={shareConfig} className="h-72 w-full">
                                <PieChart accessibilityLayer>
                                    <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel formatter={countTooltip} />} />
                                    <Pie data={callShareData} dataKey="value" nameKey="label" innerRadius={58} outerRadius={92} paddingAngle={2}>
                                        {callShareData.map((item) => <Cell key={item.key} fill={item.fill} />)}
                                    </Pie>
                                </PieChart>
                            </ChartContainer>
                            <div className="grid content-center gap-2 text-sm">
                                {callShareData.map((item) => (
                                    <div key={item.key} className="flex items-center justify-between gap-3 rounded-lg bg-background/70 px-3 py-2">
                                        <div className="flex min-w-0 items-center gap-2"><span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: item.fill }} /><span className="truncate">{item.label}</span></div>
                                        <span className="shrink-0 font-mono text-xs text-muted-foreground">{item.percent.toFixed(1)}%</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </ChartCard>

                <ChartCard title={t('charts.callBars.title')} description={t('charts.callBars.description')}>
                    {callBarData.length === 0 ? <EmptyChart label={t('charts.empty')} /> : (
                        <ChartContainer config={callBarConfig} className="mt-5 h-72 w-full">
                            <BarChart accessibilityLayer data={callBarData} layout="vertical" margin={{ left: 12 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={formatCountLabel} />
                                <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={96} />
                                <ChartTooltip cursor={false} content={<ChartTooltipContent formatter={countTooltip} />} />
                                <Bar dataKey="value" radius={[0, 6, 6, 0]}>{callBarData.map((item) => <Cell key={item.key} fill={item.fill} />)}</Bar>
                            </BarChart>
                        </ChartContainer>
                    )}
                </ChartCard>

                <ChartCard title={t('charts.reliability.title')} description={t('charts.reliability.description')} className="xl:col-span-2">
                    {reliabilityData.length === 0 ? <EmptyChart label={t('charts.empty')} /> : (
                        <ChartContainer config={reliabilityConfig} className="mt-5 h-80 w-full">
                            <ComposedChart accessibilityLayer data={reliabilityData}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={18} />
                                <YAxis yAxisId="count" tickLine={false} axisLine={false} tickFormatter={formatCountLabel} />
                                <YAxis yAxisId="rate" orientation="right" tickLine={false} axisLine={false} tickFormatter={formatPercentLabel} />
                                <ChartTooltip cursor={false} content={<ChartTooltipContent formatter={reliabilityTooltip} />} />
                                <ChartLegend content={<ChartLegendContent />} />
                                <Bar yAxisId="count" dataKey="success" stackId="requests" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                                <Bar yAxisId="count" dataKey="failed" stackId="requests" fill="var(--chart-5)" radius={[4, 4, 0, 0]} />
                                <Line yAxisId="rate" type="monotone" dataKey="successRate" stroke="var(--chart-4)" strokeWidth={2} dot={false} />
                            </ComposedChart>
                        </ChartContainer>
                    )}
                </ChartCard>
            </div>
        </PageWrapper>
    );
}

function ArrowDownIcon({ className }: { className?: string }) {
    return <span className={cn('text-current', className)} aria-hidden="true">↓</span>;
}

function ArrowUpIcon({ className }: { className?: string }) {
    return <span className={cn('text-current', className)} aria-hidden="true">↑</span>;
}
