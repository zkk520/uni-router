'use client';

import { useCallback, useMemo, useState } from 'react';
import { useLogs } from '@/api/endpoints/log';
import { LogCard } from './Item';
import { Filter, Loader2, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { VirtualizedGrid } from '@/components/common/VirtualizedGrid';
import { useAPIKeyList } from '@/api/endpoints/apikey';
import { useRouterList } from '@/api/endpoints/router';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

const ALL = 'all';
type LogStatusFilter = 'all' | 'success' | 'failed';

/**
 * 日志页面组件
 * - 初始加载 pageSize 条历史日志
 * - SSE 实时推送新日志
 * - 滚动自动加载更多
 */
export function Log() {
    const t = useTranslations('log');
    const [status, setStatus] = useState<LogStatusFilter>('all');
    const [apiKeyName, setAPIKeyName] = useState(ALL);
    const [routerID, setRouterID] = useState(ALL);
    const [endpointID, setEndpointID] = useState(ALL);

    const { data: apiKeys = [] } = useAPIKeyList();
    const { data: routers = [] } = useRouterList();

    const selectedRouterID = routerID === ALL ? undefined : Number(routerID);
    const endpointOptions = useMemo(() => {
        if (!selectedRouterID) {
            return routers.flatMap((router) =>
                (router.endpoints ?? []).map((endpoint) => ({
                    ...endpoint,
                    routerName: router.name,
                }))
            );
        }
        const router = routers.find((item) => item.id === selectedRouterID);
        return (router?.endpoints ?? []).map((endpoint) => ({
            ...endpoint,
            routerName: router?.name ?? '',
        }));
    }, [routers, selectedRouterID]);

    const filters = useMemo(() => ({
        status: status === 'all' ? undefined : status,
        api_key_name: apiKeyName === ALL ? undefined : apiKeyName,
        router_id: routerID === ALL ? undefined : Number(routerID),
        endpoint_id: endpointID === ALL ? undefined : Number(endpointID),
    }), [apiKeyName, endpointID, routerID, status]);

    const hasActiveFilters = status !== 'all' || apiKeyName !== ALL || routerID !== ALL || endpointID !== ALL;
    const { logs, hasMore, isLoading, isLoadingMore, loadMore } = useLogs({ pageSize: 10, filters });

    const canLoadMore = hasMore && !isLoading && !isLoadingMore && logs.length > 0;
    const handleReachEnd = useCallback(() => {
        if (!canLoadMore) return;
        void loadMore();
    }, [canLoadMore, loadMore]);

    const resetFilters = useCallback(() => {
        setStatus('all');
        setAPIKeyName(ALL);
        setRouterID(ALL);
        setEndpointID(ALL);
    }, []);

    const handleRouterChange = useCallback((value: string) => {
        setRouterID(value);
        setEndpointID(ALL);
    }, []);

    const footer = useMemo(() => {
        if (hasMore && (isLoading || isLoadingMore)) {
            return (
                <div className="flex justify-center py-4">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
            );
        }
        if (!hasMore && logs.length > 0) {
            return (
                <div className="flex justify-center py-4">
                    <span className="text-sm text-muted-foreground">{t('list.noMore')}</span>
                </div>
            );
        }
        return null;
    }, [hasMore, isLoading, isLoadingMore, logs.length, t]);

    return (
        <div className="flex h-full min-h-0 flex-col gap-3">
            <div className="shrink-0 rounded-2xl border border-border bg-card p-3">
                <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <Filter className="size-3.5" />
                        {t('filters.title')}
                    </div>

                    <Select value={status} onValueChange={(value) => setStatus(value as LogStatusFilter)}>
                        <SelectTrigger size="sm" className="w-[132px] rounded-xl">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl">
                            <SelectItem value="all">{t('filters.statusAll')}</SelectItem>
                            <SelectItem value="success">{t('filters.statusSuccess')}</SelectItem>
                            <SelectItem value="failed">{t('filters.statusFailed')}</SelectItem>
                        </SelectContent>
                    </Select>

                    <Select value={apiKeyName} onValueChange={setAPIKeyName}>
                        <SelectTrigger size="sm" className="w-[160px] rounded-xl">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl">
                            <SelectItem value={ALL}>{t('filters.allKeys')}</SelectItem>
                            {apiKeys.map((key) => (
                                <SelectItem key={key.id} value={key.name}>
                                    {key.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Select value={routerID} onValueChange={handleRouterChange}>
                        <SelectTrigger size="sm" className="w-[170px] rounded-xl">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl">
                            <SelectItem value={ALL}>{t('filters.allRouters')}</SelectItem>
                            {routers.map((router) => (
                                <SelectItem key={router.id} value={String(router.id)}>
                                    {router.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Select value={endpointID} onValueChange={setEndpointID}>
                        <SelectTrigger size="sm" className="w-[190px] rounded-xl">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl">
                            <SelectItem value={ALL}>{t('filters.allEndpoints')}</SelectItem>
                            {endpointOptions.map((endpoint) => (
                                <SelectItem key={endpoint.id} value={String(endpoint.id)}>
                                    {selectedRouterID ? endpoint.name : `${endpoint.routerName} / ${endpoint.name}`}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    {hasActiveFilters && (
                        <button
                            type="button"
                            onClick={resetFilters}
                            className="ml-auto flex h-8 items-center gap-1.5 rounded-xl border border-border bg-muted/30 px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                            <RotateCcw className="size-3.5" />
                            {t('filters.reset')}
                        </button>
                    )}
                </div>
            </div>

            <div className="min-h-0 flex-1">
                <VirtualizedGrid
                    items={logs}
                    layout="list"
                    columns={{ default: 1 }}
                    estimateItemHeight={120}
                    overscan={8}
                    getItemKey={(log) => `log-${log.id}`}
                    renderItem={(log) => <LogCard log={log} />}
                    footer={footer}
                    onReachEnd={handleReachEnd}
                    reachEndEnabled={canLoadMore}
                    reachEndOffset={2}
                />
            </div>
        </div>
    );
}
