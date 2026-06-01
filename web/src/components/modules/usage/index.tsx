'use client';

import { useMemo, useState, type ComponentType } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Activity, BadgePercent, Clock, Coins, DollarSign, TrendingUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
    useUsageRank,
    useUsageSummary,
    useUsageTrend,
    type UsageRankItemFormatted,
    type UsageDimension,
    type UsageGranularity,
    type UsagePeriod,
    type UsageSort,
} from '@/api/endpoints/usage';
import { AnimatedNumber } from '@/components/common/AnimatedNumber';
import { PageWrapper } from '@/components/common/PageWrapper';
import { Badge } from '@/components/ui/badge';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Tabs, TabsList, TabsTrigger } from '@/components/animate-ui/components/animate/tabs';
import { cn, formatCount, formatMoney } from '@/lib/utils';

const PERIODS: UsagePeriod[] = ['today', 'week', 'month'];
const GRANULARITIES: UsageGranularity[] = ['hour', 'day', 'week'];
const DIMENSIONS: UsageDimension[] = ['channel', 'endpoint', 'model', 'apikey'];
const SORTS: UsageSort[] = ['cost', 'count', 'tokens'];

function metricColor(metric: UsageSort) {
    switch (metric) {
        case 'count':
            return 'var(--chart-2)';
        case 'tokens':
            return 'var(--chart-3)';
        default:
            return 'var(--chart-1)';
    }
}

function getRankFormattedValue(item: UsageRankItemFormatted, sort: UsageSort) {
    switch (sort) {
        case 'count':
            return item.request_count;
        case 'tokens':
            return item.total_token;
        default:
            return item.total_cost;
    }
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

export function Usage() {
    const t = useTranslations('usage');
    const [period, setPeriod] = useState<UsagePeriod>('today');
    const [trendMetric, setTrendMetric] = useState<UsageSort>('cost');
    const [granularity, setGranularity] = useState<UsageGranularity>('hour');
    const [dimension, setDimension] = useState<UsageDimension>('channel');
    const [sort, setSort] = useState<UsageSort>('cost');

    const { data: summary } = useUsageSummary(period);
    const { data: trend } = useUsageTrend(period, granularity);
    const { data: rank } = useUsageRank(period, dimension, sort);

    const trendData = useMemo(() => {
        return (trend ?? []).map((item) => ({
            label: item.label,
            cost: item.total_cost.raw,
            count: item.request_count.raw,
            tokens: item.total_token.raw,
        }));
    }, [trend]);

    const trendConfig = useMemo(() => ({
        [trendMetric]: {
            label: t(`trend.metric.${trendMetric}`),
            color: metricColor(trendMetric),
        },
    }), [t, trendMetric]);

    const summaryCards = [
        {
            title: t('summary.totalCost'),
            value: summary?.total_cost.formatted.value,
            unit: summary?.total_cost.formatted.unit,
            icon: DollarSign,
            tone: 'bg-primary/10 text-primary',
        },
        {
            title: t('summary.requestCount'),
            value: summary?.request_count.formatted.value,
            unit: summary?.request_count.formatted.unit,
            icon: Activity,
            tone: 'bg-chart-2/10 text-chart-2',
        },
        {
            title: t('summary.totalToken'),
            value: summary?.total_token.formatted.value,
            unit: summary?.total_token.formatted.unit,
            icon: Coins,
            tone: 'bg-chart-3/10 text-chart-3',
        },
        {
            title: t('summary.successRate'),
            value: summary?.success_rate.formatted.value,
            unit: '%',
            icon: BadgePercent,
            tone: 'bg-chart-4/10 text-chart-4',
        },
        {
            title: t('summary.avgWaitTime'),
            value: summary?.avg_wait_time.formatted.value,
            unit: summary?.avg_wait_time.formatted.unit,
            icon: Clock,
            tone: 'bg-chart-5/10 text-chart-5',
        },
        {
            title: t('summary.inputCost'),
            value: summary?.input_cost.formatted.value,
            unit: summary?.input_cost.formatted.unit,
            icon: ArrowDownIcon,
            tone: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
        },
        {
            title: t('summary.outputCost'),
            value: summary?.output_cost.formatted.value,
            unit: summary?.output_cost.formatted.unit,
            icon: ArrowUpIcon,
            tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
        },
    ] as const;

    const topRank = (rank ?? []).slice(0, 10);

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

                    <div className="flex flex-wrap gap-3">
                        <Tabs value={period} onValueChange={(value) => setPeriod(value as UsagePeriod)}>
                            <TabsList>
                                {PERIODS.map((item) => (
                                    <TabsTrigger key={item} value={item}>
                                        {t(`period.${item}`)}
                                    </TabsTrigger>
                                ))}
                            </TabsList>
                        </Tabs>
                    </div>
                </div>
            </section>

            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {summaryCards.slice(0, 4).map((card) => (
                    <MetricCard key={card.title} {...card} />
                ))}
            </section>

            <section className="grid gap-4 md:grid-cols-3">
                {summaryCards.slice(4).map((card) => (
                    <MetricCard key={card.title} {...card} />
                ))}
            </section>

            <section className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <h2 className="text-lg font-semibold tracking-tight">{t('trend.title')}</h2>
                        <p className="mt-1 text-sm text-muted-foreground">{t('trend.description')}</p>
                    </div>

                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                        <Tabs value={trendMetric} onValueChange={(value) => setTrendMetric(value as UsageSort)}>
                            <TabsList>
                                {SORTS.map((item) => (
                                    <TabsTrigger key={item} value={item}>
                                        {t(`trend.metric.${item}`)}
                                    </TabsTrigger>
                                ))}
                            </TabsList>
                        </Tabs>

                        <Tabs value={granularity} onValueChange={(value) => setGranularity(value as UsageGranularity)}>
                            <TabsList>
                                {GRANULARITIES.map((item) => (
                                    <TabsTrigger key={item} value={item}>
                                        {t(`granularity.${item}`)}
                                    </TabsTrigger>
                                ))}
                            </TabsList>
                        </Tabs>
                    </div>
                </div>

                <ChartContainer
                    config={trendConfig}
                    className="mt-5 h-80 w-full"
                >
                    <AreaChart accessibilityLayer data={trendData}>
                        <defs>
                            <linearGradient id="usage-trend-fill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={metricColor(trendMetric)} stopOpacity={0.35} />
                                <stop offset="95%" stopColor={metricColor(trendMetric)} stopOpacity={0.03} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={18} />
                        <YAxis
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) => {
                                const num = Number(value);
                                if (trendMetric === 'cost') {
                                    const formatted = formatMoney(num);
                                    return `${formatted.formatted.value}${formatted.formatted.unit}`;
                                }
                                const formatted = formatCount(num);
                                return `${formatted.formatted.value}${formatted.formatted.unit}`;
                            }}
                        />
                        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
                        <Area
                            type="monotone"
                            dataKey={trendMetric}
                            stroke={metricColor(trendMetric)}
                            fill="url(#usage-trend-fill)"
                            strokeWidth={2}
                        />
                    </AreaChart>
                </ChartContainer>
            </section>

            <section className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <h2 className="text-lg font-semibold tracking-tight">{t('rank.title')}</h2>
                        <p className="mt-1 text-sm text-muted-foreground">{t('rank.description')}</p>
                    </div>

                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                        <Tabs value={dimension} onValueChange={(value) => setDimension(value as UsageDimension)}>
                            <TabsList>
                                {DIMENSIONS.map((item) => (
                                    <TabsTrigger key={item} value={item}>
                                        {t(`rank.dimension.${item}`)}
                                    </TabsTrigger>
                                ))}
                            </TabsList>
                        </Tabs>

                        <Tabs value={sort} onValueChange={(value) => setSort(value as UsageSort)}>
                            <TabsList>
                                {SORTS.map((item) => (
                                    <TabsTrigger key={item} value={item}>
                                        {t(`rank.sort.${item}`)}
                                    </TabsTrigger>
                                ))}
                            </TabsList>
                        </Tabs>
                    </div>
                </div>

                {topRank.length === 0 ? (
                    <div className="flex min-h-48 items-center justify-center rounded-xl border border-dashed border-border/70 bg-background/60 text-sm text-muted-foreground">
                        {t('rank.empty')}
                    </div>
                ) : (
                    <div className="mt-5 grid gap-3">
                        {topRank.map((item, index) => {
                            const value = getRankFormattedValue(item, sort);
                            return (
                                <div
                                    key={item.key}
                                    className="flex flex-col gap-3 rounded-xl border border-border/70 bg-background/70 p-4 transition-colors hover:bg-background md:flex-row md:items-center md:gap-4"
                                >
                                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                                        {index + 1}
                                    </div>

                                    <div className="min-w-0 flex-1">
                                        <div className="truncate font-medium">{item.label}</div>
                                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                            <Badge variant="secondary" className="rounded-full px-2 py-0 text-xs">
                                                {t('rank.meta.requests')}: {item.request_count.formatted.value}{item.request_count.formatted.unit}
                                            </Badge>
                                            <Badge variant="secondary" className="rounded-full px-2 py-0 text-xs">
                                                {t('rank.meta.tokens')}: {item.total_token.formatted.value}{item.total_token.formatted.unit}
                                            </Badge>
                                            <Badge variant="secondary" className="rounded-full px-2 py-0 text-xs">
                                                {t('rank.meta.successRate')}: {item.success_rate.formatted.value}%
                                            </Badge>
                                        </div>
                                    </div>

                                    <div className="shrink-0 text-left md:text-right">
                                        <div className="text-lg font-semibold tabular-nums">
                                            {value.formatted.value}
                                            {value.formatted.unit ? <span className="ml-1 text-sm font-normal text-muted-foreground">{value.formatted.unit}</span> : null}
                                        </div>
                                        <div className="mt-1 text-xs text-muted-foreground">{t(`rank.sort.${sort}`)}</div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>
        </PageWrapper>
    );
}

function ArrowDownIcon({ className }: { className?: string }) {
    return <span className={cn('text-current', className)} aria-hidden="true">↓</span>;
}

function ArrowUpIcon({ className }: { className?: string }) {
    return <span className={cn('text-current', className)} aria-hidden="true">↑</span>;
}
