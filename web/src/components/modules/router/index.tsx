'use client';

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd';
import { Check, Copy, GripVertical, KeyRound, LayoutGrid, List, Loader2, Plus, Trash2, X, TestTube2 } from 'lucide-react';
import {
    useCreateRouter,
    useDeleteRouter,
    useReorderRouters,
    useRouterDetail,
    useRouterList,
    useRouterOptions,
    useSwitchRouterEndpoint,
    useTestRouterEndpoint,
    useUpdateRouter,
    type RouteEndpoint,
    type RouteEndpointAddRequest,
    type RouteMode,
    type RouteOptionChannel,
    type RouteProfile,
    type RouteProfileCreateRequest,
} from '@/api/endpoints/router';
import { useCreateAPIKey } from '@/api/endpoints/apikey';
import { useModelList } from '@/api/endpoints/model';
import { ChannelType, DEFAULT_PRICING_RULE, normalizePricingRule, type PricingRule } from '@/api/endpoints/channel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { AdminPagination, AdminToolbar } from '@/components/common/AdminTable';
import { OverflowTooltipText } from '@/components/common/OverflowTooltipText';
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

function endpointLabel(endpoint: Pick<RouteEndpoint, 'channel_id' | 'channel_key_id'>, options: RouteOptionChannel[]) {
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

function endpointOptionKey(endpoint: Pick<RouteEndpoint, 'channel_id' | 'channel_key_id'>, options: RouteOptionChannel[]) {
    const channel = options.find((item) => item.id === endpoint.channel_id);
    return channel?.keys.find((item) => item.id === endpoint.channel_key_id);
}

function endpointKey(endpoint: Pick<RouteEndpoint, 'channel_id' | 'channel_key_id'>) {
    return `${endpoint.channel_id}:${endpoint.channel_key_id}`;
}

function reorderByIndex<T>(items: T[], sourceIndex: number, targetIndex: number) {
    const next = [...items];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    return next;
}

function duplicateRouteName(sourceName: string, routes: RouteProfile[]) {
    const names = new Set(routes.map((route) => route.name));
    const base = `${sourceName.trim() || '路由'} - 副本`;
    if (!names.has(base)) return base;
    for (let index = 2; index < 1000; index += 1) {
        const candidate = `${base} ${index}`;
        if (!names.has(candidate)) return candidate;
    }
    return `${base} ${Date.now()}`;
}

function routeToCreateRequest(route: RouteProfile, name: string): { data: RouteProfileCreateRequest; preferredEndpointKey?: string } {
    const orderedEndpoints = [...(route.endpoints ?? [])].sort((a, b) => a.priority - b.priority);
    const preferredEndpoint = route.mode === 'manual'
        ? orderedEndpoints.find((endpoint) => endpoint.id === route.preferred_endpoint_id)
        : undefined;

    return {
        data: {
            name,
            mode: route.mode,
            failover_enabled: route.failover_enabled,
            endpoints: orderedEndpoints.map((endpoint) => ({
                name: endpoint.name,
                channel_id: endpoint.channel_id,
                channel_key_id: endpoint.channel_key_id,
                priority: endpoint.priority,
                weight: endpoint.weight,
                enabled: endpoint.enabled,
                use_pricing_override: endpoint.use_pricing_override,
                pricing_rule_override: normalizePricingRule(endpoint.pricing_rule_override),
            })),
        },
        preferredEndpointKey: preferredEndpoint ? endpointKey(preferredEndpoint) : undefined,
    };
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
    return <OverflowTooltipText text={text} className={className} tooltipClassName={tooltipClassName} />;
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
    endpoints: Array<Pick<RouteEndpoint, 'channel_id' | 'channel_key_id'>>;
    onAdd: (endpoint: RouteEndpointAddRequest) => void;
}) {
    const [open, setOpen] = useState(false);
    const [channelId, setChannelId] = useState<number>(options.find((item) => item.keys.length > 0)?.id ?? options[0]?.id ?? 0);
    const selectedChannelId = useMemo(() => {
        if (options.length === 0) return 0;
        return (options.find((item) => item.id === channelId) ?? options.find((item) => item.keys.length > 0) ?? options[0]).id;
    }, [channelId, options]);
    const channel = options.find((item) => item.id === selectedChannelId) ?? options[0];
    const keys = channel?.keys ?? [];
    const [keyId, setKeyId] = useState<number>(keys[0]?.id ?? 0);

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
                                value={selectedChannelId}
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

function RouteStrategyForm({
    name,
    mode,
    failoverEnabled,
    onNameChange,
    onModeChange,
    onFailoverChange,
}: {
    name: string;
    mode: RouteMode;
    failoverEnabled: boolean;
    onNameChange: (value: string) => void;
    onModeChange: (value: RouteMode) => void;
    onFailoverChange: (value: boolean) => void;
}) {
    return (
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.75fr)_minmax(0,1.1fr)] lg:items-end">
            <div className="min-w-0">
                <div className="mb-1 text-xs font-medium text-muted-foreground">路由名称</div>
                <Input
                    value={name}
                    onChange={(e) => onNameChange(e.target.value)}
                    className="h-10 rounded-lg font-semibold shadow-none"
                    placeholder="路由名称"
                />
            </div>
            <label className="grid min-w-0 gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">路由模式</span>
                <select
                    value={mode}
                    onChange={(e) => onModeChange(e.target.value as RouteMode)}
                    className="h-10 w-full min-w-0 rounded-lg border border-border/70 bg-background px-3 text-sm shadow-none"
                >
                    <option value="manual">主备模式</option>
                    <option value="weighted">加权分流</option>
                </select>
            </label>
            <label className="flex h-10 min-w-0 items-center gap-1.5 self-end whitespace-nowrap rounded-lg border border-border/70 bg-background px-2.5 text-sm">
                <Switch checked={failoverEnabled} onCheckedChange={onFailoverChange} />
                <span className="shrink-0">故障转移</span>
            </label>
        </div>
    );
}

function CreateRouterDialog({
    open,
    onOpenChange,
    defaultName,
    onCreate,
    isPending,
}: {
    open: boolean;
    onOpenChange: (value: boolean) => void;
    defaultName: string;
    onCreate: (data: RouteProfileCreateRequest, options: { preferredEndpointKey?: string }) => void;
    isPending: boolean;
}) {
    const { data: options = [] } = useRouterOptions();
    const [name, setName] = useState(defaultName);
    const [mode, setMode] = useState<RouteMode>('manual');
    const [failoverEnabled, setFailoverEnabled] = useState(true);
    const [endpoints, setEndpoints] = useState<RouteEndpointAddRequest[]>([]);
    const [preferredIndex, setPreferredIndex] = useState(0);
    const preferredEndpointIndex = useMemo(() => {
        if (endpoints[preferredIndex]?.enabled) return preferredIndex;
        return endpoints.findIndex((endpoint) => endpoint.enabled);
    }, [endpoints, preferredIndex]);

    const totalWeight = useMemo(() => endpoints.reduce((sum, item) => item.enabled ? sum + Math.max(1, item.weight || 1) : sum, 0), [endpoints]);
    const duplicateEndpointKeys = useMemo(() => {
        const firstByKey = new Map<string, number>();
        const duplicates = new Set<number>();
        endpoints.forEach((endpoint, index) => {
            const key = endpointKey(endpoint);
            const first = firstByKey.get(key);
            if (first == null) {
                firstByKey.set(key, index);
            } else {
                duplicates.add(first);
                duplicates.add(index);
            }
        });
        return duplicates;
    }, [endpoints]);
    const hasDuplicates = duplicateEndpointKeys.size > 0;

    const orderDraftEndpoints = (items: RouteEndpointAddRequest[]) => [
        ...items.filter((item) => item.enabled),
        ...items.filter((item) => !item.enabled),
    ].map((item, itemIndex) => ({ ...item, priority: itemIndex + 1 }));

    const addEndpoint = (endpoint: RouteEndpointAddRequest) => {
        setEndpoints((current) => orderDraftEndpoints([...current, endpoint]));
    };

    const updateEndpoint = (index: number, patch: Partial<RouteEndpointAddRequest>) => {
        setEndpoints((current) => {
            const next = current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item);
            return patch.enabled === undefined ? next : orderDraftEndpoints(next);
        });
    };

    const removeEndpoint = (index: number) => {
        setEndpoints((current) => orderDraftEndpoints(current.filter((_, itemIndex) => itemIndex !== index)));
        setPreferredIndex((current) => {
            if (endpoints.length <= 1) return 0;
            if (current === index) return Math.min(index, endpoints.length - 2);
            if (current > index) return current - 1;
            return current;
        });
    };

    const moveEndpoint = (index: number, direction: -1 | 1) => {
        setEndpoints((current) => {
            const target = index + direction;
            if (target < 0 || target >= current.length) return current;
            const next = [...current];
            const [item] = next.splice(index, 1);
            next.splice(target, 0, item);
            return orderDraftEndpoints(next);
        });
        setPreferredIndex((current) => {
            const target = index + direction;
            if (current === index) return target;
            if (current === target) return index;
            return current;
        });
    };

    const submit = () => {
        const trimmedName = name.trim();
        if (!trimmedName) {
            toast.error('请填写路由名称');
            return;
        }
        if (hasDuplicates) {
            toast.error('请先删除重复的候选端点');
            return;
        }
        const orderedEndpoints = orderDraftEndpoints(endpoints);
        const preferredEndpoint = mode === 'manual' && preferredEndpointIndex >= 0 ? endpoints[preferredEndpointIndex] : undefined;
        onCreate(
            {
                name: trimmedName,
                mode,
                failover_enabled: failoverEnabled,
                endpoints: orderedEndpoints,
            },
            { preferredEndpointKey: preferredEndpoint ? endpointKey(preferredEndpoint) : undefined }
        );
    };

    return (
        <Dialog open={open} onOpenChange={(value) => !isPending && onOpenChange(value)}>
            <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-4xl">
                <DialogHeader>
                    <DialogTitle>创建路由</DialogTitle>
                    <DialogDescription>
                        先在弹窗中配置路由草稿；点击创建成功后，才会加入左侧列表并进入右侧编辑。
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 space-y-4 overflow-auto pr-1">
                    <div className="rounded-xl border border-border/70 bg-card p-4">
                        <SectionTitle
                            title="路由策略"
                            description="创建时先设置名称、路由模式，以及上游失败后是否继续尝试其他候选端点。"
                        />
                        <RouteStrategyForm
                            name={name}
                            mode={mode}
                            failoverEnabled={failoverEnabled}
                            onNameChange={setName}
                            onModeChange={setMode}
                            onFailoverChange={setFailoverEnabled}
                        />
                    </div>

                    <div className="rounded-xl border border-border/70 bg-card">
                        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
                            <SectionTitle
                                title="端点池草稿"
                                description="提交前端点只保存在本地草稿中，不会写入真实路由。"
                            />
                            <AddEndpointDialog options={options} endpoints={endpoints} onAdd={addEndpoint} />
                        </div>
                        {endpoints.length === 0 ? (
                            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                                可先不添加端点，创建后再在右侧编辑区维护端点池。
                            </div>
                        ) : (
                            <div className="grid gap-2 p-3">
                                {endpoints.map((endpoint, index) => {
                                    const label = endpointLabel(endpoint, options);
                                    const duplicate = duplicateEndpointKeys.has(index);
                                    const percent = endpoint.enabled && totalWeight > 0
                                        ? Math.round((Math.max(1, endpoint.weight || 1) / totalWeight) * 100)
                                        : 0;
                                    return (
                                        <div key={`${endpoint.channel_id}:${endpoint.channel_key_id}:${index}`} className={cn('space-y-3 px-4 py-3', duplicate && 'bg-amber-500/[0.06]')}>
                                            <div className="grid min-w-0 gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                                                <Input
                                                    value={endpoint.name}
                                                    onChange={(e) => updateEndpoint(index, { name: e.target.value })}
                                                    className="h-9 rounded-lg font-semibold shadow-none"
                                                    placeholder="端点名称"
                                                />
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    <label className="flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-muted-foreground">
                                                        <Switch checked={endpoint.enabled} onCheckedChange={(checked) => updateEndpoint(index, { enabled: checked })} />
                                                        <span>{endpoint.enabled ? '启用' : '停用'}</span>
                                                    </label>
                                                    {mode === 'manual' ? (
                                                        <Button
                                                            type="button"
                                                            variant={preferredEndpointIndex === index ? 'secondary' : 'outline'}
                                                            size="sm"
                                                            disabled={!endpoint.enabled}
                                                            title={endpoint.enabled ? undefined : '请先启用端点'}
                                                            onClick={() => setPreferredIndex(index)}
                                                        >
                                                            {preferredEndpointIndex === index ? '主端点' : '设为主端点'}
                                                        </Button>
                                                    ) : endpoint.enabled ? (
                                                        <Badge variant="outline">预计占比 {percent}%</Badge>
                                                    ) : (
                                                        <Badge variant="outline">不参与分流</Badge>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
                                                <TooltipText text={`供应商：${label.channelName}`} />
                                                <TooltipText text={`密钥：${label.keyName}`} />
                                                <TooltipText text={`优先级：${index + 1}`} />
                                            </div>
                                            {duplicate ? <div className="text-xs text-amber-700">同一供应商和密钥已被重复添加，请删除多余端点。</div> : null}
                                            <div className="flex flex-wrap items-center gap-2">
                                                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                                    权重
                                                    <Input
                                                        type="number"
                                                        min={1}
                                                        value={endpoint.weight}
                                                        onChange={(e) => updateEndpoint(index, { weight: Math.max(1, Number(e.target.value) || 1) })}
                                                        className="h-8 w-20 rounded-lg shadow-none"
                                                    />
                                                </label>
                                                <Button type="button" variant="secondary" size="sm" disabled={!endpoint.enabled || index === 0} onClick={() => moveEndpoint(index, -1)}>
                                                    上移
                                                </Button>
                                                <Button type="button" variant="secondary" size="sm" disabled={!endpoint.enabled || index === endpoints.length - 1 || !endpoints[index + 1]?.enabled} onClick={() => moveEndpoint(index, 1)}>
                                                    下移
                                                </Button>
                                                <Button type="button" variant="destructive" size="sm" onClick={() => removeEndpoint(index)}>
                                                    <Trash2 className="size-4" />
                                                    删除
                                                </Button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" className="rounded-lg" disabled={isPending} onClick={() => onOpenChange(false)}>
                        取消
                    </Button>
                    <Button type="button" className="rounded-lg" disabled={isPending || !name.trim() || hasDuplicates} onClick={submit}>
                        {isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Plus className="mr-2 size-4" />}
                        创建路由
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
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
    const { data: router, error: detailError, isError } = useRouterDetail(routerId);
    const { data: options = [] } = useRouterOptions();
    const { data: models = [] } = useModelList();
    const updateRouter = useUpdateRouter();
    const switchEndpoint = useSwitchRouterEndpoint();
    const testEndpoint = useTestRouterEndpoint();
    const routerLayout = useToolbarViewOptionsStore((s) => s.getRouterLayout('router'));
    const setRouterLayout = useToolbarViewOptionsStore((s) => s.setRouterLayout);

    const routerEndpoints = router?.endpoints;
    const routerMode = router?.mode;
    const preferredEndpointId = router?.preferred_endpoint_id ?? 0;
    const baseEndpoints = useMemo(() => [...(routerEndpoints ?? [])].sort((a, b) => a.priority - b.priority), [routerEndpoints]);
    const enabledEndpoints = useMemo(() => {
        const enabled = baseEndpoints.filter((endpoint) => endpoint.enabled);
        if (routerMode !== 'manual' || preferredEndpointId <= 0) return enabled;
        const preferredIndex = enabled.findIndex((item) => item.id === preferredEndpointId);
        if (preferredIndex <= 0) return enabled;
        const ordered = [...enabled];
        const [preferred] = ordered.splice(preferredIndex, 1);
        ordered.unshift(preferred);
        return ordered;
    }, [baseEndpoints, routerMode, preferredEndpointId]);
    const disabledEndpoints = useMemo(() => baseEndpoints.filter((endpoint) => !endpoint.enabled), [baseEndpoints]);
    const endpoints = useMemo(() => [...enabledEndpoints, ...disabledEndpoints], [enabledEndpoints, disabledEndpoints]);
    const manualDisplayRanks = useMemo(() => {
        if (routerMode !== 'manual') return new Map<number, number>();
        return new Map(enabledEndpoints.map((item, index) => [item.id, index + 1]));
    }, [enabledEndpoints, routerMode]);
    const modelPriceByName = useMemo(() => new Map(models.map((item) => [item.name, item])), [models]);
    const totalWeight = useMemo(() => enabledEndpoints.reduce((sum, item) => sum + Math.max(1, item.weight || 1), 0), [enabledEndpoints]);
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

    if (isError) {
        return (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                当前路由已不存在或加载失败，请从左侧重新选择路由。{detailError ? ` ${String(detailError)}` : ''}
            </div>
        );
    }

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

    const endpointPriorityUpdates = (items: RouteEndpoint[]) => [
        ...items.filter((item) => item.enabled),
        ...items.filter((item) => !item.enabled),
    ].map((item, index) => ({ id: item.id, priority: index + 1 }));

    const updateEndpoint = (endpoint: RouteEndpoint, patch: Partial<RouteEndpoint>, options?: { onError?: () => void }) => {
        if (patch.enabled !== undefined) {
            const nextEndpoints = endpoints.map((item) => item.id === endpoint.id ? { ...item, ...patch } : item);
            const enabled = nextEndpoints.filter((item) => item.enabled);
            const preferredStillEnabled = enabled.some((item) => item.id === router.preferred_endpoint_id);
            const nextPreferredEndpointID = router.mode === 'manual' && !preferredStillEnabled
                ? enabled[0]?.id ?? 0
                : undefined;
            updateRouter.mutate(
                {
                    id: router.id,
                    ...(nextPreferredEndpointID !== undefined ? { preferred_endpoint_id: nextPreferredEndpointID } : {}),
                    endpoints_to_update: endpointPriorityUpdates(nextEndpoints).map((item) => (
                        item.id === endpoint.id ? { ...item, ...patch } : item
                    )),
                },
                {
                    onError: (error) => {
                        options?.onError?.();
                        toast.error('端点保存失败', { description: String(error) });
                    },
                }
            );
            return;
        }
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

    const handleEndpointDragEnd = (result: DropResult) => {
        const { destination, draggableId, source } = result;
        if (!destination || updateRouter.isPending || routerLayout !== 'list') return;
        if (destination.droppableId !== 'endpoints' || source.droppableId !== 'endpoints') return;
        if (destination.index === source.index) return;

        const sourceId = Number(draggableId.replace('endpoint-', ''));
        const sourceEndpoint = endpoints.find((item) => item.id === sourceId);
        if (!sourceEndpoint?.enabled) return;

        const nextEnabledEndpoints = reorderByIndex(enabledEndpoints, source.index, Math.min(destination.index, enabledEndpoints.length - 1));
        const nextEndpoints = [...nextEnabledEndpoints, ...disabledEndpoints];
        updateRouter.mutate(
            {
                id: router.id,
                endpoints_to_update: endpointPriorityUpdates(nextEndpoints),
            },
            {
                onSuccess: () => toast.success('端点顺序已保存'),
                onError: (error) => toast.error('端点排序失败', { description: String(error) }),
            }
        );
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
                        <DragDropContext onDragEnd={handleEndpointDragEnd}>
                            <Droppable droppableId="endpoints" isDropDisabled={routerLayout !== 'list' || updateRouter.isPending}>
                                {(dropProvided) => (
                                    <div
                                        ref={dropProvided.innerRef}
                                        {...dropProvided.droppableProps}
                                        className={
                                            routerLayout === 'grid'
                                                ? 'grid gap-3 p-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,17rem),1fr))]'
                                                : 'divide-y divide-border/60'
                                        }
                                    >
                            {endpoints.map((endpoint, endpointIndex) => {
                                const label = endpointLabel(endpoint, options);
                                const optionChannel = options.find((item) => item.id === endpoint.channel_id);
                                const optionKey = endpointOptionKey(endpoint, options);
                                const firstModelName = optionKey?.models?.[0] ?? optionChannel?.models[0];
                                const baseModel = firstModelName ? modelPriceByName.get(firstModelName) : undefined;
                                const pricing = effectivePricingRule(endpoint, optionChannel);
                                const current = router.preferred_endpoint_id === endpoint.id;
                                const isPrimary = router.mode === 'manual' && current;
                                const manualDisplayRank = manualDisplayRanks.get(endpoint.id) ?? 0;
                                const showManualRank = router.mode === 'manual' && endpoint.enabled && manualDisplayRank > 1;
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
                                const percent = endpoint.enabled && totalWeight > 0
                                    ? Math.round((Math.max(1, endpoint.weight || 1) / totalWeight) * 100)
                                    : 0;
                                const isGrid = routerLayout === 'grid';
                                const dragDisabledReason = isGrid
                                    ? '切换到列表视图调整端点顺序'
                                    : !endpoint.enabled
                                        ? '停用端点不参与排序'
                                        : updateRouter.isPending
                                            ? '正在保存端点变更'
                                            : undefined;
                                const dragTitle = dragDisabledReason
                                    ?? (router.mode === 'weighted' ? '拖动调整显示顺序' : '拖动调整主备顺序');

                                return (
                                    <Draggable
                                        key={endpoint.id}
                                        draggableId={`endpoint-${endpoint.id}`}
                                        index={endpointIndex}
                                        isDragDisabled={!!dragDisabledReason}
                                    >
                                        {(dragProvided, dragSnapshot) => (
                                    <div
                                        ref={dragProvided.innerRef}
                                        {...dragProvided.draggableProps}
                                        className={cn(
                                            isGrid
                                                ? 'flex h-full min-h-0 flex-col rounded-xl border border-border/70 p-4 transition-colors'
                                                : 'px-4 py-3 transition-colors',
                                            isPrimary ? 'bg-primary/[0.04]' : 'bg-background/70',
                                            duplicate && 'bg-amber-500/[0.06]',
                                            invalid && 'bg-destructive/[0.05]',
                                            dragSnapshot.isDragging && 'relative z-20 border-primary/40 bg-background shadow-lg ring-2 ring-primary/30'
                                        )}
                                    >
                                        <div className={cn('grid min-w-0 gap-3', isGrid && 'h-full')}>
                                            <div className="min-w-0">
                                                <div className="grid min-w-0 grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center justify-start gap-2">
                                                    <span className={cn('size-2 rounded-full', statusClass(endpoint.status))} />
                                                    <span
                                                        {...(dragProvided.dragHandleProps ?? {})}
                                                        title={dragTitle}
                                                        className={cn(
                                                            'inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground active:scale-95',
                                                            dragDisabledReason ? 'cursor-not-allowed opacity-50' : 'cursor-grab active:cursor-grabbing',
                                                            dragSnapshot.isDragging && 'bg-primary/10 text-primary'
                                                        )}
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
                                                        <label
                                                            className="flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-muted-foreground"
                                                            title={endpoint.enabled ? '停用端点' : '启用端点'}
                                                        >
                                                            <Switch
                                                                checked={endpoint.enabled}
                                                                onCheckedChange={(checked) => updateEndpoint(endpoint, { enabled: checked })}
                                                                disabled={updateRouter.isPending}
                                                            />
                                                            <span className="whitespace-nowrap">{endpoint.enabled ? '启用' : '停用'}</span>
                                                        </label>
                                                        {isPrimary ? <Badge>主端点</Badge> : null}
                                                        {showManualRank ? <Badge variant="outline">#{manualDisplayRank}</Badge> : null}
                                                        {!endpoint.enabled && router.mode === 'weighted' ? <Badge variant="outline">不参与分流</Badge> : null}
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
                                                ) : endpoint.enabled ? (
                                                    <Badge variant="outline">预计占比 {percent}%</Badge>
                                                ) : (
                                                    <Badge variant="outline">不参与分流</Badge>
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
                                        )}
                                    </Draggable>
                                );
                            })}
                                        {dropProvided.placeholder}
                                    </div>
                                )}
                            </Droppable>
                        </DragDropContext>
                    )}
                </div>
            </div>
        </div>
    );
}

export function Router() {
    const createRouter = useCreateRouter();
    const reorderRouters = useReorderRouters();
    const switchEndpoint = useSwitchRouterEndpoint();
    const deleteRouter = useDeleteRouter();
    const createAPIKey = useCreateAPIKey();
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [copyingRouteId, setCopyingRouteId] = useState<number | null>(null);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [keyword, setKeyword] = useState('');
    const [mode, setMode] = useState<string>('all');
    const { data: routeList = [], error, isLoading, refetch } = useRouterList();
    const normalizedKeyword = keyword.trim().toLowerCase();
    const filteredRouters = useMemo(() => routeList.filter((router) => {
        if (normalizedKeyword && !router.name.toLowerCase().includes(normalizedKeyword)) return false;
        if (mode !== 'all' && router.mode !== mode) return false;
        return true;
    }), [routeList, normalizedKeyword, mode]);
    const totalPages = Math.max(1, Math.ceil(filteredRouters.length / pageSize));
    const currentPage = Math.min(page, totalPages);
    const routers = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filteredRouters.slice(start, start + pageSize);
    }, [filteredRouters, currentPage, pageSize]);

    const selected = selectedId && routeList.some((router) => router.id === selectedId) ? selectedId : routers[0]?.id ?? null;
    const defaultCreateName = `路由 ${routeList.length + 1}`;
    const canReorderRoutes = normalizedKeyword === '' && mode === 'all' && routeList.length > 1 && !reorderRouters.isPending;

    const create = (data: RouteProfileCreateRequest, options: {
        preferredEndpointKey?: string;
        successMessage?: string;
        errorMessage?: string;
        warnPreferredEndpointMissing?: boolean;
        onSettled?: () => void;
    }) => {
        createRouter.mutate(data, {
            onSuccess: (router) => {
                const preferredEndpoint = router.endpoints?.find((endpoint) => options.preferredEndpointKey === endpointKey(endpoint));
                if (preferredEndpoint && router.preferred_endpoint_id !== preferredEndpoint.id) {
                    // Creation returns real endpoint IDs, so set the preferred endpoint after the route exists.
                    switchEndpoint.mutate(
                        { router_id: router.id, endpoint_id: preferredEndpoint.id },
                        { onError: (error) => toast.error('主端点设置失败', { description: String(error) }) }
                    );
                } else if (options.warnPreferredEndpointMissing && options.preferredEndpointKey) {
                    toast.warning('主端点未精确继承', { description: '新路由已创建，请在右侧确认主端点。' });
                }
                toast.success(options.successMessage ?? '路由已创建');
                setSelectedId(router.id);
                setCreateDialogOpen(false);
            },
            onError: (error) => toast.error(options.errorMessage ?? '创建路由失败', { description: String(error) }),
            onSettled: options.onSettled,
        });
    };

    const duplicateRoute = (router: RouteProfile) => {
        if (createRouter.isPending) return;
        const name = duplicateRouteName(router.name, routeList.length > 0 ? routeList : routers);
        const request = routeToCreateRequest(router, name);
        setCopyingRouteId(router.id);
        create(request.data, {
            preferredEndpointKey: request.preferredEndpointKey,
            successMessage: `已复制路由：${name}`,
            errorMessage: '路由复制失败',
            warnPreferredEndpointMissing: true,
            onSettled: () => setCopyingRouteId(null),
        });
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

    const handleRouterDragEnd = (result: DropResult) => {
        const { destination, draggableId } = result;
        if (!destination || !canReorderRoutes) return;
        if (destination.droppableId !== 'routers') return;

        const sourceId = Number(draggableId.replace('router-', ''));
        const target = routers[destination.index];
        if (!Number.isFinite(sourceId) || !target || sourceId === target.id) return;

        const sourceIndex = routeList.findIndex((item) => item.id === sourceId);
        const targetIndex = routeList.findIndex((item) => item.id === target.id);
        if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;

        const nextRoutes = reorderByIndex(routeList, sourceIndex, targetIndex);
        reorderRouters.mutate(
            { ids: nextRoutes.map((item) => item.id) },
            {
                onSuccess: () => toast.success('路由顺序已保存'),
                onError: (error) => toast.error('路由排序失败', { description: String(error) }),
            }
        );
    };

    return (
        <>
        {createDialogOpen ? (
            <CreateRouterDialog
                open={createDialogOpen}
                onOpenChange={setCreateDialogOpen}
                defaultName={defaultCreateName}
                onCreate={create}
                isPending={createRouter.isPending}
            />
        ) : null}
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
                        <Button className="h-10 min-w-[6.5rem] rounded-lg px-3 shadow-sm" onClick={() => setCreateDialogOpen(true)} disabled={createRouter.isPending}>
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
                            <DragDropContext onDragEnd={handleRouterDragEnd}>
                                <Droppable droppableId="routers" isDropDisabled={!canReorderRoutes}>
                                    {(dropProvided) => (
                            <div ref={dropProvided.innerRef} {...dropProvided.droppableProps} className="grid gap-2 p-3">
                                {routers.map((router, routerIndex) => {
                                    const boundKey = router.bound_api_key;
                                    const boundKeyCount = router.bound_api_key_count ?? 0;
                                    const dragDisabledReason = canReorderRoutes
                                        ? undefined
                                        : normalizedKeyword !== '' || mode !== 'all'
                                            ? '仅在未搜索且未筛选时可拖动排序'
                                            : reorderRouters.isPending
                                                ? '正在保存路由顺序'
                                                : '至少需要两个路由才能排序';
                                    return (
                                        <Draggable
                                            key={router.id}
                                            draggableId={`router-${router.id}`}
                                            index={routerIndex}
                                            isDragDisabled={!canReorderRoutes}
                                        >
                                            {(dragProvided, dragSnapshot) => (
                                        <div
                                            ref={dragProvided.innerRef}
                                            {...dragProvided.draggableProps}
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
                                                'relative w-full cursor-pointer rounded-xl border px-3 py-3 text-left shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                                selected === router.id ? 'border-primary/35 bg-primary/[0.05] shadow-primary/5' : 'border-border/70 bg-background/80 hover:border-primary/25 hover:bg-muted/30',
                                                dragSnapshot.isDragging && 'z-20 border-primary/40 bg-background shadow-lg ring-2 ring-primary/30'
                                            )}
                                        >
                                            <span
                                                {...(dragProvided.dragHandleProps ?? {})}
                                                title={dragDisabledReason ?? '拖动调整路由顺序'}
                                                onClick={(e) => e.stopPropagation()}
                                                className={cn(
                                                    'absolute left-2 top-2 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground active:scale-95',
                                                    canReorderRoutes ? 'cursor-grab active:cursor-grabbing' : 'cursor-not-allowed opacity-45',
                                                    dragSnapshot.isDragging && 'bg-primary/10 text-primary'
                                                )}
                                            >
                                                <GripVertical className="size-4" />
                                                <span className="sr-only">拖动调整路由顺序</span>
                                            </span>
                                            <button
                                                type="button"
                                                aria-label="复制路由"
                                                title="复制路由"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    duplicateRoute(router);
                                                }}
                                                disabled={createRouter.isPending || copyingRouteId === router.id}
                                                className="absolute right-10 top-2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                {copyingRouteId === router.id && createRouter.isPending ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />}
                                            </button>
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
                                                                    onSuccess: () => {
                                                                        toast.success('路由已删除');
                                                                        if (selected === router.id) {
                                                                            const remaining = routers.filter((item) => item.id !== router.id);
                                                                            setSelectedId(remaining[0]?.id ?? null);
                                                                        }
                                                                    },
                                                                    onError: (error) => toast.error('删除失败', { description: String(error) }),
                                                                })
                                                            }
                                                        >
                                                            删除路由
                                                        </AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                            <div className="flex items-center justify-between gap-2 pl-8 pr-14">
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
                                            )}
                                        </Draggable>
                                    );
                                })}
                                {dropProvided.placeholder}
                            </div>
                                    )}
                                </Droppable>
                            </DragDropContext>
                        )}
                    </div>
                    <AdminPagination
                        page={page}
                        pageSize={pageSize}
                        total={filteredRouters.length}
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
                    <div className="flex h-full items-center justify-center text-muted-foreground">请先创建或选择一个路由进行编辑。</div>
                )}
            </div>
        </div>
        </>
    );
}
