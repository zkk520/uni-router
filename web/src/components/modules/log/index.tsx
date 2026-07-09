'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Clock, Cpu, DollarSign, Eye, KeyRound, Route, Waypoints, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAPIKeyList } from '@/api/endpoints/apikey';
import { useLogPage, type ChannelAttempt, type RelayLog } from '@/api/endpoints/log';
import { useRouterList, type RouteProfile } from '@/api/endpoints/router';
import { AdminPagination, AdminTableShell, AdminToolbar, type RefreshState } from '@/components/common/AdminTable';
import { ResizableColGroup, ResizableTableHead, useResizableColumns, type ResizableColumnConfig } from '@/components/common/ResizableTable';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import { LogCard } from './Item';
import { cn, formatCurrencyCosts } from '@/lib/utils';

const ALL = 'all';
type LogStatusFilter = 'all' | 'success' | 'failed';

const MIN_MANUAL_REFRESH_MS = 650;
const REFRESH_COMPLETED_MS = 900;

const logTableColumns: ResizableColumnConfig[] = [
    { key: 'time', defaultWidth: 150, minWidth: 132, maxWidth: 220 },
    { key: 'modelRoute', defaultWidth: 280, minWidth: 200, maxWidth: 520 },
    { key: 'apiKey', defaultWidth: 170, minWidth: 130, maxWidth: 300 },
    { key: 'router', defaultWidth: 170, minWidth: 130, maxWidth: 300 },
    { key: 'endpoint', defaultWidth: 190, minWidth: 140, maxWidth: 340 },
    { key: 'duration', defaultWidth: 130, minWidth: 112, maxWidth: 190 },
    { key: 'tokens', defaultWidth: 130, minWidth: 110, maxWidth: 200 },
    { key: 'cost', defaultWidth: 110, minWidth: 96, maxWidth: 170 },
    { key: 'status', defaultWidth: 150, minWidth: 120, maxWidth: 230 },
    { key: 'actions', defaultWidth: 100, minWidth: 88, maxWidth: 150 },
];

function formatTimestamp(timestamp: number) {
    return new Date(timestamp * 1000).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

function formatDuration(ms: number) {
    if (!ms) return '0ms';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

function formatCost(log: RelayLog) {
    const formatted = formatCurrencyCosts(log.total_cost_by_currency, log.cost);
    return `${formatted.formatted.value}${formatted.formatted.unit}`;
}

function formatEndpointName(endpointID?: number, endpointName?: string) {
    const name = endpointName?.trim();
    if (name) return name;
    if (endpointID) return `Endpoint #${endpointID}`;
    return '-';
}

function sortAttempts(attempts: ChannelAttempt[]) {
    return [...attempts].sort((a, b) => a.attempt_num - b.attempt_num);
}

function hasFailoverAttempt(log: RelayLog) {
    const attempts = sortAttempts(log.attempts ?? []);

    if (attempts.length > 0) {
        const successIndex = attempts.findIndex((attempt) => attempt.status === 'success');
        return successIndex > 0 || (successIndex === -1 && attempts.length > 1);
    }

    return (log.total_attempts ?? 0) > 1;
}

function getEndpointDisplayMeta(log: RelayLog, routers: RouteProfile[]) {
    const attempts = sortAttempts(log.attempts ?? []);
    const successAttempt = [...attempts].reverse().find((attempt) => attempt.status === 'success');
    const finalEndpointID = successAttempt?.endpoint_id || log.endpoint_id;
    const finalEndpointName = successAttempt?.endpoint_name || log.endpoint_name;
    const label = formatEndpointName(finalEndpointID || log.endpoint_id, finalEndpointName || log.endpoint_name);
    const hasEndpoint = label !== '-';

    if (!hasEndpoint) {
        return { label, roleLabel: '', role: 'unknown' as const };
    }

    const router = routers.find((item) => item.id === log.router_id);
    if (!router) {
        return { label, roleLabel: '', role: 'unknown' as const };
    }

    if (router.mode === 'weighted') {
        return { label, roleLabel: '加权端点', role: 'weighted' as const };
    }

    const matchedEndpoint = finalEndpointID
        ? router.endpoints?.find((endpoint) => endpoint.id === finalEndpointID)
        : router.endpoints?.find((endpoint) => endpoint.name.trim() === finalEndpointName?.trim());
    const endpointID = finalEndpointID || matchedEndpoint?.id;

    if (!endpointID || !router.preferred_endpoint_id) {
        return { label, roleLabel: '', role: 'unknown' as const };
    }

    const isPrimary = endpointID === router.preferred_endpoint_id;

    return {
        label,
        roleLabel: isPrimary ? '主端点' : '备用端点',
        role: isPrimary ? 'primary' as const : 'standby' as const,
    };
}

function endpointRoleBadgeClass(role: ReturnType<typeof getEndpointDisplayMeta>['role']) {
    if (role === 'primary') return 'bg-muted text-muted-foreground hover:bg-muted';
    if (role === 'standby') return 'bg-amber-500/15 text-amber-700 hover:bg-amber-500/15 dark:text-amber-400';
    if (role === 'weighted') return 'bg-sky-500/15 text-sky-700 hover:bg-sky-500/15 dark:text-sky-400';
    return 'bg-muted text-muted-foreground hover:bg-muted';
}

export function Log() {
    const t = useTranslations('log');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [status, setStatus] = useState<LogStatusFilter>('all');
    const [apiKeyName, setAPIKeyName] = useState(ALL);
    const [routerID, setRouterID] = useState(ALL);
    const [endpointID, setEndpointID] = useState(ALL);
    const [refreshState, setRefreshState] = useState<RefreshState>('idle');
    const pendingRefreshAfterPageResetRef = useRef(false);
    const refreshStartedAtRef = useRef(0);
    const refreshTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

    const { data: apiKeys = [] } = useAPIKeyList();
    const { data: routers = [] } = useRouterList();

    const selectedRouterID = routerID === ALL ? undefined : Number(routerID);
    const endpointOptions = useMemo(() => {
        if (!selectedRouterID) {
            return routers.flatMap((router) =>
                (router.endpoints ?? []).map((endpoint) => ({ ...endpoint, routerName: router.name }))
            );
        }
        const router = routers.find((item) => item.id === selectedRouterID);
        return (router?.endpoints ?? []).map((endpoint) => ({ ...endpoint, routerName: router?.name ?? '' }));
    }, [routers, selectedRouterID]);

    const params = useMemo(() => ({
        page,
        page_size: pageSize,
        include_content: false,
        status: status === ALL ? undefined : status,
        api_key_name: apiKeyName === ALL ? undefined : apiKeyName,
        router_id: routerID === ALL ? undefined : Number(routerID),
        endpoint_id: endpointID === ALL ? undefined : Number(endpointID),
    }), [apiKeyName, endpointID, page, pageSize, routerID, status]);

    const { data, isLoading, refetch } = useLogPage(params);
    const rows = data?.items ?? [];
    const { widths, tableWidth, getResizeHandleProps } = useResizableColumns('log', logTableColumns);

    const clearRefreshTimers = useCallback(() => {
        refreshTimersRef.current.forEach((timer) => clearTimeout(timer));
        refreshTimersRef.current = [];
    }, []);

    const setRefreshTimer = useCallback((callback: () => void, delay: number) => {
        const timer = setTimeout(() => {
            refreshTimersRef.current = refreshTimersRef.current.filter((item) => item !== timer);
            callback();
        }, delay);
        refreshTimersRef.current.push(timer);
    }, []);

    const beginManualRefresh = useCallback(() => {
        clearRefreshTimers();
        refreshStartedAtRef.current = Date.now();
        setRefreshState('refreshing');
    }, [clearRefreshTimers]);

    const finishManualRefresh = useCallback(() => {
        const elapsed = Date.now() - refreshStartedAtRef.current;
        const remaining = Math.max(MIN_MANUAL_REFRESH_MS - elapsed, 0);

        setRefreshTimer(() => {
            setRefreshState('completed');
            setRefreshTimer(() => setRefreshState('idle'), REFRESH_COMPLETED_MS);
        }, remaining);
    }, [setRefreshTimer]);

    const handleRefresh = useCallback(async () => {
        beginManualRefresh();

        if (page !== 1) {
            pendingRefreshAfterPageResetRef.current = true;
            setPage(1);
            return;
        }

        try {
            await refetch();
        } finally {
            finishManualRefresh();
        }
    }, [beginManualRefresh, finishManualRefresh, page, refetch]);

    useEffect(() => {
        if (page !== 1 || !pendingRefreshAfterPageResetRef.current) return;

        pendingRefreshAfterPageResetRef.current = false;
        void refetch().finally(() => {
            finishManualRefresh();
        });
    }, [finishManualRefresh, page, refetch]);

    useEffect(() => () => clearRefreshTimers(), [clearRefreshTimers]);

    const handleRouterChange = (value: string) => {
        setRouterID(value);
        setEndpointID(ALL);
        setPage(1);
    };

    return (
        <div className="flex h-full min-h-0 flex-col gap-4">
            <AdminToolbar
                search=""
                searchPlaceholder={t('filters.title')}
                onSearchChange={() => undefined}
                onRefresh={handleRefresh}
                refreshState={refreshState}
                refreshLabel="刷新日志"
                refreshingLabel="正在刷新日志"
                completedLabel="日志已刷新"
                filters={[
                    {
                        label: t('filters.statusAll'),
                        value: status,
                        onChange: (value) => {
                            setStatus(value as LogStatusFilter);
                            setPage(1);
                        },
                        options: [
                            { value: ALL, label: t('filters.statusAll') },
                            { value: 'success', label: t('filters.statusSuccess') },
                            { value: 'failed', label: t('filters.statusFailed') },
                        ],
                    },
                    {
                        label: t('filters.allKeys'),
                        value: apiKeyName,
                        onChange: (value) => {
                            setAPIKeyName(value);
                            setPage(1);
                        },
                        options: [
                            { value: ALL, label: t('filters.allKeys') },
                            ...apiKeys.map((key) => ({ value: key.name, label: key.name })),
                        ],
                    },
                    {
                        label: t('filters.allRouters'),
                        value: routerID,
                        onChange: handleRouterChange,
                        options: [
                            { value: ALL, label: t('filters.allRouters') },
                            ...routers.map((router) => ({ value: String(router.id), label: router.name })),
                        ],
                    },
                    {
                        label: t('filters.allEndpoints'),
                        value: endpointID,
                        onChange: (value) => {
                            setEndpointID(value);
                            setPage(1);
                        },
                        options: [
                            { value: ALL, label: t('filters.allEndpoints') },
                            ...endpointOptions.map((endpoint) => ({
                                value: String(endpoint.id),
                                label: selectedRouterID ? endpoint.name : `${endpoint.routerName} / ${endpoint.name}`,
                            })),
                        ],
                    },
                ]}
            />

            <AdminTableShell>
                <Table className="min-w-full table-fixed" style={{ width: `${tableWidth}px` }}>
                    <ResizableColGroup columns={logTableColumns} widths={widths} />
                    <TableHeader className="sticky top-0 z-10 bg-muted/50">
                        <TableRow>
                            <ResizableTableHead columnKey="time" getResizeHandleProps={getResizeHandleProps}>时间</ResizableTableHead>
                            <ResizableTableHead columnKey="modelRoute" getResizeHandleProps={getResizeHandleProps}>模型链路</ResizableTableHead>
                            <ResizableTableHead columnKey="apiKey" getResizeHandleProps={getResizeHandleProps}>令牌</ResizableTableHead>
                            <ResizableTableHead columnKey="router" getResizeHandleProps={getResizeHandleProps}>路由</ResizableTableHead>
                            <ResizableTableHead columnKey="endpoint" getResizeHandleProps={getResizeHandleProps}>端点</ResizableTableHead>
                            <ResizableTableHead columnKey="duration" getResizeHandleProps={getResizeHandleProps}>耗时</ResizableTableHead>
                            <ResizableTableHead columnKey="tokens" getResizeHandleProps={getResizeHandleProps}>Token</ResizableTableHead>
                            <ResizableTableHead columnKey="cost" getResizeHandleProps={getResizeHandleProps}>成本</ResizableTableHead>
                            <ResizableTableHead columnKey="status" getResizeHandleProps={getResizeHandleProps}>状态</ResizableTableHead>
                            <ResizableTableHead columnKey="actions" align="right" getResizeHandleProps={getResizeHandleProps}>操作</ResizableTableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableRow><TableCell colSpan={10} className="h-32 text-center text-muted-foreground">加载中...</TableCell></TableRow>
                        ) : rows.length === 0 ? (
                            <TableRow><TableCell colSpan={10} className="h-32 text-center text-muted-foreground">暂无日志</TableCell></TableRow>
                        ) : rows.map((log) => {
                            const failed = !!log.error;
                            const requestFailover = hasFailoverAttempt(log);
                            const endpointMeta = getEndpointDisplayMeta(log, routers);
                            const endpointTitle = endpointMeta.roleLabel
                                ? `${endpointMeta.roleLabel}：${endpointMeta.label}`
                                : undefined;
                            return (
                                <TableRow key={log.id}>
                                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                                        <Clock className="mr-1 inline size-3.5" />
                                        {formatTimestamp(log.time)}
                                    </TableCell>
                                    <TableCell>
                                        <div className="min-w-0">
                                            <div className="truncate font-medium">{log.request_model_name}</div>
                                            <div className="truncate text-xs text-muted-foreground">{log.channel_name} / {log.actual_model_name}</div>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex min-w-0 items-center gap-1 text-sm">
                                            <KeyRound className="size-3.5 shrink-0 text-muted-foreground" />
                                            <span className="truncate">{log.request_api_key_name || '-'}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex min-w-0 items-center gap-1 text-sm">
                                            <Route className="size-3.5 shrink-0 text-muted-foreground" />
                                            <span className="truncate">{log.router_name || (log.router_id ? `Router #${log.router_id}` : '-')}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="grid min-w-0 gap-1" title={endpointTitle}>
                                            <div className="flex min-w-0 items-center gap-1 text-sm">
                                                <Waypoints className="size-3.5 shrink-0 text-muted-foreground" />
                                                <span className="truncate">{endpointMeta.label}</span>
                                            </div>
                                            {endpointMeta.label !== '-' ? (
                                                <Badge className={cn(
                                                    'w-fit px-1.5 py-0 text-xs',
                                                    endpointRoleBadgeClass(endpointMeta.role)
                                                )}>
                                                    {endpointMeta.roleLabel || '端点'}
                                                </Badge>
                                            ) : null}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="grid gap-1 text-xs text-muted-foreground">
                                            <span><Zap className="mr-1 inline size-3.5" />FTUT {formatDuration(log.ftut)}</span>
                                            <span><Cpu className="mr-1 inline size-3.5" />{formatDuration(log.use_time)}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="whitespace-nowrap text-sm">
                                        {log.input_tokens.toLocaleString()} / {log.output_tokens.toLocaleString()}
                                    </TableCell>
                                    <TableCell className="whitespace-nowrap font-medium text-emerald-700 dark:text-emerald-400">
                                        <DollarSign className="mr-1 inline size-3.5" />
                                        {formatCost(log)}
                                    </TableCell>
                                    <TableCell>
                                        <Badge className={cn(
                                            failed
                                                ? 'bg-destructive/15 text-destructive hover:bg-destructive/15'
                                                : 'bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15'
                                        )}>
                                            {failed ? '失败' : requestFailover ? '成功 · 已故障转移' : '成功'}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex justify-end">
                                            <LogCard
                                                log={log}
                                                triggerClassName="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                                                trigger={(
                                                    <>
                                                    {failed ? <AlertCircle className="size-3.5" /> : <Eye className="size-3.5" />}
                                                    详情
                                                    </>
                                                )}
                                            />
                                        </div>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </AdminTableShell>

            <AdminPagination
                page={data?.page ?? page}
                pageSize={data?.page_size ?? pageSize}
                total={data?.total ?? 0}
                onPageChange={setPage}
                onPageSizeChange={(value) => {
                    setPageSize(value);
                    setPage(1);
                }}
            />
        </div>
    );
}
