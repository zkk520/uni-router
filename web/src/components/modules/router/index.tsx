'use client';

import { type DragEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Check, GripVertical, KeyRound, LayoutGrid, List, Loader2, Plus, Trash2, X, TestTube2 } from 'lucide-react';
import {
    useCreateRouter,
    useDeleteRouter,
    useRouterDetail,
    useRouterPage,
    useRouterOptions,
    useSwitchRouterEndpoint,
    useTestRouterEndpoint,
    useUpdateRouter,
    type RouteEndpoint,
    type RouteEndpointAddRequest,
    type RouteMode,
    type RouteOptionChannel,
    type RouteProfile,
} from '@/api/endpoints/router';
import { useCreateAPIKey } from '@/api/endpoints/apikey';
import { useModelList } from '@/api/endpoints/model';
import { ChannelType, DEFAULT_PRICING_RULE, normalizePricingRule, type PricingRule } from '@/api/endpoints/channel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/animate-ui/components/animate/tooltip';
import { AdminPagination, AdminToolbar } from '@/components/common/AdminTable';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from '@/components/common/Toast';
import { CopyIconButton } from '@/components/common/CopyButton';
import { useToolbarViewOptionsStore, type ToolbarLayout } from '@/components/modules/toolbar/view-options-store';
import { cn } from '@/lib/utils';
import type { ApiError } from '@/api/types';

function statusClass(status: string) {
    if (status === 'normal') return 'bg-emerald-500';
    if (status === 'error') return 'bg-destructive';
    return 'bg-muted-foreground';
}

function routeModeLabel(mode: RouteMode) {
    if (mode === 'manual') return '主备模式';
    if (mode === 'weighted') return '加权分流';
    return mode;
}

function channelTypeLabel(type?: ChannelType) {
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
            return type == null ? '-' : String(type);
    }
}

function endpointLabel(endpoint: RouteEndpoint, options: RouteOptionChannel[]) {
    const channel = options.find((item) => item.id === endpoint.channel_id);
    const key = channel?.keys.find((item) => item.id === endpoint.channel_key_id);
    return {
        channelName: channel?.name ?? `供应商 #${endpoint.channel_id}`,
        keyName: key?.remark || key?.masked_key || `密钥 #${endpoint.channel_key_id}`,
        keyEnabled: key?.enabled ?? false,
    };
}

function maskAPIKey(apiKey: string) {
    if (!apiKey) return '未生成';
    if (apiKey.length <= 8) return '****';
    return `${apiKey.slice(0, 6)}***${apiKey.slice(-4)}`;
}

function endpointOptionKey(endpoint: RouteEndpoint, options: RouteOptionChannel[]) {
    const channel = options.find((item) => item.id === endpoint.channel_id);
    return channel?.keys.find((item) => item.id === endpoint.channel_key_id);
}

function endpointKey(endpoint: Pick<RouteEndpoint, 'channel_id' | 'channel_key_id'>) {
    return `${endpoint.channel_id}:${endpoint.channel_key_id}`;
}

function effectivePricingRule(endpoint: RouteEndpoint, channel?: RouteOptionChannel): { rule: PricingRule; source: string } {
    const key = channel?.keys.find((item) => item.id === endpoint.channel_key_id);
    const keyRule = normalizePricingRule(key?.pricing_rule);
    if (keyRule.enabled) {
        return { rule: keyRule, source: '密钥规则' };
    }
    const channelRule = normalizePricingRule(channel?.pricing_rule);
    if (channelRule.enabled) {
        return { rule: channelRule, source: '供应商默认' };
    }
    return { rule: { ...DEFAULT_PRICING_RULE, enabled: true }, source: '系统默认' };
}

function pricingPreviewText(rule: PricingRule, baseModel?: { input: number; output: number; cache_read: number; cache_write: number }) {
    if (!baseModel) return `${rule.currency_symbol || rule.currency} · ${rule.multiplier || 1}x / ${rule.unit || '1M Tokens'}`;
    const symbol = rule.currency_symbol || rule.currency;
    const multiplier = rule.multiplier || 1;
    const fmt = (value: number) => `${symbol}${(value * multiplier).toFixed(4)}`;
    return `输入 ${fmt(baseModel.input)} / 输出 ${fmt(baseModel.output)} / 缓存读 ${fmt(baseModel.cache_read)} / ${rule.unit || '1M Tokens'}`;
}

function TooltipText({
    text,
    className,
    tooltipClassName,
}: {
    text: string;
    className?: string;
    tooltipClassName?: string;
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span className={cn('block min-w-0 truncate', className)}>{text}</span>
            </TooltipTrigger>
            <TooltipContent className={cn('max-w-[min(28rem,80vw)]', tooltipClassName)}>{text}</TooltipContent>
        </Tooltip>
    );
}

function SectionTitle({ title, description }: { title: string; description: string }) {
    return (
        <div className="mb-3">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
    );
}

function EditableName({
    value,
    onSave,
    className,
    placeholder,
    title,
}: {
    value: string;
    onSave: (next: string, reset: () => void) => void;
    className?: string;
    placeholder?: string;
    title?: string;
}) {
    const [draft, setDraft] = useState(value);
    const skipNextBlur = useRef(false);

    useEffect(() => {
        setDraft(value);
    }, [value]);

    const reset = () => setDraft(value);
    const commit = () => {
        if (skipNextBlur.current) {
            skipNextBlur.current = false;
            return;
        }
        const next = draft.trim();
        if (!next) {
            reset();
            return;
        }
        if (next === value) return;
        onSave(next, reset);
    };
    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
            event.currentTarget.blur();
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            skipNextBlur.current = true;
            reset();
            event.currentTarget.blur();
        }
    };

    return (
        <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            title={title ?? value}
            className={className}
        />
    );
}

function AddEndpointDialog({
    options,
    endpoints,
    onAdd,
}: {
    options: RouteOptionChannel[];
    endpoints: RouteEndpoint[];
    onAdd: (endpoint: RouteEndpointAddRequest) => void;
}) {
    const [open, setOpen] = useState(false);
    const [channelId, setChannelId] = useState<number>(options.find((item) => item.keys.length > 0)?.id ?? options[0]?.id ?? 0);

    useEffect(() => {
        if (options.length === 0) {
            if (channelId !== 0) setChannelId(0);
            return;
        }

        const nextChannel = options.find((item) => item.id === channelId) ?? options.find((item) => item.keys.length > 0) ?? options[0];
        if (nextChannel.id !== channelId) {
            setChannelId(nextChannel.id);
        }
    }, [channelId, options]);

    const channel = options.find((item) => item.id === channelId) ?? options[0];
    const keys = channel?.keys ?? [];
    const [keyId, setKeyId] = useState<number>(keys[0]?.id ?? 0);

    useEffect(() => {
        if (!channel) {
            if (keyId !== 0) setKeyId(0);
            return;
        }

        const nextKey = channel.keys.find((item) => item.id === keyId) ?? channel.keys[0];
        const nextKeyId = nextKey?.id ?? 0;
        if (nextKeyId !== keyId) {
            setKeyId(nextKeyId);
        }
    }, [channel, keyId]);

    const effectiveKeyId = keys.some((item) => item.id === keyId) ? keyId : keys[0]?.id ?? 0;
    const selectedKey = keys.find((item) => item.id === effectiveKeyId);
    const duplicate = !!channel && !!selectedKey && endpoints.some((item) =>
        item.channel_id === channel.id && item.channel_key_id === selectedKey.id
    );

    const submit = () => {
        if (!channel || !selectedKey || duplicate) return;
        onAdd({
            name: `${channel.name} / ${selectedKey.remark || selectedKey.masked_key}`,
            channel_id: channel.id,
            channel_key_id: selectedKey.id,
            priority: 1,
            weight: 1,
            enabled: true,
            use_pricing_override: false,
            pricing_rule_override: DEFAULT_PRICING_RULE,
        });
        setOpen(false);
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button type="button" size="sm" className="rounded-lg">
                    <Plus className="mr-2 size-4" />
                    添加候选端点
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>添加候选端点</DialogTitle>
                    <DialogDescription>
                        从已有供应商和密钥中选择一条上游路径，加入当前路由的端点池。
                    </DialogDescription>
                </DialogHeader>

                {options.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
                        暂无可用供应商密钥，请先创建供应商和密钥。
                    </div>
                ) : (
                    <div className="grid gap-3">
                        <div className="grid gap-2 md:grid-cols-2">
                            <select
                                value={channel?.id ?? 0}
                                onChange={(e) => {
                                    const nextChannel = options.find((item) => item.id === Number(e.target.value));
                                    setChannelId(nextChannel?.id ?? 0);
                                    setKeyId(nextChannel?.keys.find((item) => item.id === keyId)?.id ?? nextChannel?.keys[0]?.id ?? 0);
                                }}
                                className="h-10 rounded-lg border border-border/70 bg-background px-3 text-sm shadow-none"
                            >
                                {options.map((item) => (
                                    <option key={item.id} value={item.id}>
                                        {item.name}
                                    </option>
                                ))}
                            </select>
                            <select
                                value={effectiveKeyId}
                                onChange={(e) => setKeyId(Number(e.target.value))}
                                className="h-10 rounded-lg border border-border/70 bg-background px-3 text-sm shadow-none"
                            >
                                {keys.map((item) => (
                                    <option key={item.id} value={item.id}>
                                        {item.remark || '无备注'} ({item.masked_key}) · {channelTypeLabel(item.effective_type)} · {item.models?.length ?? 0} 模型
                                    </option>
                                ))}
                            </select>
                        </div>
                        {keys.length === 0 ? (
                            <div className="text-xs text-muted-foreground">当前供应商暂无可用密钥，请切换供应商或先创建密钥。</div>
                        ) : null}
                        {duplicate ? <div className="text-xs text-destructive">该端点已在此路由中。</div> : null}
                    </div>
                )}

                <DialogFooter>
                    <DialogClose asChild>
                        <Button type="button" variant="outline" className="rounded-lg">
                            取消
                        </Button>
                    </DialogClose>
                    <Button
                        type="button"
                        onClick={submit}
                        disabled={!channel || !selectedKey || duplicate || options.length === 0}
                        className="rounded-lg"
                    >
                        <Plus className="mr-2 size-4" />
                        添加端点
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function PricingRulePreview({
    source,
    preview,
}: {
    source: string;
    preview: string;
}) {
    return (
        <div className="mt-3 rounded-xl border border-border/70 bg-muted/20 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="text-xs font-medium text-card-foreground">计费规则</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                        {source} · {preview}
                    </div>
                </div>
                <Badge variant="outline" className="shrink-0">按实际上游密钥计费</Badge>
            </div>
        </div>
    );
}

function RouterViewModeToggle({
    value,
    onChange,
}: {
    value: ToolbarLayout;
    onChange: (value: ToolbarLayout) => void;
}) {
    return (
        <div className="inline-flex rounded-lg border border-border/70 bg-muted/20 p-1">
            <button
                type="button"
                onClick={() => onChange('list')}
                className={cn(
                    'inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors',
                    value === 'list'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                )}
            >
                <List className="size-3.5" />
                列表
            </button>
            <button
                type="button"
                onClick={() => onChange('grid')}
                className={cn(
                    'inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors',
                    value === 'grid'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                )}
            >
                <LayoutGrid className="size-3.5" />
                网格
            </button>
        </div>
    );
}

function RouterDetail({ routerId }: { routerId: number }) {
    const { data: router } = useRouterDetail(routerId);
    const { data: options = [] } = useRouterOptions();
    const { data: models = [] } = useModelList();
    const updateRouter = useUpdateRouter();
    const switchEndpoint = useSwitchRouterEndpoint();
    const testEndpoint = useTestRouterEndpoint();
    const routerLayout = useToolbarViewOptionsStore((s) => s.getRouterLayout('router'));
    const setRouterLayout = useToolbarViewOptionsStore((s) => s.setRouterLayout);
    const [draggingEndpointId, setDraggingEndpointId] = useState<number | null>(null);

    const endpoints = useMemo(() => [...(router?.endpoints ?? [])].sort((a, b) => a.priority - b.priority), [router]);
    const manualDisplayRanks = useMemo(() => {
        if (router?.mode !== 'manual') return new Map<number, number>();
        const ordered = [...endpoints];
        const preferredId = router.preferred_endpoint_id;
        if (preferredId > 0) {
            const preferredIndex = ordered.findIndex((item) => item.id === preferredId);
            if (preferredIndex > 0) {
                const [preferred] = ordered.splice(preferredIndex, 1);
                ordered.unshift(preferred);
            }
        }
        return new Map(ordered.map((item, index) => [item.id, index + 1]));
    }, [endpoints, router?.mode, router?.preferred_endpoint_id]);
    const modelPriceByName = useMemo(() => new Map(models.map((item) => [item.name, item])), [models]);
    const totalWeight = useMemo(() => endpoints.reduce((sum, item) => sum + Math.max(1, item.weight || 1), 0), [endpoints]);
    const duplicateEndpointIds = useMemo(() => {
        const firstByKey = new Map<string, number>();
        const duplicates = new Set<number>();
        for (const endpoint of endpoints) {
            const key = endpointKey(endpoint);
            const first = firstByKey.get(key);
            if (first == null) {
                firstByKey.set(key, endpoint.id);
            } else {
                duplicates.add(first);
                duplicates.add(endpoint.id);
            }
        }
        return duplicates;
    }, [endpoints]);

    if (!router) {
        return (
            <div className="flex h-full items-center justify-center text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
            </div>
        );
    }

    const update = (patch: Partial<RouteProfile>) => {
        updateRouter.mutate(
            { id: router.id, ...patch },
            { onError: (error) => toast.error('路由保存失败', { description: String(error) }) }
        );
    };

    const updateEndpoint = (endpoint: RouteEndpoint, patch: Partial<RouteEndpoint>, options?: { onError?: () => void }) => {
        updateRouter.mutate(
            {
                id: router.id,
                endpoints_to_update: [{ id: endpoint.id, ...patch }],
            },
            {
                onError: (error) => {
                    options?.onError?.();
                    toast.error('端点保存失败', { description: String(error) });
                },
            }
        );
    };

    const reorderEndpoint = (sourceId: number, targetId: number) => {
        if (sourceId === targetId) return;
        const sourceIndex = endpoints.findIndex((item) => item.id === sourceId);
        const targetIndex = endpoints.findIndex((item) => item.id === targetId);
        if (sourceIndex < 0 || targetIndex < 0) return;

        const nextEndpoints = [...endpoints];
        const [moved] = nextEndpoints.splice(sourceIndex, 1);
        nextEndpoints.splice(targetIndex, 0, moved);
        updateRouter.mutate(
            {
                id: router.id,
                endpoints_to_update: nextEndpoints.map((item, index) => ({
                    id: item.id,
                    priority: index + 1,
                })),
            },
            { onError: (error) => toast.error('端点排序失败', { description: String(error) }) }
        );
    };

    const handleEndpointDragStart = (event: DragEvent<HTMLSpanElement>, endpointId: number) => {
        setDraggingEndpointId(endpointId);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(endpointId));
    };

    const handleEndpointDrop = (event: DragEvent<HTMLDivElement>, targetId: number) => {
        event.preventDefault();
        const sourceId = Number(event.dataTransfer.getData('text/plain') || draggingEndpointId);
        setDraggingEndpointId(null);
        if (!Number.isFinite(sourceId)) return;
        reorderEndpoint(sourceId, targetId);
    };

    const addEndpoint = (endpoint: RouteEndpointAddRequest) => {
        const maxPriority = endpoints.reduce((max, item) => Math.max(max, item.priority), 0);
        updateRouter.mutate(
            {
                id: router.id,
                endpoints_to_add: [{ ...endpoint, priority: maxPriority + 1 }],
            },
            {
                onSuccess: () => toast.success('端点已添加'),
                onError: (error) => toast.error('端点添加失败', { description: String(error) }),
            }
        );
    };

    return (
        <div className="flex h-full min-h-0 flex-col gap-4">
            <div className="rounded-xl border border-border/70 bg-card p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <SectionTitle
                        title="路由策略"
                        description="定义这条路由的名称、路由模式，以及上游失败后是否继续尝试其他候选端点。"
                    />
                    <AddEndpointDialog options={options} endpoints={endpoints} onAdd={addEndpoint} />
                </div>
                <div className="grid gap-2 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.75fr)_minmax(0,1.1fr)] lg:items-end">
                    <div className="min-w-0">
                        <div className="mb-1 text-xs font-medium text-muted-foreground">路由名称</div>
                        <EditableName
                            value={router.name}
                            onSave={(name, reset) =>
                                updateRouter.mutate(
                                    { id: router.id, name },
                                    {
                                        onError: (error) => {
                                            reset();
                                            toast.error('路由保存失败', { description: String(error) });
                                        },
                                    }
                                )
                            }
                            className="h-10 rounded-lg font-semibold shadow-none"
                            placeholder="路由名称"
                        />
                    </div>
                    <label className="grid min-w-0 gap-1.5">
                        <span className="text-xs font-medium text-muted-foreground">路由模式</span>
                        <select
                            value={router.mode}
                            onChange={(e) => update({ mode: e.target.value as RouteMode })}
                            className="h-10 w-full min-w-0 rounded-lg border border-border/70 bg-background px-3 text-sm shadow-none"
                        >
                            <option value="manual">主备模式</option>
                            <option value="weighted">加权分流</option>
                        </select>
                    </label>
                    <label className="flex h-10 min-w-0 items-center gap-1.5 self-end whitespace-nowrap rounded-lg border border-border/70 bg-background px-2.5 text-sm">
                        <Switch checked={router.failover_enabled} onCheckedChange={(checked) => update({ failover_enabled: checked })} />
                        <span className="shrink-0">故障转移</span>
                    </label>
                </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
                    <SectionTitle
                        title="端点池"
                        description={
                            router.mode === 'weighted'
                                ? '加权分流会按权重生成本次候选顺序；开启故障转移后，失败时继续尝试后续候选端点。'
                                : '主备模式优先使用首选端点；开启故障转移后，失败时继续尝试后续备用端点。'
                        }
                    />
                    <RouterViewModeToggle value={routerLayout} onChange={(value) => setRouterLayout('router', value)} />
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                    {endpoints.length === 0 ? (
                        <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
                            添加端点后此路由才能使用。
                        </div>
                    ) : (
                        <div
                            className={
                                routerLayout === 'grid'
                                    ? 'grid gap-3 p-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,17rem),1fr))]'
                                    : 'divide-y divide-border/60'
                            }
                        >
                            {endpoints.map((endpoint) => {
                                const label = endpointLabel(endpoint, options);
                                const optionChannel = options.find((item) => item.id === endpoint.channel_id);
                                const optionKey = endpointOptionKey(endpoint, options);
                                const firstModelName = optionKey?.models?.[0] ?? optionChannel?.models[0];
                                const baseModel = firstModelName ? modelPriceByName.get(firstModelName) : undefined;
                                const pricing = effectivePricingRule(endpoint, optionChannel);
                                const current = router.preferred_endpoint_id === endpoint.id;
                                const isPrimary = router.mode === 'manual' && current;
                                const manualDisplayRank = manualDisplayRanks.get(endpoint.id) ?? 0;
                                const showManualRank = router.mode === 'manual' && router.failover_enabled && manualDisplayRank > 1;
                                const invalid = !label.keyEnabled;
                                const duplicate = duplicateEndpointIds.has(endpoint.id);
                                const isSwitchingEndpoint = switchEndpoint.isPending && switchEndpoint.variables?.endpoint_id === endpoint.id;
                                const switchDisabledReason = current
                                    ? '已是主端点'
                                    : !endpoint.enabled
                                        ? '请先启用端点'
                                        : invalid
                                            ? '上游密钥无效'
                                            : endpoint.status === 'error'
                                                ? '端点状态异常，请先测试或修复'
                                                : undefined;
                                const percent = Math.round((Math.max(1, endpoint.weight || 1) / totalWeight) * 100);
                                const isGrid = routerLayout === 'grid';

                                return (
                                    <div
                                        key={endpoint.id}
                                        className={cn(
                                            isGrid
                                                ? 'flex h-full min-h-0 flex-col rounded-xl border border-border/70 p-4 transition-colors'
                                                : 'px-4 py-3 transition-colors',
                                            isPrimary ? 'bg-primary/[0.04]' : 'bg-background/70',
                                            duplicate && 'bg-amber-500/[0.06]',
                                            invalid && 'bg-destructive/[0.05]',
                                            draggingEndpointId === endpoint.id && 'opacity-60 ring-2 ring-primary/30'
                                        )}
                                        onDragOver={(event) => {
                                            event.preventDefault();
                                            event.dataTransfer.dropEffect = 'move';
                                        }}
                                        onDrop={(event) => handleEndpointDrop(event, endpoint.id)}
                                    >
                                        <div className={cn('grid min-w-0 gap-3', isGrid && 'h-full')}>
                                            <div className="min-w-0">
                                                <div className="grid min-w-0 grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center justify-start gap-2">
                                                    <span className={cn('size-2 rounded-full', statusClass(endpoint.status))} />
                                                    <span
                                                        draggable
                                                        title={router.mode === 'weighted' ? '拖动调整显示顺序' : '拖动调整主备顺序'}
                                                        onDragStart={(event) => handleEndpointDragStart(event, endpoint.id)}
                                                        onDragEnd={() => setDraggingEndpointId(null)}
                                                        className="inline-flex size-7 cursor-grab items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground active:cursor-grabbing"
                                                    >
                                                        <GripVertical className="size-4" />
                                                        <span className="sr-only">{router.mode === 'weighted' ? '拖动调整显示顺序' : '拖动调整主备顺序'}</span>
                                                    </span>
                                                    <EditableName
                                                        value={endpoint.name}
                                                        onSave={(name, reset) => updateEndpoint(endpoint, { name }, { onError: reset })}
                                                        title={endpoint.name}
                                                        className={cn(
                                                            'h-9 min-w-0 rounded-lg border border-border/70 bg-background px-2 font-semibold shadow-none',
                                                            isGrid ? 'w-full' : 'w-[clamp(10rem,32vw,18rem)]'
                                                        )}
                                                    />
                                                    <div className="flex shrink-0 items-center gap-1.5">
                                                        {isPrimary ? <Badge>主端点</Badge> : null}
                                                        {showManualRank ? <Badge variant="outline">#{manualDisplayRank}</Badge> : null}
                                                        {duplicate ? <Badge variant="outline" className="border-amber-500/70 text-amber-700">重复</Badge> : null}
                                                    </div>
                                                </div>
                                                <div className={cn(
                                                    'mt-2 grid gap-x-4 gap-y-1 text-xs text-muted-foreground',
                                                    isGrid ? 'grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-4'
                                                )}>
                                                    <TooltipText text={`供应商：${label.channelName}`} />
                                                    <TooltipText text={`密钥：${label.keyName}`} />
                                                    <TooltipText text={`类型：${channelTypeLabel(optionKey?.effective_type)} · 模型 ${optionKey?.models?.length ?? 0}`} />
                                                    <TooltipText
                                                        text={
                                                            optionKey?.pricing_rule?.enabled
                                                                ? `密钥倍率 ${optionKey.pricing_rule.multiplier || 1}x`
                                                                : '密钥未单独定价，将继承供应商默认或系统默认'
                                                        }
                                                    />
                                                </div>
                                                {invalid ? <div className="mt-2 text-xs text-destructive">上游密钥无效</div> : null}
                                                {duplicate ? (
                                                    <div className="mt-2 text-xs text-amber-700">同一供应商和密钥已被重复添加，请删除多余端点。</div>
                                                ) : null}
                                                {endpoint.last_error ? (
                                                    <TooltipText
                                                        text={endpoint.last_error}
                                                        className="mt-2 line-clamp-2 whitespace-normal break-words text-destructive"
                                                        tooltipClassName="max-w-[min(36rem,90vw)]"
                                                    />
                                                ) : null}
                                                <div className="mt-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                                                    <div className={cn('flex min-w-0 gap-2', isGrid ? 'flex-col' : 'items-center')}>
                                                        <span className="shrink-0 font-medium text-card-foreground">计费规则</span>
                                                        <TooltipText
                                                            text={`${pricing.source} · ${pricingPreviewText(pricing.rule, baseModel)}`}
                                                            className={cn('min-w-0', isGrid ? 'line-clamp-2 whitespace-normal break-words' : 'truncate')}
                                                            tooltipClassName="max-w-[min(36rem,90vw)]"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                            <div className={cn('flex flex-wrap items-center gap-2 border-t border-border/50 pt-3', isGrid && 'mt-auto')}>
                                                {router.mode === 'manual' ? (
                                                    <Button
                                                        variant={current ? 'secondary' : 'default'}
                                                        size="sm"
                                                        disabled={!!switchDisabledReason || switchEndpoint.isPending}
                                                        title={switchDisabledReason}
                                                        onClick={() =>
                                                            switchEndpoint.mutate(
                                                                { router_id: router.id, endpoint_id: endpoint.id },
                                                                {
                                                                    onSuccess: () => toast.success(`已设为主端点：${endpoint.name}`),
                                                                    onError: (error) => toast.error('切换端点失败', { description: error.message }),
                                                                }
                                                            )
                                                        }
                                                    >
                                                        {isSwitchingEndpoint ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Check className="size-4 mr-1" />}
                                                        {current ? '主端点' : '设为主端点'}
                                                    </Button>
                                                ) : (
                                                    <Badge variant="outline">预计占比 {percent}%</Badge>
                                                )}
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    title="测试端点"
                                                    onClick={() =>
                                                        testEndpoint.mutate(endpoint.id, {
                                                            onSuccess: (result) => {
                                                                if (result.success) {
                                                                    toast.success('端点测试成功', { description: `${result.latency_ms}ms` });
                                                                } else {
                                                                    toast.error('端点测试失败', { description: result.error });
                                                                }
                                                            },
                                                            onError: (error) => toast.error('端点测试失败', { description: String(error) }),
                                                        })
                                                    }
                                                >
                                                    <TestTube2 className="size-4" />
                                                    测试
                                                </Button>
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild>
                                                        <Button variant="destructive" size="sm">
                                                            <Trash2 className="size-4" />
                                                        </Button>
                                                    </AlertDialogTrigger>
                                                    <AlertDialogContent>
                                                        <AlertDialogHeader>
                                                            <AlertDialogTitle>删除端点？</AlertDialogTitle>
                                                            <AlertDialogDescription>
                                                                将从当前路由中删除“{endpoint.name}”。已有请求不会受影响，但后续转发不会再使用这个端点。
                                                            </AlertDialogDescription>
                                                        </AlertDialogHeader>
                                                        <AlertDialogFooter>
                                                            <AlertDialogCancel>取消</AlertDialogCancel>
                                                            <AlertDialogAction
                                                                className="bg-destructive text-white hover:bg-destructive/90"
                                                                onClick={() =>
                                                                    updateRouter.mutate(
                                                                        { id: router.id, endpoints_to_delete: [endpoint.id] },
                                                                        {
                                                                            onError: (error) => toast.error('删除失败', { description: String(error) }),
                                                                        }
                                                                    )
                                                                }
                                                            >
                                                                删除端点
                                                            </AlertDialogAction>
                                                        </AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export function Router() {
    const createRouter = useCreateRouter();
    const deleteRouter = useDeleteRouter();
    const createAPIKey = useCreateAPIKey();
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [keyword, setKeyword] = useState('');
    const [mode, setMode] = useState<string>('all');
    const { data, error, isLoading, refetch } = useRouterPage({
        page,
        page_size: pageSize,
        keyword,
        mode: mode === 'all' ? 'all' : (mode as RouteMode),
        sort_by: 'id',
        sort_order: 'desc',
    });
    const routers = data?.items ?? [];

    const selected = selectedId ?? routers[0]?.id ?? null;

    const create = () => {
        createRouter.mutate(
            {
                name: `路由 ${routers.length + 1}`,
                mode: 'manual',
                failover_enabled: true,
            },
            {
                onSuccess: (router) => {
                    toast.success('路由已创建');
                    setSelectedId(router.id);
                },
                onError: (error) => toast.error('创建路由失败', { description: String(error) }),
            }
        );
    };

    const createBoundAPIKey = (router: RouteProfile) => {
        createAPIKey.mutate(
            {
                name: `${router.name} 令牌`,
                enabled: true,
                router_id: router.id,
            },
            {
                onSuccess: () => toast.success('令牌已创建'),
                onError: (error) => {
                    const msg = (error as unknown as ApiError)?.message;
                    toast.error('令牌创建失败', { description: msg || String(error) });
                },
            }
        );
    };

    return (
        <div className="grid h-full min-h-0 gap-4 overflow-auto lg:grid-cols-[360px_1fr] lg:overflow-hidden">
            <div className="flex min-h-0 flex-col gap-3">
                <AdminToolbar
                    search={keyword}
                    searchPlaceholder="搜索路由..."
                    compact
                    onSearchChange={(value) => {
                        setKeyword(value);
                        setPage(1);
                    }}
                    onRefresh={() => refetch()}
                    filters={[
                        {
                            label: '模式',
                            value: mode,
                            onChange: (value) => {
                                setMode(value);
                                setPage(1);
                            },
                            options: [
                                { value: 'all', label: '全部模式' },
                                { value: 'manual', label: '主备模式' },
                                { value: 'weighted', label: '加权分流' },
                            ],
                        },
                    ]}
                    action={(
                        <Button className="h-10 min-w-[6.5rem] rounded-lg px-3 shadow-sm" onClick={create} disabled={createRouter.isPending}>
                            <Plus className="size-4" />
                            创建路由
                        </Button>
                    )}
                />
                <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm lg:flex-1">
                    <div className="min-h-0 lg:flex-1 lg:overflow-auto">
                        {isLoading ? (
                            <div className="flex justify-center p-6"><Loader2 className="size-5 animate-spin" /></div>
                        ) : error ? (
                            <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                                路由加载失败：{String(error)}
                            </div>
                        ) : routers.length === 0 ? (
                            <div className="p-6 text-center text-sm text-muted-foreground">暂无路由。</div>
                        ) : (
                            <div className="divide-y divide-border/60">
                                {routers.map((router) => {
                                    const boundKey = router.bound_api_key;
                                    const boundKeyCount = router.bound_api_key_count ?? 0;
                                    return (
                                        <div
                                            key={router.id}
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => setSelectedId(router.id)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault();
                                                    setSelectedId(router.id);
                                                }
                                            }}
                                            className={cn(
                                                'relative w-full cursor-pointer border-0 border-b border-border/60 px-4 py-4 pr-12 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring last:border-b-0',
                                                selected === router.id ? 'bg-primary/[0.04]' : 'bg-background/80 hover:bg-muted/40'
                                            )}
                                        >
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <button
                                                        type="button"
                                                        aria-label="删除路由"
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                                                    >
                                                        <X className="size-4" />
                                                    </button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>删除路由？</AlertDialogTitle>
                                                        <AlertDialogDescription>
                                                            将删除“{router.name}”及其所有端点。已绑定 API Key 的路由无法删除，系统会阻止该操作。
                                                        </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>取消</AlertDialogCancel>
                                                        <AlertDialogAction
                                                            className="bg-destructive text-white hover:bg-destructive/90"
                                                            onClick={() =>
                                                                deleteRouter.mutate(router.id, {
                                                                    onError: (error) => toast.error('删除失败', { description: String(error) }),
                                                                })
                                                            }
                                                        >
                                                            删除路由
                                                        </AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="truncate text-sm font-semibold">{router.name}</span>
                                                <Badge variant="outline">{routeModeLabel(router.mode)}</Badge>
                                            </div>
                                            <div className="mt-1 text-xs text-muted-foreground">
                                                {router.endpoints?.length ?? 0} 个端点 / {boundKeyCount} 个密钥
                                            </div>
                                            {boundKey ? (
                                                <div className="mt-3 rounded-lg border border-border/60 bg-background/70 p-2">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <div className="flex min-w-0 items-center gap-2">
                                                            <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                                                            <div className="min-w-0">
                                                                <div className="truncate text-xs font-medium">{boundKey.name}</div>
                                                                <code className="block truncate text-xs text-muted-foreground">{maskAPIKey(boundKey.api_key)}</code>
                                                            </div>
                                                        </div>
                                                        <div className="flex shrink-0 items-center gap-1.5">
                                                            <Badge variant={boundKey.enabled ? 'outline' : 'secondary'} className="text-[10px]">
                                                                {boundKey.enabled ? '启用' : '停用'}
                                                            </Badge>
                                                            <div onClick={(e) => e.stopPropagation()}>
                                                                <CopyIconButton
                                                                    text={boundKey.api_key}
                                                                    className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary transition-all hover:bg-primary hover:text-primary-foreground active:scale-95"
                                                                    copyIconClassName="size-4"
                                                                    checkIconClassName="size-4"
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                    {boundKeyCount > 1 ? (
                                                        <div className="mt-2 text-xs text-amber-700">该路由存在多个历史令牌，请在令牌管理中清理。</div>
                                                    ) : null}
                                                </div>
                                            ) : boundKeyCount > 0 ? (
                                                <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700">
                                                    已绑定令牌，但当前接口未返回密钥详情；后端更新后可在此处直接复制。
                                                </div>
                                            ) : (
                                                <Button
                                                    type="button"
                                                    variant="secondary"
                                                    size="sm"
                                                    className="mt-3 w-full rounded-lg"
                                                    disabled={createAPIKey.isPending}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        createBoundAPIKey(router);
                                                    }}
                                                >
                                                    {createAPIKey.isPending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                                                    一键创建令牌
                                                </Button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                    <AdminPagination
                        page={data?.page ?? page}
                        pageSize={data?.page_size ?? pageSize}
                        total={data?.total ?? 0}
                        onPageChange={setPage}
                        onPageSizeChange={(value) => {
                            setPageSize(value);
                            setPage(1);
                        }}
                        compact
                    />
                </div>
            </div>
            <div className="min-h-[480px] rounded-xl border border-border/70 bg-card p-4 shadow-sm lg:min-h-0 lg:overflow-hidden">
                {selected ? (
                    <RouterDetail routerId={selected} />
                ) : (
                    <div className="flex h-full items-center justify-center text-muted-foreground">创建一个路由后开始使用。</div>
                )}
            </div>
        </div>
    );
}
