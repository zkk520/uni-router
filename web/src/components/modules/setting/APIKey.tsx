'use client';

import { useCallback, useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { KeyRound, Plus, Loader, Trash2, Check, X, Info, CalendarDays, Pencil, Maximize2, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import {
    MorphingDialog,
    MorphingDialogContainer,
    MorphingDialogContent,
    MorphingDialogTrigger,
    useMorphingDialog,
} from '@/components/ui/morphing-dialog';
import {
    useAPIKeyList,
    useAPIKeyPage,
    useCreateAPIKey,
    useUpdateAPIKey,
    useDeleteAPIKey,
    type APIKey,
} from '@/api/endpoints/apikey';
import { useRouterList } from '@/api/endpoints/router';
import { useStatsAPIKey } from '@/api/endpoints/stats';
import { AdminPagination, AdminTableShell, AdminToolbar } from '@/components/common/AdminTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { toast } from '@/components/common/Toast';
import { CopyIconButton } from '@/components/common/CopyButton';
import type { ApiError } from '@/api/types';

function maskAPIKey(apiKey: string) {
    if (!apiKey) return '未生成';
    if (apiKey.length <= 12) return '****';
    return `${apiKey.slice(0, 7)}...${apiKey.slice(-4)}`;
}

function formatExpireAt(expireAt?: number) {
    if (!expireAt) return '永久有效';
    return new Date(expireAt * 1000).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function toExpireAt(date: Date, time: string): number {
    const t = /^\d{2}:\d{2}$/.test(time) ? time : '00:00';
    const [hh, mm] = t.split(':').map(Number);
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), hh, mm, 0));
    // 返回 Unix 时间戳（秒）
    return Math.floor(d.getTime() / 1000);
}

function parseExpireDate(expireAt?: number): Date | undefined {
    if (!expireAt) return undefined;
    // 从 Unix 时间戳（秒）转换为 Date
    const d = new Date(expireAt * 1000);
    return isNaN(d.getTime()) ? undefined : d;
}

function normalizeHHmm(input: string): string {
    const cleaned = input.replace(/[^\d:]/g, '');
    const parts = cleaned.includes(':') ? cleaned.split(':') : [cleaned.slice(0, 2), cleaned.slice(2, 4)];
    const hh = Math.min(23, Math.max(0, parseInt(parts[0] || '0', 10)));
    const mm = Math.min(59, Math.max(0, parseInt(parts[1] || '0', 10)));
    return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
}

function normalizeMoneyInput(input: string): string {
    const cleaned = input.replace(/[^\d.]/g, '');
    const [intPart, ...rest] = cleaned.split('.');
    return rest.length > 0 ? `${intPart}.${rest.join('').slice(0, 6)}` : intPart;
}

interface APIKeyFormProps {
    apiKey?: APIKey;
    isPending: boolean;
    submitLabel: string;
    onSubmit: (data: Omit<APIKey, 'id' | 'api_key'>) => void;
    onClose: () => void;
}

function APIKeyForm({ apiKey, isPending, submitLabel, onSubmit, onClose }: APIKeyFormProps) {
    const t = useTranslations('setting');
    const { data: routers = [] } = useRouterList();

    const [form, setForm] = useState<Omit<APIKey, 'id' | 'api_key'>>(() => ({
        name: apiKey?.name ?? '',
        enabled: apiKey?.enabled ?? true,
        expire_at: apiKey?.expire_at,
        max_cost: apiKey?.max_cost,
        router_id: apiKey?.router_id,
    }));
    const [maxCostInput, setMaxCostInput] = useState(() =>
        apiKey?.max_cost != null ? String(apiKey.max_cost) : ''
    );
    const [expireTime, setExpireTime] = useState(() => {
        if (apiKey?.expire_at) {
            const d = new Date(apiKey.expire_at * 1000);
            if (!isNaN(d.getTime())) {
                return `${d.getUTCHours().toString().padStart(2, '0')}:${d.getUTCMinutes().toString().padStart(2, '0')}`;
            }
        }
        return '00:00';
    });
    const [expireOpen, setExpireOpen] = useState(false);

    const expireDate = parseExpireDate(form.expire_at);
    const neverExpire = !form.expire_at;
    const isUnlimitedCost = maxCostInput.trim() === '';

    const expireLabel = neverExpire
        ? t('apiKey.form.neverExpire')
        : expireDate
            ? expireDate.toLocaleDateString()
            : t('apiKey.form.selectDate');

    const updateForm = useCallback((updater: Partial<Omit<APIKey, 'id' | 'api_key'>>) => {
        setForm((prev) => ({ ...prev, ...updater }));
    }, []);

    const handleSelectDate = useCallback((d: Date | undefined) => {
        if (d) {
            updateForm({ expire_at: toExpireAt(d, expireTime) });
            setExpireOpen(false);
        } else {
            updateForm({ expire_at: undefined });
        }
    }, [updateForm, expireTime]);

    const handleTimeBlur = useCallback(() => {
        if (!expireDate) return;
        const normalized = normalizeHHmm(expireTime);
        setExpireTime(normalized);
        updateForm({ expire_at: toExpireAt(expireDate, normalized) });
    }, [expireDate, expireTime, updateForm]);

    const handleToggleNeverExpire = useCallback(() => {
        if (neverExpire) {
            updateForm({ expire_at: toExpireAt(new Date(), expireTime) });
        } else {
            updateForm({ expire_at: undefined });
            setExpireOpen(false);
        }
    }, [neverExpire, expireTime, updateForm]);

    const handleMaxCostChange = useCallback((val: string) => {
        const normalized = normalizeMoneyInput(val);
        setMaxCostInput(normalized);
        const num = parseFloat(normalized);
        updateForm({ max_cost: Number.isFinite(num) ? num : undefined });
    }, [updateForm]);

    const handleClearMaxCost = useCallback(() => {
        setMaxCostInput('');
        updateForm({ max_cost: undefined });
    }, [updateForm]);

    const handleSubmit = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name.trim() || !form.router_id) return;
        onSubmit(form);
    }, [form, onSubmit]);

    return (
        <form onSubmit={handleSubmit} className="grid gap-2">
            <label className="grid gap-1 text-xs text-muted-foreground">
                {t('apiKey.form.name')}
                <Input
                    type="text"
                    value={form.name}
                    onChange={(e) => updateForm({ name: e.target.value })}
                    className="h-9 text-sm rounded-xl"
                    disabled={isPending}
                    required
                />
            </label>

            <div className="grid gap-1 text-xs text-muted-foreground">
                {t('apiKey.form.maxCost')}
                <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                        <Input
                            type="text"
                            inputMode="decimal"
                            placeholder={t('apiKey.form.maxCostPlaceholder')}
                            value={maxCostInput}
                            onChange={(e) => handleMaxCostChange(e.target.value)}
                            className="h-9 text-sm rounded-xl pl-7"
                            disabled={isPending}
                        />
                    </div>
                    <button
                        type="button"
                        onClick={handleClearMaxCost}
                        disabled={isPending}
                        aria-pressed={isUnlimitedCost}
                        className={cn(
                            'h-9 px-3 rounded-xl border text-sm transition-colors shrink-0',
                            isUnlimitedCost
                                ? 'bg-primary text-primary-foreground border-primary/30'
                                : 'border-border bg-muted/20 text-foreground hover:bg-muted/30',
                            isPending && 'opacity-50 cursor-not-allowed'
                        )}
                    >
                        {t('apiKey.form.unlimited')}
                    </button>
                </div>
            </div>

            <div className="grid gap-1 text-xs text-muted-foreground">
                {t('apiKey.form.expireAt')}
                <div className="flex items-center gap-2 relative">
                    <Popover
                        open={expireOpen && !neverExpire}
                        onOpenChange={setExpireOpen}
                    >
                        <PopoverTrigger asChild>
                            <button
                                type="button"
                                disabled={isPending || neverExpire}
                                className="h-9 flex-1 flex items-center justify-between gap-2 rounded-xl border border-border bg-muted/20 px-3 text-sm text-foreground transition-colors hover:bg-muted/30 disabled:opacity-50"
                            >
                                <span className="truncate">{expireLabel}</span>
                                <CalendarDays className="size-4 text-muted-foreground" />
                            </button>
                        </PopoverTrigger>
                        <PopoverContent
                            align="start"
                            side="bottom"
                            sideOffset={8}
                            className="w-fit rounded-lg border border-border/60 shadow-xl overflow-hidden bg-card p-0"
                        >
                            <Calendar
                                mode="single"
                                selected={expireDate}
                                onSelect={handleSelectDate}
                                disabled={isPending}
                                classNames={{ today: '' }}
                            />
                        </PopoverContent>
                    </Popover>

                    <Input
                        type="text"
                        value={expireTime}
                        onChange={(e) => setExpireTime(e.target.value.replace(/[^\d:]/g, '').slice(0, 5))}
                        onBlur={handleTimeBlur}
                        className="h-9 w-[92px] text-sm rounded-xl"
                        disabled={isPending || neverExpire || !expireDate}
                        inputMode="numeric"
                        placeholder="HH:mm"
                    />

                    <button
                        type="button"
                        onClick={handleToggleNeverExpire}
                        disabled={isPending}
                        aria-pressed={neverExpire}
                        className={cn(
                            'h-9 px-3 rounded-xl border text-sm transition-colors whitespace-nowrap shrink-0',
                            neverExpire
                                ? 'bg-primary text-primary-foreground border-primary/30'
                                : 'border-border bg-muted/20 text-foreground hover:bg-muted/30',
                            isPending && 'opacity-50 cursor-not-allowed'
                        )}
                    >
                        {t('apiKey.form.neverExpire')}
                    </button>
                </div>
            </div>

            <div className="grid gap-1 text-xs text-muted-foreground">
                Router
                <select
                    value={form.router_id ?? 0}
                    onChange={(e) => updateForm({ router_id: Number(e.target.value) || undefined })}
                    disabled={isPending}
                    required
                    className="h-9 rounded-xl border border-border bg-background px-3 text-sm text-foreground"
                >
                    <option value={0}>Select router</option>
                    {routers.map((router) => (
                        <option key={router.id} value={router.id}>
                            {router.name}
                        </option>
                    ))}
                </select>
            </div>

            <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-muted-foreground">{t('apiKey.form.enabled')}</span>
                <Switch
                    checked={form.enabled ?? true}
                    onCheckedChange={(checked) => updateForm({ enabled: checked })}
                    disabled={isPending}
                />
            </div>

            <div className="flex gap-2 pt-2 mt-3">
                <button
                    type="button"
                    onClick={onClose}
                    disabled={isPending}
                    className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-xl bg-muted text-muted-foreground text-sm font-medium transition-all hover:bg-muted/80 active:scale-[0.98] disabled:opacity-50"
                >
                    <X className="size-4" />
                    {t('apiKey.form.cancel')}
                </button>
                <button
                    type="submit"
                    disabled={isPending || !form.name.trim() || !form.router_id}
                    className="flex-1 h-9 flex items-center justify-center gap-1.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50"
                >
                    {isPending ? <Loader className="size-4 animate-spin" /> : <Check className="size-4" />}
                    {submitLabel}
                </button>
            </div>
        </form>
    );
}

function APIKeyFormOverlay({
    layoutId,
    apiKey,
    isPending,
    submitLabel,
    onSubmit,
    onClose,
}: {
    layoutId: string;
    apiKey?: APIKey;
    isPending: boolean;
    submitLabel: string;
    onSubmit: (data: Omit<APIKey, 'id' | 'api_key'>) => void;
    onClose: () => void;
}) {
    return (
        <motion.div
            layoutId={layoutId}
            className="absolute left-1/2 top-1/2 z-20 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 bg-card p-5 rounded-lg border border-border max-h-[80vh] overflow-auto"
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        >
            <APIKeyForm
                apiKey={apiKey}
                isPending={isPending}
                submitLabel={submitLabel}
                onSubmit={onSubmit}
                onClose={onClose}
            />
        </motion.div>
    );
}

function APIKeyStatsCard({
    layoutId,
    apiKey,
    onClose,
}: {
    layoutId: string;
    apiKey: APIKey;
    onClose: () => void;
}) {
    const t = useTranslations('setting');
    const { data: statsList = [] } = useStatsAPIKey();
    const stats = useMemo(() => statsList.find((s) => s.api_key_id === apiKey.id), [statsList, apiKey.id]);

    return (
        <motion.div
            layoutId={layoutId}
            className="absolute left-1/2 top-1/2 z-30 w-[min(320px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex flex-col bg-card p-5 rounded-lg border border-border max-h-[80vh] overflow-auto"
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        >
            <div className="flex items-center justify-between gap-2 mb-3">
                <h3 className="text-sm font-semibold text-card-foreground line-clamp-1">
                    {apiKey.name}
                </h3>
                <button
                    type="button"
                    onClick={onClose}
                    className="size-8 flex items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors hover:bg-muted/80"
                >
                    <X className="size-4" />
                </button>
            </div>

            {!stats ? (
                <div className="text-sm text-muted-foreground">{t('apiKey.stats.noData')}</div>
            ) : (
                <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg bg-muted/40 p-3">
                        <div className="text-xs text-muted-foreground">{t('apiKey.stats.inputToken')}</div>
                        <div className="font-medium tabular-nums">
                            {stats.input_token.formatted.value}
                            {stats.input_token.formatted.unit}
                        </div>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-3">
                        <div className="text-xs text-muted-foreground">{t('apiKey.stats.outputToken')}</div>
                        <div className="font-medium tabular-nums">
                            {stats.output_token.formatted.value}
                            {stats.output_token.formatted.unit}
                        </div>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-3">
                        <div className="text-xs text-muted-foreground">{t('apiKey.stats.inputCost')}</div>
                        <div className="font-medium tabular-nums">
                            {stats.input_cost.formatted.value}
                            {stats.input_cost.formatted.unit}
                        </div>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-3">
                        <div className="text-xs text-muted-foreground">{t('apiKey.stats.outputCost')}</div>
                        <div className="font-medium tabular-nums">
                            {stats.output_cost.formatted.value}
                            {stats.output_cost.formatted.unit}
                        </div>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-3">
                        <div className="text-xs text-muted-foreground">{t('apiKey.stats.requestSuccess')}</div>
                        <div className="font-medium tabular-nums">
                            {stats.request_success.formatted.value}
                            {stats.request_success.formatted.unit}
                        </div>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-3">
                        <div className="text-xs text-muted-foreground">{t('apiKey.stats.requestFailed')}</div>
                        <div className="font-medium tabular-nums">
                            {stats.request_failed.formatted.value}
                            {stats.request_failed.formatted.unit}
                        </div>
                    </div>
                </div>
            )}
        </motion.div>
    );
}

function APIKeyKeyItem({
    apiKey,
    statsLayoutId,
    editLayoutId,
    deleteLayoutId,
    onViewStats,
    onEdit,
    onDelete,
    isDeleting,
}: {
    apiKey: APIKey;
    statsLayoutId: string;
    editLayoutId: string;
    deleteLayoutId: string;
    onViewStats: () => void;
    onEdit: () => void;
    onDelete: () => void;
    isDeleting: boolean;
}) {
    const t = useTranslations('setting');
    const [confirmDelete, setConfirmDelete] = useState(false);

    return (
        <motion.div
            layout
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className="group relative flex items-center justify-between gap-3 p-3 rounded-xl bg-muted/50 overflow-hidden origin-top"
        >
            <span className="text-sm font-medium truncate">
                {apiKey.name}
                {apiKey.router_id ? (
                    <span className="ml-2 text-xs text-muted-foreground">Router #{apiKey.router_id}</span>
                ) : null}
            </span>

            <div className="flex items-center gap-1.5">
                <motion.button
                    type="button"
                    layoutId={statsLayoutId}
                    onClick={onViewStats}
                    className="flex size-8 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
                    title="Stats"
                >
                    <Info className="size-4" />
                </motion.button>
                <motion.button
                    type="button"
                    layoutId={editLayoutId}
                    onClick={onEdit}
                    className="flex size-8 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
                    title="Edit"
                >
                    <Pencil className="size-4" />
                </motion.button>
                <CopyIconButton
                    text={apiKey.api_key}
                    className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary transition-all hover:bg-primary hover:text-primary-foreground active:scale-95"
                    copyIconClassName="size-4"
                    checkIconClassName="size-4"
                />

                {!confirmDelete && (
                    <motion.button
                        layoutId={deleteLayoutId}
                        onClick={() => setConfirmDelete(true)}
                        className="flex size-8 items-center justify-center rounded-lg bg-destructive/10 text-destructive transition-colors hover:bg-destructive hover:text-destructive-foreground"
                    >
                        <Trash2 className="size-4" />
                    </motion.button>
                )}
            </div>

            <AnimatePresence>
                {confirmDelete && (
                    <motion.div
                        layoutId={deleteLayoutId}
                        className="absolute inset-0 flex items-center justify-center gap-2 bg-destructive p-3 rounded-xl"
                        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    >
                        <button
                            onClick={() => setConfirmDelete(false)}
                            className="flex size-8 items-center justify-center rounded-lg bg-destructive-foreground/20 text-destructive-foreground transition-all hover:bg-destructive-foreground/30 active:scale-95"
                        >
                            <X className="size-4" />
                        </button>
                        <button
                            onClick={onDelete}
                            disabled={isDeleting}
                            className="flex-1 h-8 flex items-center justify-center gap-1.5 rounded-lg bg-destructive-foreground text-destructive text-sm font-medium transition-all hover:bg-destructive-foreground/90 active:scale-[0.98] disabled:opacity-50"
                        >
                            <Trash2 className="size-3.5" />
                            {isDeleting ? '...' : t('apiKey.form.confirm')}
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}

function APIKeyPanelBase({
    idPrefix,
    containerClassName,
    listClassName,
    renderHeaderExtra,
}: {
    idPrefix: string;
    containerClassName: string;
    listClassName: string;
    renderHeaderExtra?: (ctx: {
        disabled: boolean;
        onCloseAllOverlays: () => void;
    }) => React.ReactNode;
}) {
    const t = useTranslations('setting');
    const { data: apiKeys, isLoading: apiKeysLoading, error: apiKeysError } = useAPIKeyList();
    const createAPIKey = useCreateAPIKey();
    const updateAPIKey = useUpdateAPIKey();
    const deleteAPIKey = useDeleteAPIKey();

    const instanceId = useId();
    const addLayoutId = `add-btn-${idPrefix}-${instanceId}`;
    const statsPrefix = `${idPrefix}-stats-${instanceId}`;
    const editPrefix = `${idPrefix}-edit-${instanceId}`;
    const deletePrefix = `${idPrefix}-delete-`;

    const [isAdding, setIsAdding] = useState(false);
    const [viewingStats, setViewingStats] = useState<{ apiKey: APIKey; layoutId: string } | null>(null);
    const [editingKey, setEditingKey] = useState<{ apiKey: APIKey; layoutId: string } | null>(null);
    const [deletingId, setDeletingId] = useState<number | null>(null);

    const sortedApiKeys = useMemo(() => {
        if (!apiKeys) return [];
        return [...apiKeys].sort((a, b) => a.id - b.id);
    }, [apiKeys]);

    const handleDelete = useCallback((id: number) => {
        setDeletingId(id);
        deleteAPIKey.mutate(id, {
            onSuccess: () => {
                toast.success(t('apiKey.toast.deleteSuccess'));
            },
            onError: (error) => {
                const msg = (error as unknown as ApiError)?.message;
                toast.error(t('apiKey.toast.deleteError'), { description: msg });
            },
            onSettled: () => setDeletingId((cur) => (cur === id ? null : cur)),
        });
    }, [deleteAPIKey, t]);

    const closeAllOverlays = useCallback(() => {
        setIsAdding(false);
        setViewingStats(null);
        setEditingKey(null);
    }, []);

    const disabledHeaderActions = createAPIKey.isPending || isAdding || !!viewingStats || !!editingKey;

    const handleCreate = useCallback((data: Omit<APIKey, 'id' | 'api_key'>) => {
        createAPIKey.mutate(data, {
            onSuccess: () => {
                toast.success(t('apiKey.toast.createSuccess'));
                setIsAdding(false);
            },
            onError: (error) => {
                const msg = (error as unknown as ApiError)?.message;
                toast.error(t('apiKey.toast.createError'), { description: msg });
            },
        });
    }, [createAPIKey, t]);

    const handleUpdate = useCallback((apiKey: APIKey, data: Omit<APIKey, 'id' | 'api_key'>) => {
        updateAPIKey.mutate({ id: apiKey.id, ...data }, {
            onSuccess: () => {
                toast.success(t('apiKey.toast.updateSuccess'));
                setEditingKey(null);
            },
            onError: (error) => {
                const msg = (error as unknown as ApiError)?.message;
                toast.error(t('apiKey.toast.updateError'), { description: msg });
            },
        });
    }, [t, updateAPIKey]);

    return (
        <div className={containerClassName}>
            <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-card-foreground flex items-center gap-2">
                    <KeyRound className="h-5 w-5" />
                    {t('apiKey.title')}
                </h2>
                <div className="flex items-center gap-2">
                    <motion.button
                        layoutId={addLayoutId}
                        type="button"
                        onClick={() => setIsAdding(true)}
                        disabled={disabledHeaderActions}
                        className="h-9 w-9 flex items-center justify-center rounded-lg bg-muted/60 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                        title={t('apiKey.add')}
                    >
                        <Plus className="size-4" />
                    </motion.button>
                    {renderHeaderExtra?.({ disabled: disabledHeaderActions, onCloseAllOverlays: closeAllOverlays })}
                </div>
            </div>

            <AnimatePresence>
                {isAdding && (
                    <APIKeyFormOverlay
                        layoutId={addLayoutId}
                        isPending={createAPIKey.isPending}
                        submitLabel={t('apiKey.form.create')}
                        onSubmit={handleCreate}
                        onClose={() => setIsAdding(false)}
                    />
                )}
            </AnimatePresence>

            <AnimatePresence>
                {viewingStats && (
                    <APIKeyStatsCard
                        layoutId={viewingStats.layoutId}
                        apiKey={viewingStats.apiKey}
                        onClose={() => setViewingStats(null)}
                    />
                )}
            </AnimatePresence>

            <AnimatePresence>
                {editingKey && (
                    <APIKeyFormOverlay
                        layoutId={editingKey.layoutId}
                        apiKey={editingKey.apiKey}
                        isPending={updateAPIKey.isPending}
                        submitLabel={t('apiKey.form.save')}
                        onSubmit={(data) => handleUpdate(editingKey.apiKey, data)}
                        onClose={() => setEditingKey(null)}
                    />
                )}
            </AnimatePresence>

            <div className={listClassName}>
                {apiKeysLoading ? (
                    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                        <Loader className="size-4 animate-spin" />
                    </div>
                ) : apiKeysError ? (
                    <div className="h-full flex items-center justify-center text-sm text-destructive">
                        {t('apiKey.loadFailed')}
                    </div>
                ) : apiKeys?.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                        {t('apiKey.empty')}
                    </div>
                ) : (
                    <AnimatePresence>
                        {sortedApiKeys.map((apiKey) => {
                            const statsLayoutId = `${statsPrefix}-${apiKey.id}`;
                            const editLayoutId = `${editPrefix}-${apiKey.id}`;
                            const deleteLayoutId = `${deletePrefix}${apiKey.id}`;
                            return (
                                <APIKeyKeyItem
                                    key={apiKey.id}
                                    apiKey={apiKey}
                                    statsLayoutId={statsLayoutId}
                                    editLayoutId={editLayoutId}
                                    deleteLayoutId={deleteLayoutId}
                                    onViewStats={() => {
                                        closeAllOverlays();
                                        setViewingStats({ apiKey, layoutId: statsLayoutId });
                                    }}
                                    onEdit={() => {
                                        closeAllOverlays();
                                        setEditingKey({ apiKey, layoutId: editLayoutId });
                                    }}
                                    onDelete={() => handleDelete(apiKey.id)}
                                    isDeleting={deleteAPIKey.isPending && deletingId === apiKey.id}
                                />
                            );
                        })}
                    </AnimatePresence>
                )}
            </div>
        </div>
    );
}

function APIKeyDialogPanel() {
    const { setIsOpen } = useMorphingDialog();
    return (
        <APIKeyPanelBase
            idPrefix="apikey-dialog"
            containerClassName="rounded-lg border border-border bg-card p-6 space-y-5 relative w-screen max-w-full md:max-w-xl"
            listClassName="space-y-2 h-[calc(100vh-10rem)] overflow-y-auto"
            renderHeaderExtra={() => (
                <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="h-9 w-9 flex items-center justify-center rounded-lg bg-muted/60 text-muted-foreground transition-colors hover:bg-muted"
                    title="Close"
                >
                    <X className="size-4" />
                </button>
            )}
        />
    );
}

export function SettingAPIKey() {
    return (
        <APIKeyPanelBase
            idPrefix="apikey"
            containerClassName="rounded-lg border border-border bg-card p-6 space-y-5 relative"
            listClassName="space-y-2 h-36 overflow-y-auto"
            renderHeaderExtra={() => (
                <MorphingDialog>
                    <MorphingDialogTrigger className="h-9 w-9 flex items-center justify-center rounded-lg bg-muted/60 text-muted-foreground transition-colors hover:bg-muted">
                        <Maximize2 className="size-4" />
                    </MorphingDialogTrigger>
                    <MorphingDialogContainer>
                        <MorphingDialogContent className="relative">
                            <APIKeyDialogPanel />
                        </MorphingDialogContent>
                    </MorphingDialogContainer>
                </MorphingDialog>
            )}
        />
    );
}

export function TokenManagement() {
    const t = useTranslations('setting');
    const { data: routers = [] } = useRouterList();
    const { data: statsList = [] } = useStatsAPIKey();
    const createAPIKey = useCreateAPIKey();
    const updateAPIKey = useUpdateAPIKey();
    const deleteAPIKey = useDeleteAPIKey();

    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [keyword, setKeyword] = useState('');
    const [enabled, setEnabled] = useState<string>('all');
    const [routerID, setRouterID] = useState<string>('all');
    const [isAdding, setIsAdding] = useState(false);
    const [editingKey, setEditingKey] = useState<APIKey | null>(null);

    const { data, isLoading, isError, refetch } = useAPIKeyPage({
        page,
        page_size: pageSize,
        keyword,
        enabled: enabled === 'all' ? 'all' : enabled === 'true',
        router_id: routerID === 'all' ? 'all' : Number(routerID),
        sort_by: 'id',
        sort_order: 'desc',
    });
    const rows = data?.items ?? [];
    const statsByKey = useMemo(() => new Map(statsList.map((item) => [item.api_key_id, item])), [statsList]);
    const routerNameByID = useMemo(() => new Map(routers.map((router) => [router.id, router.name])), [routers]);

    const handleCreate = useCallback((payload: Omit<APIKey, 'id' | 'api_key'>) => {
        createAPIKey.mutate(payload, {
            onSuccess: () => {
                toast.success(t('apiKey.toast.createSuccess'));
                setIsAdding(false);
            },
            onError: (error) => {
                const msg = (error as unknown as ApiError)?.message;
                toast.error(t('apiKey.toast.createError'), { description: msg });
            },
        });
    }, [createAPIKey, t]);

    const handleUpdate = useCallback((apiKey: APIKey, payload: Omit<APIKey, 'id' | 'api_key'>) => {
        updateAPIKey.mutate({ id: apiKey.id, ...payload }, {
            onSuccess: () => {
                toast.success(t('apiKey.toast.updateSuccess'));
                setEditingKey(null);
            },
            onError: (error) => {
                const msg = (error as unknown as ApiError)?.message;
                toast.error(t('apiKey.toast.updateError'), { description: msg });
            },
        });
    }, [t, updateAPIKey]);

    const handleDelete = useCallback((apiKey: APIKey) => {
        if (!window.confirm(`删除令牌 ${apiKey.name}？`)) return;
        deleteAPIKey.mutate(apiKey.id, {
            onSuccess: () => toast.success(t('apiKey.toast.deleteSuccess')),
            onError: (error) => {
                const msg = (error as unknown as ApiError)?.message;
                toast.error(t('apiKey.toast.deleteError'), { description: msg });
            },
        });
    }, [deleteAPIKey, t]);

    return (
        <div className="flex h-full min-h-0 flex-col gap-4">
            <AdminToolbar
                search={keyword}
                searchPlaceholder="搜索名称或 Key..."
                onSearchChange={(value) => {
                    setKeyword(value);
                    setPage(1);
                }}
                onRefresh={() => refetch()}
                filters={[
                    {
                        label: '状态',
                        value: enabled,
                        onChange: (value) => {
                            setEnabled(value);
                            setPage(1);
                        },
                        options: [
                            { value: 'all', label: '全部状态' },
                            { value: 'true', label: '活跃' },
                            { value: 'false', label: '禁用' },
                        ],
                    },
                    {
                        label: '路由',
                        value: routerID,
                        onChange: (value) => {
                            setRouterID(value);
                            setPage(1);
                        },
                        options: [
                            { value: 'all', label: '全部路由' },
                            ...routers.map((router) => ({ value: String(router.id), label: router.name })),
                        ],
                    },
                ]}
                action={(
                    <Dialog open={isAdding} onOpenChange={setIsAdding}>
                        <DialogTrigger asChild>
                            <Button className="h-10 rounded-lg shadow-sm">
                                <Plus className="size-4" />
                                创建令牌
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="rounded-lg">
                            <DialogHeader>
                                <DialogTitle>创建令牌</DialogTitle>
                                <DialogDescription>为指定路由创建访问令牌。</DialogDescription>
                            </DialogHeader>
                            <APIKeyForm
                                isPending={createAPIKey.isPending}
                                submitLabel={t('apiKey.form.create')}
                                onSubmit={handleCreate}
                                onClose={() => setIsAdding(false)}
                            />
                        </DialogContent>
                    </Dialog>
                )}
            />

            <AdminTableShell>
                <Table className="min-w-[1080px]">
                    <TableHeader className="sticky top-0 z-10 bg-muted/50">
                        <TableRow>
                            <TableHead className="min-w-48">名称</TableHead>
                            <TableHead>API Key</TableHead>
                            <TableHead>路由</TableHead>
                            <TableHead>用量</TableHead>
                            <TableHead>额度</TableHead>
                            <TableHead>过期时间</TableHead>
                            <TableHead>状态</TableHead>
                            <TableHead className="text-right">操作</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableRow><TableCell colSpan={8} className="h-32 text-center text-muted-foreground">加载中...</TableCell></TableRow>
                        ) : isError ? (
                            <TableRow><TableCell colSpan={8} className="h-32 text-center text-destructive">令牌加载失败</TableCell></TableRow>
                        ) : rows.length === 0 ? (
                            <TableRow><TableCell colSpan={8} className="h-32 text-center text-muted-foreground">暂无令牌</TableCell></TableRow>
                        ) : rows.map((apiKey) => {
                            const stats = statsByKey.get(apiKey.id);
                            return (
                                <TableRow key={apiKey.id}>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                                <KeyRound className="size-4" />
                                            </span>
                                            <span className="truncate font-medium">{apiKey.name}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <code className="rounded-md bg-muted px-2 py-1 text-xs text-primary">{maskAPIKey(apiKey.api_key)}</code>
                                            <CopyIconButton
                                                text={apiKey.api_key}
                                                className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                                                copyIconClassName="size-3.5"
                                                checkIconClassName="size-3.5"
                                            />
                                        </div>
                                    </TableCell>
                                    <TableCell>{apiKey.router_id ? routerNameByID.get(apiKey.router_id) ?? `Router #${apiKey.router_id}` : '-'}</TableCell>
                                    <TableCell>
                                        <div className="grid gap-1 text-xs text-muted-foreground">
                                            <span>请求 {stats?.request_count.formatted.value ?? '0'}{stats?.request_count.formatted.unit ?? ''}</span>
                                            <span>Token {stats?.total_token.formatted.value ?? '0'}{stats?.total_token.formatted.unit ?? ''}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        {apiKey.max_cost ? (
                                            <span>{stats?.total_cost.formatted.value ?? '0'}{stats?.total_cost.formatted.unit ?? ''} / ${apiKey.max_cost.toFixed(2)}</span>
                                        ) : (
                                            <span className="text-muted-foreground">无限制</span>
                                        )}
                                    </TableCell>
                                    <TableCell>{formatExpireAt(apiKey.expire_at)}</TableCell>
                                    <TableCell>
                                        <Badge className={apiKey.enabled ? 'bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15' : 'bg-slate-500/15 text-slate-600 hover:bg-slate-500/15'}>
                                            {apiKey.enabled ? '活跃' : '禁用'}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center justify-end gap-1">
                                            <Dialog open={editingKey?.id === apiKey.id} onOpenChange={(open) => setEditingKey(open ? apiKey : null)}>
                                                <DialogTrigger asChild>
                                                    <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs text-muted-foreground">
                                                        <Pencil className="size-3.5" />
                                                        编辑
                                                    </Button>
                                                </DialogTrigger>
                                                <DialogContent className="rounded-lg">
                                                    <DialogHeader>
                                                        <DialogTitle>编辑令牌</DialogTitle>
                                                        <DialogDescription>{apiKey.name}</DialogDescription>
                                                    </DialogHeader>
                                                    <APIKeyForm
                                                        apiKey={apiKey}
                                                        isPending={updateAPIKey.isPending}
                                                        submitLabel={t('apiKey.form.save')}
                                                        onSubmit={(payload) => handleUpdate(apiKey, payload)}
                                                        onClose={() => setEditingKey(null)}
                                                    />
                                                </DialogContent>
                                            </Dialog>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-8 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
                                                disabled={deleteAPIKey.isPending}
                                                onClick={() => handleDelete(apiKey)}
                                            >
                                                {deleteAPIKey.isPending && deleteAPIKey.variables === apiKey.id ? (
                                                    <RefreshCw className="size-3.5 animate-spin" />
                                                ) : (
                                                    <Trash2 className="size-3.5" />
                                                )}
                                                删除
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
