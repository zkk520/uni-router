'use client';

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Copy, Pencil, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useDeleteModel, useUpdateModel, type LLMInfo } from '@/api/endpoints/model';
import { toast } from '@/components/common/Toast';
import {
    MorphingDialog,
    MorphingDialogContainer,
    MorphingDialogContent,
    MorphingDialogTrigger,
} from '@/components/ui/morphing-dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/animate-ui/components/animate/tooltip';
import { getModelIcon } from '@/lib/model-icons';
import { cn } from '@/lib/utils';
import { createPortal } from 'react-dom';
import { CreateDialogContent } from './Create';
import { ModelDeleteOverlay, ModelEditOverlay } from './ItemOverlays';

interface ModelItemProps {
    model: LLMInfo;
    layout?: 'grid' | 'list';
}

export const ModelItem = memo(function ModelItem({ model, layout = 'grid' }: ModelItemProps) {
    const t = useTranslations('model');
    const isListLayout = layout === 'list';
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [overlayRect, setOverlayRect] = useState<{ top: number; left: number; width: number } | null>(null);
    const instanceId = useId();
    const editLayoutId = `edit-btn-${model.name}-${instanceId}`;
    const deleteLayoutId = `delete-btn-${model.name}-${instanceId}`;
    const cardRef = useRef<HTMLElement | null>(null);
    const editButtonRef = useRef<HTMLButtonElement | null>(null);
    const editOverlayRef = useRef<HTMLDivElement | null>(null);
    const [editValues, setEditValues] = useState(() => ({
        input: model.input.toString(),
        output: model.output.toString(),
        cache_read: model.cache_read.toString(),
        cache_write: model.cache_write.toString(),
    }));

    const copyInitialValues = useMemo(() => ({
        name: `${model.name}-copy`,
        input: model.input.toString(),
        output: model.output.toString(),
        cache_read: model.cache_read.toString(),
        cache_write: model.cache_write.toString(),
    }), [model]);

    const updateModel = useUpdateModel();
    const deleteModel = useDeleteModel();
    const { Avatar: ModelAvatar, color: brandColor } = useMemo(() => getModelIcon(model.name), [model.name]);

    const updateOverlayRect = useCallback(() => {
        const card = cardRef.current;
        if (!card) return;
        const rect = card.getBoundingClientRect();
        setOverlayRect((prev) => {
            if (prev && prev.top === rect.top && prev.left === rect.left && prev.width === rect.width) {
                return prev;
            }
            return { top: rect.top, left: rect.left, width: rect.width };
        });
    }, []);

    const closeEdit = useCallback(() => {
        setIsEditOpen(false);
    }, []);

    const handleEditClick = () => {
        setConfirmDelete(false);
        setEditValues({
            input: model.input.toString(),
            output: model.output.toString(),
            cache_read: model.cache_read.toString(),
            cache_write: model.cache_write.toString(),
        });
        updateOverlayRect();
        setIsEditOpen(true);
    };

    const handleSaveEdit = () => {
        updateModel.mutate({
            name: model.name,
            input: parseFloat(editValues.input) || 0,
            output: parseFloat(editValues.output) || 0,
            cache_read: parseFloat(editValues.cache_read) || 0,
            cache_write: parseFloat(editValues.cache_write) || 0,
        }, {
            onSuccess: () => {
                closeEdit();
                toast.success(t('toast.updated'));
            },
            onError: (error) => {
                toast.error(t('toast.updateFailed'), { description: error.message });
            },
        });
    };

    const handleDeleteClick = () => {
        closeEdit();
        setConfirmDelete(true);
    };

    const handleConfirmDelete = () => {
        deleteModel.mutate(model.name, {
            onSuccess: () => {
                setConfirmDelete(false);
                toast.success(t('toast.deleted'));
            },
            onError: (error) => {
                setConfirmDelete(false);
                toast.error(t('toast.deleteFailed'), { description: error.message });
            },
        });
    };

    useEffect(() => {
        if (!isEditOpen) return;

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Node | null;
            if (!target) return;
            if (editOverlayRef.current?.contains(target)) return;
            if (editButtonRef.current?.contains(target)) return;
            closeEdit();
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') closeEdit();
        };

        updateOverlayRect();
        window.addEventListener('resize', updateOverlayRect);
        window.addEventListener('scroll', updateOverlayRect, true);
        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            window.removeEventListener('resize', updateOverlayRect);
            window.removeEventListener('scroll', updateOverlayRect, true);
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isEditOpen, updateOverlayRect, closeEdit]);

    const shouldRenderEditPortal = isEditOpen || overlayRect !== null;
    const priceMetrics = [
        {
            label: t('overlay.input'),
            value: model.input,
            icon: ArrowDownToLine,
        },
        {
            label: t('overlay.output'),
            value: model.output,
            icon: ArrowUpFromLine,
        },
        {
            label: t('overlay.cacheRead'),
            value: model.cache_read,
            icon: ArrowDownToLine,
        },
        {
            label: t('overlay.cacheWrite'),
            value: model.cache_write,
            icon: ArrowUpFromLine,
        },
    ];

    return (
        <article
            ref={cardRef}
            className={cn(
                'group relative rounded-3xl border border-border bg-card p-4 transition-all duration-300',
                (isEditOpen || confirmDelete) && 'z-50'
            )}
        >
            {isListLayout ? (
                <div className="flex items-center gap-3">
                    <ModelAvatar size={52} />
                    <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
                        <Tooltip side="top" sideOffset={10} align="start">
                            <TooltipTrigger className="truncate text-base font-semibold leading-tight text-card-foreground">
                                {model.name}
                            </TooltipTrigger>
                            <TooltipContent key={model.name}>{model.name}</TooltipContent>
                        </Tooltip>
                        <p className="flex items-center gap-2 overflow-hidden whitespace-nowrap text-sm text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                                <ArrowDownToLine className="size-3.5 shrink-0" style={{ color: brandColor }} />
                                {t('card.inputCache')}
                                <span className="tabular-nums">{model.input.toFixed(2)}/{model.cache_read.toFixed(2)}$</span>
                            </span>
                            <span className="text-muted-foreground/60">|</span>
                            <span className="inline-flex items-center gap-1 overflow-hidden">
                                <ArrowUpFromLine className="size-3.5 shrink-0" style={{ color: brandColor }} />
                                {t('card.outputCache')}
                                <span className="truncate tabular-nums">{model.output.toFixed(2)}/{model.cache_write.toFixed(2)}$</span>
                            </span>
                        </p>
                    </div>
                    <div
                        className={cn(
                            'flex shrink-0 items-center gap-2 self-center',
                            (isEditOpen || confirmDelete) && 'invisible pointer-events-none'
                        )}
                    >
                        <MorphingDialog>
                            <MorphingDialogTrigger
                                className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground transition-colors hover:bg-muted"
                                style={{ display: 'flex' }}
                            >
                                <Copy className="size-4" />
                                <span className="sr-only">{t('card.copy')}</span>
                            </MorphingDialogTrigger>
                            <MorphingDialogContainer>
                                <MorphingDialogContent className="w-fit max-w-full rounded-3xl bg-card px-6 py-4 text-card-foreground custom-shadow">
                                    <CreateDialogContent initialValues={copyInitialValues} />
                                </MorphingDialogContent>
                            </MorphingDialogContainer>
                        </MorphingDialog>

                        <motion.button
                            ref={editButtonRef}
                            layoutId={editLayoutId}
                            type="button"
                            onClick={handleEditClick}
                            disabled={isEditOpen || confirmDelete}
                            className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                            title={t('card.edit')}
                        >
                            <Pencil className="size-4" />
                        </motion.button>

                        <motion.button
                            layoutId={deleteLayoutId}
                            type="button"
                            onClick={handleDeleteClick}
                            disabled={isEditOpen || confirmDelete}
                            className="flex h-9 w-9 items-center justify-center rounded-lg bg-destructive/10 text-destructive transition-colors hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50"
                            title={t('card.delete')}
                        >
                            <Trash2 className="size-4" />
                        </motion.button>
                    </div>
                </div>
            ) : (
                <div className="grid gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                        <ModelAvatar size={44} />
                        <Tooltip side="top" sideOffset={10} align="start">
                            <TooltipTrigger className="min-w-0 flex-1 truncate text-base font-semibold leading-tight text-card-foreground">
                                {model.name}
                            </TooltipTrigger>
                            <TooltipContent key={model.name}>{model.name}</TooltipContent>
                        </Tooltip>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        {priceMetrics.map((metric) => (
                            <div key={metric.label} className="min-w-0 rounded-2xl border border-border/70 bg-muted/20 px-3 py-2">
                                <div className="flex min-w-0 items-center justify-between gap-2">
                                    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                                        <metric.icon className="size-3.5 shrink-0" style={{ color: brandColor }} />
                                        <span className="truncate whitespace-nowrap">{metric.label}</span>
                                    </div>
                                    <div className="shrink-0 whitespace-nowrap text-sm font-medium text-card-foreground tabular-nums">
                                        {metric.value.toFixed(2)}$
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {!isListLayout ? (
                <div
                    className={cn(
                        'mt-3 flex shrink-0 justify-between gap-2',
                        (isEditOpen || confirmDelete) && 'invisible pointer-events-none'
                    )}
                >
                <MorphingDialog>
                    <MorphingDialogTrigger
                        className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground transition-colors hover:bg-muted"
                        style={{ display: 'flex' }}
                    >
                        <Copy className="size-4" />
                        <span className="sr-only">{t('card.copy')}</span>
                    </MorphingDialogTrigger>
                    <MorphingDialogContainer>
                        <MorphingDialogContent className="w-fit max-w-full rounded-3xl bg-card px-6 py-4 text-card-foreground custom-shadow">
                            <CreateDialogContent initialValues={copyInitialValues} />
                        </MorphingDialogContent>
                    </MorphingDialogContainer>
                </MorphingDialog>
                <motion.button
                    ref={editButtonRef}
                    layoutId={editLayoutId}
                    type="button"
                    onClick={handleEditClick}
                    disabled={isEditOpen || confirmDelete}
                    className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                    title={t('card.edit')}
                >
                    <Pencil className="size-4" />
                </motion.button>

                <motion.button
                    layoutId={deleteLayoutId}
                    type="button"
                    onClick={handleDeleteClick}
                    disabled={isEditOpen || confirmDelete}
                    className="flex h-9 w-9 items-center justify-center rounded-lg bg-destructive/10 text-destructive transition-colors hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50"
                    title={t('card.delete')}
                >
                    <Trash2 className="size-4" />
                </motion.button>
                </div>
            ) : null}

            <AnimatePresence>
                {confirmDelete && (
                    <ModelDeleteOverlay
                        layoutId={deleteLayoutId}
                        isPending={deleteModel.isPending}
                        onCancel={() => setConfirmDelete(false)}
                        onConfirm={handleConfirmDelete}
                    />
                )}
            </AnimatePresence>

            {shouldRenderEditPortal && typeof document !== 'undefined'
                ? createPortal(
                    <AnimatePresence onExitComplete={() => setOverlayRect(null)}>
                        {isEditOpen && overlayRect && (
                            <div
                                ref={editOverlayRef}
                                className="fixed z-[90]"
                                style={{
                                    top: `${overlayRect.top}px`,
                                    left: `${overlayRect.left}px`,
                                    width: `${overlayRect.width}px`,
                                }}
                            >
                                <div className="relative">
                                    <ModelEditOverlay
                                        layoutId={editLayoutId}
                                        modelName={model.name}
                                        brandColor={brandColor}
                                        editValues={editValues}
                                        isPending={updateModel.isPending}
                                        onChange={setEditValues}
                                        onCancel={closeEdit}
                                        onSave={handleSaveEdit}
                                    />
                                </div>
                            </div>
                        )}
                    </AnimatePresence>,
                    document.body
                )
                : null}
        </article>
    );
});
