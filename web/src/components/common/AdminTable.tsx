'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const MIN_REFRESH_DURATION_MS = 650;
const REFRESH_COMPLETED_DURATION_MS = 900;

export type FilterOption = {
    value: string;
    label: string;
};

export type FilterControl = {
    value: string;
    label: string;
    options: FilterOption[];
    onChange: (value: string) => void;
};

export type RefreshState = 'idle' | 'refreshing' | 'completed';

function isRefreshResultSuccessful(result: unknown) {
    if (!result || typeof result !== 'object') return true;

    const queryResult = result as { isError?: unknown; status?: unknown };
    return queryResult.isError !== true && queryResult.status !== 'error';
}

function RefreshIcon({ state }: { state: RefreshState }) {
    if (state === 'completed') {
        return <Check className="size-4 text-emerald-600 dark:text-emerald-400" />;
    }

    return <RefreshCw className={cn('size-4', state === 'refreshing' && 'animate-spin')} />;
}

export function AdminToolbar({
    search,
    searchPlaceholder,
    onSearchChange,
    filters = [],
    onRefresh,
    isRefreshing = false,
    refreshState,
    refreshLabel = '刷新',
    refreshingLabel = '正在刷新',
    completedLabel = '已刷新',
    action,
    compact = false,
}: {
    search: string;
    searchPlaceholder: string;
    onSearchChange: (value: string) => void;
    filters?: FilterControl[];
    onRefresh?: () => void | Promise<unknown>;
    isRefreshing?: boolean;
    refreshState?: RefreshState;
    refreshLabel?: string;
    refreshingLabel?: string;
    completedLabel?: string;
    action?: ReactNode;
    compact?: boolean;
}) {
    const [internalRefreshState, setInternalRefreshState] = useState<RefreshState>('idle');
    const refreshTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
    const isMountedRef = useRef(true);
    const isRefreshControlled = refreshState !== undefined;

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

    useEffect(() => {
        isMountedRef.current = true;

        return () => {
            isMountedRef.current = false;
            clearRefreshTimers();
        };
    }, [clearRefreshTimers]);

    const currentRefreshState = refreshState ?? (isRefreshing ? 'refreshing' : internalRefreshState);
    const refreshAriaLabel = currentRefreshState === 'refreshing'
        ? refreshingLabel
        : currentRefreshState === 'completed'
            ? completedLabel
            : refreshLabel;
    const disableRefresh = currentRefreshState === 'refreshing';

    const handleRefreshClick = useCallback(() => {
        if (!onRefresh || disableRefresh) return;

        if (isRefreshControlled) {
            void onRefresh();
            return;
        }

        clearRefreshTimers();
        setInternalRefreshState('refreshing');

        const startedAt = Date.now();

        void Promise.resolve()
            .then(() => onRefresh())
            .then(
                (result) => isRefreshResultSuccessful(result),
                () => false,
            )
            .then((success) => {
                if (!isMountedRef.current) return;

                const elapsed = Date.now() - startedAt;
                const remaining = Math.max(MIN_REFRESH_DURATION_MS - elapsed, 0);

                setRefreshTimer(() => {
                    if (!isMountedRef.current) return;

                    if (!success) {
                        setInternalRefreshState('idle');
                        return;
                    }

                    setInternalRefreshState('completed');
                    setRefreshTimer(() => {
                        if (isMountedRef.current) {
                            setInternalRefreshState('idle');
                        }
                    }, REFRESH_COMPLETED_DURATION_MS);
                }, remaining);
            });
    }, [clearRefreshTimers, disableRefresh, isRefreshControlled, onRefresh, setRefreshTimer]);

    if (compact) {
        return (
            <div className="rounded-xl border border-border/70 bg-card p-4 shadow-sm">
                <div className="grid gap-3">
                    <div className="relative min-w-0">
                        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            value={search}
                            onChange={(event) => onSearchChange(event.target.value)}
                            placeholder={searchPlaceholder}
                            className="h-10 rounded-lg bg-background pl-9 shadow-none"
                        />
                    </div>
                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_2.5rem_max-content] items-center gap-2 sm:grid-cols-[minmax(10rem,12rem)_2.5rem_max-content]">
                        {filters.map((filter) => (
                            <Select key={filter.label} value={filter.value} onValueChange={filter.onChange}>
                                <SelectTrigger className="h-10 min-w-0 rounded-lg bg-background shadow-none [&>span]:truncate">
                                    <SelectValue placeholder={filter.label} />
                                </SelectTrigger>
                                <SelectContent className="rounded-lg">
                                    {filter.options.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        ))}
                        {onRefresh ? (
                            <Button
                                variant="outline"
                                size="icon"
                                className="size-10 shrink-0 rounded-lg bg-background shadow-sm"
                                onClick={handleRefreshClick}
                                disabled={disableRefresh}
                                aria-label={refreshAriaLabel}
                                title={refreshAriaLabel}
                            >
                                <RefreshIcon state={currentRefreshState} />
                            </Button>
                        ) : null}
                        <div className="flex min-w-0 justify-end">
                            {action}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-4 shadow-sm md:flex-row md:flex-wrap md:items-center md:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
                <div className="relative w-full min-w-0 md:min-w-48 md:flex-1 md:max-w-80">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={search}
                        onChange={(event) => onSearchChange(event.target.value)}
                        placeholder={searchPlaceholder}
                        className="h-10 rounded-lg bg-background pl-9 shadow-none"
                    />
                </div>
                {filters.map((filter) => (
                    <Select key={filter.label} value={filter.value} onValueChange={filter.onChange}>
                        <SelectTrigger className="h-10 w-full min-w-0 rounded-lg bg-background shadow-none md:w-44">
                            <SelectValue placeholder={filter.label} />
                        </SelectTrigger>
                        <SelectContent className="rounded-lg">
                            {filter.options.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                ))}
            </div>
            <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
                {onRefresh ? (
                    <Button
                        variant="outline"
                        size="icon"
                        className="rounded-lg bg-background shadow-sm"
                        onClick={handleRefreshClick}
                        disabled={disableRefresh}
                        aria-label={refreshAriaLabel}
                        title={refreshAriaLabel}
                    >
                        <RefreshIcon state={currentRefreshState} />
                    </Button>
                ) : null}
                {action}
            </div>
        </div>
    );
}

export function AdminTableShell({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <div className={cn('min-h-0 flex-1 overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm [&>div]:h-full', className)}>
            {children}
        </div>
    );
}

type PaginationItem = number | 'ellipsis-start' | 'ellipsis-end';

function getPaginationItems(page: number, totalPages: number, siblingCount = 2): PaginationItem[] {
    if (totalPages <= 1) return [1];

    const currentPage = Math.min(Math.max(page, 1), totalPages);
    const startPage = Math.max(2, currentPage - siblingCount);
    const endPage = Math.min(totalPages - 1, currentPage + siblingCount);
    const items: PaginationItem[] = [1];

    if (startPage > 2) {
        items.push(startPage === 3 ? 2 : 'ellipsis-start');
    }

    for (let item = startPage; item <= endPage; item += 1) {
        items.push(item);
    }

    if (endPage < totalPages - 1) {
        items.push(endPage === totalPages - 2 ? totalPages - 1 : 'ellipsis-end');
    }

    items.push(totalPages);

    return items;
}

export function AdminPagination({
    page,
    pageSize,
    total,
    onPageChange,
    onPageSizeChange,
    compact = false,
}: {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
    onPageSizeChange: (pageSize: number) => void;
    compact?: boolean;
}) {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = Math.min(Math.max(page, 1), totalPages);
    const start = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const end = Math.min(total, currentPage * pageSize);
    const paginationItems = getPaginationItems(currentPage, totalPages, compact ? 1 : 2);

    return (
        <div
            className={cn(
                'flex gap-3 border-t border-border/60 bg-card px-4 py-3 text-sm text-muted-foreground',
                compact ? 'flex-col items-start' : 'flex-col md:flex-row md:items-center md:justify-between'
            )}
        >
            <div className={cn(compact && 'whitespace-nowrap')}>
                {compact ? (
                    <span>
                        <span className="sm:hidden">{total} 条结果</span>
                        <span className="hidden sm:inline">显示 {start} 至 {end} 共 {total} 条结果</span>
                    </span>
                ) : (
                    <>显示 {start} 至 {end} 共 {total} 条结果</>
                )}
            </div>
            <div className={cn('flex items-center gap-3', compact ? 'w-full flex-wrap justify-between' : 'flex-wrap justify-end')}>
                <span className="shrink-0">每页:</span>
                <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
                    <SelectTrigger className="h-9 w-20 rounded-lg bg-background shadow-none">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-lg">
                        {[10, 20, 50, 100].map((size) => (
                            <SelectItem key={size} value={String(size)}>
                                {size}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <div className="flex items-center overflow-hidden rounded-lg border border-border">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="rounded-none"
                        disabled={currentPage <= 1}
                        onClick={() => onPageChange(1)}
                        aria-label="跳转首页"
                        title="跳转首页"
                    >
                        <ChevronsLeft className="size-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="rounded-none border-l border-border"
                        disabled={currentPage <= 1}
                        onClick={() => onPageChange(currentPage - 1)}
                        aria-label="上一页"
                        title="上一页"
                    >
                        <ChevronLeft className="size-4" />
                    </Button>
                    {paginationItems.map((item) => {
                        if (typeof item !== 'number') {
                            return (
                                <span
                                    key={item}
                                    className="flex h-9 min-w-9 items-center justify-center border-l border-border px-2 text-muted-foreground"
                                    aria-hidden="true"
                                >
                                    ...
                                </span>
                            );
                        }

                        const isCurrent = item === currentPage;

                        return (
                            <Button
                                key={item}
                                variant={isCurrent ? 'default' : 'ghost'}
                                size="icon"
                                className={cn(
                                    'min-w-9 rounded-none border-l border-border px-3',
                                    isCurrent && 'pointer-events-none cursor-default'
                                )}
                                onClick={() => onPageChange(item)}
                                aria-label={isCurrent ? `当前第 ${item} 页` : `跳转第 ${item} 页`}
                                aria-current={isCurrent ? 'page' : undefined}
                            >
                                {item}
                            </Button>
                        );
                    })}
                    <Button
                        variant="ghost"
                        size="icon"
                        className="rounded-none border-l border-border"
                        disabled={currentPage >= totalPages}
                        onClick={() => onPageChange(currentPage + 1)}
                        aria-label="下一页"
                        title="下一页"
                    >
                        <ChevronRight className="size-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="rounded-none border-l border-border"
                        disabled={currentPage >= totalPages}
                        onClick={() => onPageChange(totalPages)}
                        aria-label="跳转尾页"
                        title="跳转尾页"
                    >
                        <ChevronsRight className="size-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
