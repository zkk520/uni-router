'use client';

import * as React from 'react';
import { TableHead } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export type ResizableColumnConfig = {
    key: string;
    defaultWidth: number;
    minWidth: number;
    maxWidth?: number;
    resizable?: boolean;
};

type ResizeState = {
    key: string;
    startX: number;
    startWidth: number;
};

const STORAGE_PREFIX = 'uni-router:table-widths:';

function clampWidth(value: number, column: ResizableColumnConfig) {
    const maxWidth = column.maxWidth ?? Number.POSITIVE_INFINITY;
    return Math.min(maxWidth, Math.max(column.minWidth, Math.round(value)));
}

function readStoredWidths(tableId: string, columns: ResizableColumnConfig[]) {
    if (typeof window === 'undefined') return {} as Record<string, number>;

    try {
        const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${tableId}`);
        if (!raw) return {} as Record<string, number>;

        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object') return {} as Record<string, number>;

        return columns.reduce<Record<string, number>>((acc, column) => {
            const stored = (parsed as Record<string, unknown>)[column.key];
            if (typeof stored !== 'number' || !Number.isFinite(stored)) return acc;
            acc[column.key] = clampWidth(stored, column);
            return acc;
        }, {});
    } catch {
        return {} as Record<string, number>;
    }
}

function buildWidths(tableId: string, columns: ResizableColumnConfig[]) {
    const storedWidths = readStoredWidths(tableId, columns);
    return columns.reduce<Record<string, number>>((acc, column) => {
        acc[column.key] = storedWidths[column.key] ?? clampWidth(column.defaultWidth, column);
        return acc;
    }, {});
}

export function useResizableColumns(tableId: string, columns: ResizableColumnConfig[]) {
    const [widths, setWidths] = React.useState<Record<string, number>>(() => buildWidths(tableId, columns));
    const resizeStateRef = React.useRef<ResizeState | null>(null);
    const widthsRef = React.useRef(widths);

    React.useEffect(() => {
        widthsRef.current = widths;
    }, [widths]);

    React.useEffect(() => {
        setWidths(buildWidths(tableId, columns));
    }, [columns, tableId]);

    const saveWidths = React.useCallback((nextWidths: Record<string, number>) => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(`${STORAGE_PREFIX}${tableId}`, JSON.stringify(nextWidths));
    }, [tableId]);

    const updateColumnWidth = React.useCallback((key: string, width: number) => {
        const column = columns.find((item) => item.key === key);
        if (!column) return;

        setWidths((prev) => {
            const next = { ...prev, [key]: clampWidth(width, column) };
            widthsRef.current = next;
            return next;
        });
    }, [columns]);

    React.useEffect(() => {
        const handleMove = (event: PointerEvent) => {
            const resizeState = resizeStateRef.current;
            if (!resizeState) return;
            updateColumnWidth(resizeState.key, resizeState.startWidth + event.clientX - resizeState.startX);
        };

        const handleUp = () => {
            if (!resizeStateRef.current) return;
            resizeStateRef.current = null;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            saveWidths(widthsRef.current);
        };

        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', handleUp);
        window.addEventListener('pointercancel', handleUp);

        return () => {
            window.removeEventListener('pointermove', handleMove);
            window.removeEventListener('pointerup', handleUp);
            window.removeEventListener('pointercancel', handleUp);
        };
    }, [saveWidths, updateColumnWidth]);

    const getResizeHandleProps = React.useCallback((key: string) => ({
        onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
            const column = columns.find((item) => item.key === key);
            if (!column || column.resizable === false) return;

            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            resizeStateRef.current = {
                key,
                startX: event.clientX,
                startWidth: widthsRef.current[key] ?? column.defaultWidth,
            };
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        },
    }), [columns]);

    const resetWidths = React.useCallback(() => {
        const nextWidths = columns.reduce<Record<string, number>>((acc, column) => {
            acc[column.key] = clampWidth(column.defaultWidth, column);
            return acc;
        }, {});
        widthsRef.current = nextWidths;
        setWidths(nextWidths);

        if (typeof window !== 'undefined') {
            window.localStorage.removeItem(`${STORAGE_PREFIX}${tableId}`);
        }
    }, [columns, tableId]);

    const tableWidth = React.useMemo(
        () => columns.reduce((total, column) => total + (widths[column.key] ?? column.defaultWidth), 0),
        [columns, widths]
    );

    return {
        widths,
        tableWidth,
        getResizeHandleProps,
        resetWidths,
    };
}

export function ResizableColGroup({
    columns,
    widths,
}: {
    columns: ResizableColumnConfig[];
    widths: Record<string, number>;
}) {
    return (
        <colgroup>
            {columns.map((column) => (
                <col key={column.key} style={{ width: `${widths[column.key] ?? column.defaultWidth}px` }} />
            ))}
        </colgroup>
    );
}

export function ResizableTableHead({
    columnKey,
    getResizeHandleProps,
    children,
    className,
    align = 'left',
}: {
    columnKey: string;
    getResizeHandleProps: ReturnType<typeof useResizableColumns>['getResizeHandleProps'];
    children: React.ReactNode;
    className?: string;
    align?: 'left' | 'right';
}) {
    return (
        <TableHead className={cn('relative select-none pr-5', align === 'right' && 'text-right', className)}>
            <span className={cn('block truncate', align === 'right' && 'text-right')}>{children}</span>
            <button
                type="button"
                aria-label="Resize column"
                title="Resize column"
                className="absolute right-0 top-0 h-full w-2 cursor-col-resize touch-none rounded-none border-0 bg-transparent p-0 outline-none transition-colors hover:bg-primary/20 focus-visible:bg-primary/25"
                {...getResizeHandleProps(columnKey)}
            />
        </TableHead>
    );
}
