'use client';

import { useCallback, useMemo, useState } from 'react';
import { AlertCircle, Clock, Cpu, DollarSign, Eye, KeyRound, Route, Waypoints, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAPIKeyList } from '@/api/endpoints/apikey';
import { useLogPage, type ChannelAttempt, type RelayLog } from '@/api/endpoints/log';
import { useRouterList } from '@/api/endpoints/router';
import { AdminPagination, AdminTableShell, AdminToolbar } from '@/components/common/AdminTable';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
    MorphingDialog,
    MorphingDialogContainer,
    MorphingDialogContent,
    MorphingDialogTrigger,
} from '@/components/ui/morphing-dialog';
import { LogCard } from './Item';
import { cn, formatCurrencyCosts } from '@/lib/utils';

const ALL = 'all';
type LogStatusFilter = 'all' | 'success' | 'failed';

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

function sameEndpoint(a?: ChannelAttempt, endpointID?: number, endpointName?: string) {
    if (!a) return false;
    if (a.endpoint_id && endpointID) return a.endpoint_id === endpointID;
    const attemptName = a.endpoint_name?.trim();
    const name = endpointName?.trim();
    return !!attemptName && !!name && attemptName === name;
}

function getEndpointDisplayMeta(log: RelayLog) {
    const attempts = sortAttempts(log.attempts ?? []);
    const primaryAttempt = attempts.find((attempt) => attempt.endpoint_id || attempt.endpoint_name?.trim());
    const successAttempt = [...attempts].reverse().find((attempt) => attempt.status === 'success');
    const finalEndpointID = successAttempt?.endpoint_id || log.endpoint_id;
    const finalEndpointName = successAttempt?.endpoint_name || log.endpoint_name;
    const label = formatEndpointName(finalEndpointID || log.endpoint_id, finalEndpointName || log.endpoint_name);
    const hasEndpoint = label !== '-';

    if (!hasEndpoint) {
        return { label, isFailover: false, primaryName: '' };
    }

    const isFailover = primaryAttempt
        ? !sameEndpoint(primaryAttempt, finalEndpointID, finalEndpointName)
        : (log.total_attempts ?? 0) > 1;

    return {
        label,
        isFailover,
        primaryName: primaryAttempt ? formatEndpointName(primaryAttempt.endpoint_id, primaryAttempt.endpoint_name) : '',
    };
}

export function Log() {
    const t = useTranslations('log');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
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

    const { data, isLoading, isFetching, refetch } = useLogPage(params);
    const rows = data?.items ?? [];

    const handleRefresh = useCallback(async () => {
        if (page !== 1) {
            setPage(1);
            return;
        }
        await refetch();
    }, [page, refetch]);

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
                isRefreshing={isFetching}
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
                <Table className="min-w-[1240px]">
                    <TableHeader className="sticky top-0 z-10 bg-muted/50">
                        <TableRow>
                            <TableHead>时间</TableHead>
                            <TableHead className="min-w-64">模型链路</TableHead>
                            <TableHead>令牌</TableHead>
                            <TableHead>路由</TableHead>
                            <TableHead>端点</TableHead>
                            <TableHead>耗时</TableHead>
                            <TableHead>Token</TableHead>
                            <TableHead>成本</TableHead>
                            <TableHead>状态</TableHead>
                            <TableHead className="text-right">操作</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableRow><TableCell colSpan={10} className="h-32 text-center text-muted-foreground">加载中...</TableCell></TableRow>
                        ) : rows.length === 0 ? (
                            <TableRow><TableCell colSpan={10} className="h-32 text-center text-muted-foreground">暂无日志</TableCell></TableRow>
                        ) : rows.map((log) => {
                            const failed = !!log.error;
                            const endpointMeta = getEndpointDisplayMeta(log);
                            const endpointTitle = endpointMeta.isFailover && endpointMeta.primaryName
                                ? `主端点：${endpointMeta.primaryName}`
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
                                    <TableCell className="max-w-40">
                                        <div className="flex min-w-0 items-center gap-1 text-sm">
                                            <KeyRound className="size-3.5 shrink-0 text-muted-foreground" />
                                            <span className="truncate">{log.request_api_key_name || '-'}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="max-w-44">
                                        <div className="flex min-w-0 items-center gap-1 text-sm">
                                            <Route className="size-3.5 shrink-0 text-muted-foreground" />
                                            <span className="truncate">{log.router_name || (log.router_id ? `Router #${log.router_id}` : '-')}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="max-w-48">
                                        <div className="grid min-w-0 gap-1" title={endpointTitle}>
                                            <div className="flex min-w-0 items-center gap-1 text-sm">
                                                <Waypoints className="size-3.5 shrink-0 text-muted-foreground" />
                                                <span className="truncate">{endpointMeta.label}</span>
                                            </div>
                                            {endpointMeta.label !== '-' ? (
                                                <Badge className={cn(
                                                    'w-fit px-1.5 py-0 text-xs',
                                                    endpointMeta.isFailover
                                                        ? 'bg-amber-500/15 text-amber-700 hover:bg-amber-500/15 dark:text-amber-400'
                                                        : 'bg-muted text-muted-foreground hover:bg-muted'
                                                )}>
                                                    {endpointMeta.isFailover ? '故障转移' : '主端点'}
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
                                            {failed ? '失败' : '成功'}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex justify-end">
                                            <MorphingDialog>
                                                <MorphingDialogTrigger className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                                                    {failed ? <AlertCircle className="size-3.5" /> : <Eye className="size-3.5" />}
                                                    详情
                                                </MorphingDialogTrigger>
                                                <MorphingDialogContainer>
                                                    <MorphingDialogContent className="w-[calc(100vw-2rem)] max-w-6xl rounded-lg bg-card p-0 text-card-foreground shadow-xl">
                                                        <LogCard log={log} />
                                                    </MorphingDialogContent>
                                                </MorphingDialogContainer>
                                            </MorphingDialog>
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
