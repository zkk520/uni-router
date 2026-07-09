'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Ban, CheckCircle2, Edit3, Plus, Radio, Trash2, X } from 'lucide-react';
import {
    useBatchChannel,
    useChannelPage,
    ChannelType,
    useEnableChannel,
    useDeleteChannel,
    type Channel,
    type ChannelBatchAction,
    type ChannelBatchRequest,
    type ChannelBatchResult,
} from '@/api/endpoints/channel';
import { AdminPagination, AdminTableShell, AdminToolbar } from '@/components/common/AdminTable';
import { ResizableColGroup, ResizableTableHead, useResizableColumns, type ResizableColumnConfig } from '@/components/common/ResizableTable';
import { toast } from '@/components/common/Toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
    MorphingDialog,
    MorphingDialogContainer,
    MorphingDialogContent,
    MorphingDialogTrigger,
} from '@/components/ui/morphing-dialog';
import { CreateDialogContent } from './Create';
import { CardContent } from './CardContent';
import { cn } from '@/lib/utils';

const channelTableColumns: ResizableColumnConfig[] = [
    { key: 'select', defaultWidth: 52, minWidth: 48, maxWidth: 60, resizable: false },
    { key: 'name', defaultWidth: 300, minWidth: 220, maxWidth: 520 },
    { key: 'protocol', defaultWidth: 150, minWidth: 120, maxWidth: 240 },
    { key: 'keys', defaultWidth: 90, minWidth: 72, maxWidth: 140 },
    { key: 'models', defaultWidth: 90, minWidth: 72, maxWidth: 140 },
    { key: 'requests', defaultWidth: 110, minWidth: 88, maxWidth: 180 },
    { key: 'cost', defaultWidth: 110, minWidth: 88, maxWidth: 180 },
    { key: 'status', defaultWidth: 96, minWidth: 84, maxWidth: 140 },
    { key: 'actions', defaultWidth: 190, minWidth: 170, maxWidth: 260 },
];

function channelTypeLabel(type: ChannelType) {
    switch (type) {
        case ChannelType.OpenAIChat:
            return 'OpenAI Chat';
        case ChannelType.NewAPIChat:
            return 'OpenAI 兼容';
        case ChannelType.OpenAIResponse:
            return 'OpenAI Response';
        case ChannelType.Anthropic:
            return 'Anthropic';
        case ChannelType.Gemini:
            return 'Gemini';
        case ChannelType.Volcengine:
            return '火山引擎';
        case ChannelType.OpenAIEmbedding:
            return 'OpenAI Embedding';
        default:
            return String(type);
    }
}

function batchActionLabel(action: ChannelBatchAction) {
    switch (action) {
        case 'enable':
            return '启用';
        case 'disable':
            return '停用';
        case 'delete':
            return '删除';
    }
}

function modelCount(channel: Channel) {
    const names = new Set<string>();
    const add = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean).forEach((item) => names.add(item));
    add(channel.model);
    add(channel.custom_model);
    for (const key of channel.keys) {
        for (const model of key.models ?? []) names.add(model);
    }
    return names.size;
}

function CheckboxInput({
    checked,
    indeterminate = false,
    label,
    disabled,
    onChange,
}: {
    checked: boolean;
    indeterminate?: boolean;
    label: string;
    disabled?: boolean;
    onChange: (checked: boolean) => void;
}) {
    const ref = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (ref.current) {
            ref.current.indeterminate = indeterminate;
        }
    }, [indeterminate]);

    return (
        <input
            ref={ref}
            type="checkbox"
            className="size-4 rounded border-border accent-primary disabled:opacity-50"
            checked={checked}
            disabled={disabled}
            aria-label={label}
            onChange={(event) => onChange(event.currentTarget.checked)}
        />
    );
}

export function Channel() {
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [keyword, setKeyword] = useState('');
    const [enabled, setEnabled] = useState<string>('all');
    const [type, setType] = useState<string>('all');
    const [deleteTarget, setDeleteTarget] = useState<Channel | null>(null);
    const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
    const [allFilteredSelected, setAllFilteredSelected] = useState(false);
    const [excludedIds, setExcludedIds] = useState<Set<number>>(() => new Set());
    const enableChannel = useEnableChannel();
    const deleteChannel = useDeleteChannel();
    const batchChannel = useBatchChannel();

    const clearSelection = () => {
        setSelectedIds(new Set());
        setAllFilteredSelected(false);
        setExcludedIds(new Set());
    };

    const queryParams = useMemo(() => ({
        page,
        page_size: pageSize,
        keyword,
        enabled: enabled === 'all' ? 'all' as const : enabled === 'true',
        type: type === 'all' ? 'all' as const : Number(type),
        sort_by: 'id',
        sort_order: 'desc' as const,
    }), [enabled, keyword, page, pageSize, type]);

    const batchFilter = useMemo(() => ({
        keyword: keyword.trim() || undefined,
        enabled: enabled === 'all' ? undefined : enabled === 'true',
        type: type === 'all' ? undefined : Number(type),
    }), [enabled, keyword, type]);

    const { data, isLoading, refetch } = useChannelPage(queryParams);
    const rows = useMemo(() => data?.items ?? [], [data?.items]);
    const total = data?.total ?? 0;
    const { widths, tableWidth, getResizeHandleProps } = useResizableColumns('channel', channelTableColumns);
    const selectedCount = allFilteredSelected ? Math.max(0, total - excludedIds.size) : selectedIds.size;
    const hasSelection = selectedCount > 0;
    const currentPageIds = useMemo(() => rows.map(({ raw }) => raw.id), [rows]);
    const selectedOnPage = currentPageIds.filter((id) => allFilteredSelected ? !excludedIds.has(id) : selectedIds.has(id)).length;
    const allPageSelected = rows.length > 0 && selectedOnPage === rows.length;
    const somePageSelected = selectedOnPage > 0 && !allPageSelected;
    const isBatchPending = batchChannel.isPending;

    const isRowSelected = (id: number) => allFilteredSelected ? !excludedIds.has(id) : selectedIds.has(id);

    const setCurrentPageSelected = (checked: boolean) => {
        if (allFilteredSelected) {
            setExcludedIds((prev) => {
                const next = new Set(prev);
                for (const id of currentPageIds) {
                    if (checked) next.delete(id);
                    else next.add(id);
                }
                return next;
            });
            return;
        }

        setSelectedIds((prev) => {
            const next = new Set(prev);
            for (const id of currentPageIds) {
                if (checked) next.add(id);
                else next.delete(id);
            }
            return next;
        });
    };

    const setRowSelected = (id: number, checked: boolean) => {
        if (allFilteredSelected) {
            setExcludedIds((prev) => {
                const next = new Set(prev);
                if (checked) next.delete(id);
                else next.add(id);
                return next;
            });
            return;
        }

        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (checked) next.add(id);
            else next.delete(id);
            return next;
        });
    };

    const buildBatchRequest = (action: ChannelBatchAction): ChannelBatchRequest => {
        if (allFilteredSelected) {
            return {
                action,
                scope: 'filter',
                filter: batchFilter,
                exclude_ids: Array.from(excludedIds),
            };
        }

        return {
            action,
            scope: 'ids',
            ids: Array.from(selectedIds),
        };
    };

    const handleBatchSuccess = (action: ChannelBatchAction, result: ChannelBatchResult) => {
        if (result.failed > 0) {
            const failedIds = result.failed_items.map((item) => item.id);
            setAllFilteredSelected(false);
            setExcludedIds(new Set());
            setSelectedIds(new Set(failedIds));
            toast.warning(`供应商批量${batchActionLabel(action)}部分完成`, {
                description: `成功 ${result.succeeded} 个，失败 ${result.failed} 个。失败项已保留，可重试。`,
            });
        } else {
            clearSelection();
            toast.success(`供应商批量${batchActionLabel(action)}完成`, {
                description: `已处理 ${result.succeeded} 个供应商。`,
            });
        }
        void refetch();
    };

    const executeBatch = (action: ChannelBatchAction) => {
        if (!hasSelection) return;
        batchChannel.mutate(buildBatchRequest(action), {
            onSuccess: (result) => handleBatchSuccess(action, result),
            onError: (error) => {
                const errorMessage = error instanceof Error ? error.message : String(error);
                toast.error(`供应商批量${batchActionLabel(action)}失败`, { description: errorMessage });
            },
        });
    };

    const handleDeleteConfirm = (channel: Channel) => {
        deleteChannel.mutate(channel.id, {
            onSuccess: () => {
                toast.success('供应商已删除');
                setDeleteTarget(null);
                if (rows.length === 1 && page > 1) {
                    setPage(page - 1);
                }
            },
            onError: (error) => {
                const errorMessage = error instanceof Error ? error.message : String(error);
                toast.error('删除供应商失败', { description: errorMessage });
                setDeleteTarget(null);
            },
        });
    };

    return (
        <div className="flex h-full min-h-0 flex-col gap-4">
            <AdminToolbar
                search={keyword}
                searchPlaceholder="搜索供应商或模型..."
                onSearchChange={(value) => {
                    setKeyword(value);
                    setPage(1);
                    clearSelection();
                }}
                onRefresh={() => refetch()}
                filters={[
                    {
                        label: '状态',
                        value: enabled,
                        onChange: (value) => {
                            setEnabled(value);
                            setPage(1);
                            clearSelection();
                        },
                        options: [
                            { value: 'all', label: '全部状态' },
                            { value: 'true', label: '已启用' },
                            { value: 'false', label: '已停用' },
                        ],
                    },
                    {
                        label: '协议',
                        value: type,
                        onChange: (value) => {
                            setType(value);
                            setPage(1);
                            clearSelection();
                        },
                        options: [
                            { value: 'all', label: '全部协议' },
                            { value: String(ChannelType.OpenAIChat), label: 'OpenAI Chat' },
                            { value: String(ChannelType.OpenAIResponse), label: 'OpenAI Response' },
                            { value: String(ChannelType.Anthropic), label: 'Anthropic' },
                            { value: String(ChannelType.Gemini), label: 'Gemini' },
                            { value: String(ChannelType.NewAPIChat), label: 'OpenAI 兼容' },
                        ],
                    },
                ]}
                action={(
                    <MorphingDialog>
                        <MorphingDialogTrigger className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90">
                            <Plus className="size-4" />
                            创建供应商
                        </MorphingDialogTrigger>
                        <MorphingDialogContainer>
                            <MorphingDialogContent className="flex h-[calc(100vh-2rem)] max-h-[calc(100vh-2rem)] min-h-0 w-fit max-w-full overflow-hidden rounded-lg bg-card px-6 py-4 text-card-foreground shadow-xl">
                                <CreateDialogContent />
                            </MorphingDialogContent>
                        </MorphingDialogContainer>
                    </MorphingDialog>
                )}
            />

            {hasSelection ? (
                <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-card px-4 py-3 shadow-sm md:flex-row md:items-center md:justify-between">
                    <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                            <Badge variant="secondary">已选 {selectedCount} 个</Badge>
                            {allFilteredSelected ? (
                                <span className="text-muted-foreground">当前筛选结果已全部选中{excludedIds.size > 0 ? `，已排除 ${excludedIds.size} 个` : ''}</span>
                            ) : total > selectedIds.size ? (
                                <Button
                                    variant="link"
                                    size="sm"
                                    className="h-auto px-0 text-primary"
                                    disabled={isBatchPending || total === 0}
                                    onClick={() => {
                                        setAllFilteredSelected(true);
                                        setSelectedIds(new Set());
                                        setExcludedIds(new Set());
                                    }}
                                >
                                    选择当前筛选条件下全部 {total} 个结果
                                </Button>
                            ) : null}
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Button variant="outline" size="sm" disabled={isBatchPending} onClick={() => executeBatch('enable')}>
                            <CheckCircle2 className="size-4" />
                            启用
                        </Button>
                        <Button variant="outline" size="sm" disabled={isBatchPending} onClick={() => executeBatch('disable')}>
                            <Ban className="size-4" />
                            停用
                        </Button>
                        <Button variant="destructive" size="sm" disabled={isBatchPending} onClick={() => setBatchDeleteOpen(true)}>
                            <Trash2 className="size-4" />
                            删除
                        </Button>
                        <Button variant="ghost" size="icon-sm" disabled={isBatchPending} aria-label="清空选择" title="清空选择" onClick={clearSelection}>
                            <X className="size-4" />
                        </Button>
                    </div>
                </div>
            ) : null}

            <AdminTableShell>
                <Table className="min-w-full table-fixed" style={{ width: `${tableWidth}px` }}>
                    <ResizableColGroup columns={channelTableColumns} widths={widths} />
                    <TableHeader className="sticky top-0 z-10 bg-muted/50">
                        <TableRow>
                            <TableHead className="px-4">
                                <CheckboxInput
                                    checked={allPageSelected}
                                    indeterminate={somePageSelected}
                                    disabled={rows.length === 0 || isLoading}
                                    label="选择当前页供应商"
                                    onChange={setCurrentPageSelected}
                                />
                            </TableHead>
                            <ResizableTableHead columnKey="name" getResizeHandleProps={getResizeHandleProps}>名称</ResizableTableHead>
                            <ResizableTableHead columnKey="protocol" getResizeHandleProps={getResizeHandleProps}>协议</ResizableTableHead>
                            <ResizableTableHead columnKey="keys" getResizeHandleProps={getResizeHandleProps}>密钥</ResizableTableHead>
                            <ResizableTableHead columnKey="models" getResizeHandleProps={getResizeHandleProps}>模型</ResizableTableHead>
                            <ResizableTableHead columnKey="requests" getResizeHandleProps={getResizeHandleProps}>请求</ResizableTableHead>
                            <ResizableTableHead columnKey="cost" getResizeHandleProps={getResizeHandleProps}>成本</ResizableTableHead>
                            <ResizableTableHead columnKey="status" getResizeHandleProps={getResizeHandleProps}>状态</ResizableTableHead>
                            <ResizableTableHead columnKey="actions" align="right" getResizeHandleProps={getResizeHandleProps}>操作</ResizableTableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableRow><TableCell colSpan={9} className="h-32 text-center text-muted-foreground">加载中...</TableCell></TableRow>
                        ) : rows.length === 0 ? (
                            <TableRow><TableCell colSpan={9} className="h-32 text-center text-muted-foreground">暂无供应商</TableCell></TableRow>
                        ) : rows.map(({ raw: channel, formatted }) => {
                            const rowSelected = isRowSelected(channel.id);
                            return (
                                <TableRow key={channel.id} data-state={rowSelected ? 'selected' : undefined}>
                                    <TableCell className="px-4">
                                        <CheckboxInput
                                            checked={rowSelected}
                                            label={`选择 ${channel.name}`}
                                            onChange={(checked) => setRowSelected(channel.id, checked)}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex min-w-0 items-center gap-2">
                                            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                                <Radio className="size-4" />
                                            </span>
                                            <div className="min-w-0">
                                                <div className="truncate font-medium">{channel.name}</div>
                                                <div className="truncate text-xs text-muted-foreground">{channel.base_urls[0]?.url || '未配置 Base URL'}</div>
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell><Badge variant="secondary">{channelTypeLabel(channel.type)}</Badge></TableCell>
                                    <TableCell>{channel.keys.filter((item) => item.enabled).length} / {channel.keys.length}</TableCell>
                                    <TableCell>{modelCount(channel)}</TableCell>
                                    <TableCell>{formatted.request_count.formatted.value}{formatted.request_count.formatted.unit}</TableCell>
                                    <TableCell>{formatted.total_cost.formatted.value}{formatted.total_cost.formatted.unit}</TableCell>
                                    <TableCell>
                                        <Badge className={cn(channel.enabled ? 'bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15' : 'bg-rose-500/15 text-rose-700 hover:bg-rose-500/15')}>
                                            {channel.enabled ? '正常' : '停用'}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center justify-end gap-2">
                                            <Switch
                                                checked={channel.enabled}
                                                onCheckedChange={(checked) => enableChannel.mutate({ id: channel.id, enabled: checked })}
                                                disabled={enableChannel.isPending}
                                            />
                                            <MorphingDialog>
                                                <MorphingDialogTrigger className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                                                    <Edit3 className="size-3.5" />
                                                    编辑
                                                </MorphingDialogTrigger>
                                                <MorphingDialogContainer>
                                                    <MorphingDialogContent className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-card px-4 py-3 text-card-foreground shadow-xl">
                                                        <CardContent channel={channel} stats={formatted} />
                                                    </MorphingDialogContent>
                                                </MorphingDialogContainer>
                                            </MorphingDialog>
                                            <Button
                                                variant="ghost"
                                                size="icon-sm"
                                                className="text-muted-foreground hover:text-destructive"
                                                disabled={deleteChannel.isPending}
                                                aria-label={`删除 ${channel.name}`}
                                                title="删除供应商"
                                                onClick={() => setDeleteTarget(channel)}
                                            >
                                                <Trash2 className="size-4" />
                                            </Button>
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
                total={total}
                onPageChange={setPage}
                onPageSizeChange={(value) => {
                    setPageSize(value);
                    setPage(1);
                }}
            />

            <AlertDialog open={batchDeleteOpen} onOpenChange={setBatchDeleteOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>批量删除供应商</AlertDialogTitle>
                        <AlertDialogDescription>
                            确定要删除{allFilteredSelected ? '当前筛选条件下' : '选中的'} {selectedCount} 个供应商吗？此操作会同时删除这些供应商的密钥和统计数据，且无法撤销。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isBatchPending}>取消</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40"
                            disabled={isBatchPending || !hasSelection}
                            onClick={() => {
                                setBatchDeleteOpen(false);
                                executeBatch('delete');
                            }}
                        >
                            确认删除
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>删除供应商</AlertDialogTitle>
                        <AlertDialogDescription>
                            确定要删除供应商「{deleteTarget?.name}」吗？此操作会同时删除该供应商的密钥和统计数据，且无法撤销。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleteChannel.isPending}>取消</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40"
                            disabled={deleteChannel.isPending}
                            onClick={() => deleteTarget && handleDeleteConfirm(deleteTarget)}
                        >
                            确认删除
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
