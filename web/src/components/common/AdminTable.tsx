'use client';

import { ChevronLeft, ChevronRight, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

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

export function AdminToolbar({
    search,
    searchPlaceholder,
    onSearchChange,
    filters = [],
    onRefresh,
    action,
    compact = false,
}: {
    search: string;
    searchPlaceholder: string;
    onSearchChange: (value: string) => void;
    filters?: FilterControl[];
    onRefresh?: () => void;
    action?: React.ReactNode;
    compact?: boolean;
}) {
    if (compact) {
        return (
            <div className="rounded-lg border border-border bg-card/95 p-4 shadow-sm">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:justify-between">
                    <div className="relative min-w-0 lg:max-w-80 lg:flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            value={search}
                            onChange={(event) => onSearchChange(event.target.value)}
                            placeholder={searchPlaceholder}
                            className="h-10 rounded-lg bg-background/80 pl-9 shadow-none"
                        />
                    </div>
                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_2.5rem_max-content] items-center gap-2 sm:grid-cols-[minmax(10rem,12rem)_2.5rem_max-content] lg:grid-cols-[11rem_2.5rem_max-content]">
                        {filters.map((filter) => (
                            <Select key={filter.label} value={filter.value} onValueChange={filter.onChange}>
                                <SelectTrigger className="h-10 min-w-0 rounded-lg bg-background/80 shadow-none [&>span]:truncate">
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
                            <Button variant="outline" size="icon" className="size-10 shrink-0 rounded-lg bg-background/80 shadow-sm" onClick={onRefresh}>
                                <RefreshCw className="size-4" />
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
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card/95 p-4 shadow-sm md:flex-row md:flex-wrap md:items-center md:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
                <div className="relative w-full min-w-0 md:min-w-48 md:flex-1 md:max-w-80">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={search}
                        onChange={(event) => onSearchChange(event.target.value)}
                        placeholder={searchPlaceholder}
                        className="h-10 rounded-lg bg-background/80 pl-9 shadow-none"
                    />
                </div>
                {filters.map((filter) => (
                    <Select key={filter.label} value={filter.value} onValueChange={filter.onChange}>
                        <SelectTrigger className="h-10 w-full min-w-0 rounded-lg bg-background/80 shadow-none md:w-44">
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
                    <Button variant="outline" size="icon" className="rounded-lg bg-background/80 shadow-sm" onClick={onRefresh}>
                        <RefreshCw className="size-4" />
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
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={cn('min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card/95 shadow-sm', className)}>
            <div className="h-full overflow-auto">{children}</div>
        </div>
    );
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
    const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const end = Math.min(total, page * pageSize);

    return (
        <div
            className={cn(
                'flex gap-3 border-t border-border bg-card/95 px-4 py-3 text-sm text-muted-foreground',
                compact
                    ? 'flex-col sm:flex-row sm:items-center sm:justify-between'
                    : 'flex-col md:flex-row md:items-center md:justify-between'
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
            <div className={cn('flex items-center gap-3', compact ? 'justify-between sm:justify-end' : 'justify-end')}>
                <span className="shrink-0">每页:</span>
                <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
                    <SelectTrigger className="h-9 w-20 rounded-lg bg-background/80 shadow-none">
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
                        disabled={page <= 1}
                        onClick={() => onPageChange(page - 1)}
                    >
                        <ChevronLeft className="size-4" />
                    </Button>
                    <div className="flex h-9 min-w-10 items-center justify-center border-x border-border bg-primary px-3 text-primary-foreground">
                        {page}
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="rounded-none"
                        disabled={page >= totalPages}
                        onClick={() => onPageChange(page + 1)}
                    >
                        <ChevronRight className="size-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
