'use client';

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Cable, Check, KeyRound, Loader2, Plus, Trash2, X, TestTube2 } from 'lucide-react';
import {
    useCreateRouter,
    useDeleteRouter,
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
} from '@/api/endpoints/router';
import { useCreateAPIKey } from '@/api/endpoints/apikey';
import { useModelList } from '@/api/endpoints/model';
import { DEFAULT_PRICING_RULE, normalizePricingRule, type PricingRule } from '@/api/endpoints/channel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
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
import { toast } from '@/components/common/Toast';
import { CopyIconButton } from '@/components/common/CopyButton';
import { cn } from '@/lib/utils';
import type { ApiError } from '@/api/types';

function statusClass(status: string) {
    if (status === 'normal') return 'bg-emerald-500';
    if (status === 'error') return 'bg-destructive';
    return 'bg-muted-foreground';
}

function routeModeLabel(mode: RouteMode) {
    if (mode === 'manual') return '手动';
    if (mode === 'weighted') return '加权';
    return mode;
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
}: {
    value: string;
    onSave: (next: string, reset: () => void) => void;
    className?: string;
    placeholder?: string;
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
            className={className}
        />
    );
}

function AddEndpointForm({
    options,
    endpoints,
    onAdd,
}: {
    options: RouteOptionChannel[];
    endpoints: RouteEndpoint[];
    onAdd: (endpoint: RouteEndpointAddRequest) => void;
}) {
    const [channelId, setChannelId] = useState<number>(options[0]?.id ?? 0);

    const channel = options.find((item) => item.id === channelId) ?? options[0];
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
    };

    return (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-4">
            <SectionTitle
                title="添加候选端点"
                description="从已有供应商和密钥中选择一条上游路径，加入当前路由的端点池。"
            />
            <div className="grid gap-3">
                <div className="grid gap-2 md:grid-cols-2">
                    <select
                        value={channel?.id ?? 0}
                        onChange={(e) => {
                            const nextChannel = options.find((item) => item.id === Number(e.target.value));
                            setChannelId(nextChannel?.id ?? 0);
                            setKeyId(nextChannel?.keys[0]?.id ?? 0);
                        }}
                        className="h-10 rounded-xl border border-border bg-background px-3 text-sm"
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
                        className="h-10 rounded-xl border border-border bg-background px-3 text-sm"
                    >
                        {keys.map((item) => (
                            <option key={item.id} value={item.id}>
                                {item.remark || '无备注'} ({item.masked_key})
                            </option>
                        ))}
                    </select>
                </div>
                {duplicate ? (
                    <div className="text-xs text-destructive">该端点已在此路由中。</div>
                ) : null}
                <Button type="button" onClick={submit} disabled={!channel || !selectedKey || duplicate} className="rounded-xl">
                    <Plus className="size-4 mr-2" />
                    添加端点
                </Button>
            </div>
        </div>
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

function RouterDetail({ routerId }: { routerId: number }) {
    const { data: router } = useRouterDetail(routerId);
    const { data: options = [] } = useRouterOptions();
    const { data: models = [] } = useModelList();
    const updateRouter = useUpdateRouter();
    const switchEndpoint = useSwitchRouterEndpoint();
    const testEndpoint = useTestRouterEndpoint();

    const endpoints = useMemo(() => [...(router?.endpoints ?? [])].sort((a, b) => a.priority - b.priority), [router]);
    const modelPriceByName = useMemo(() => new Map(models.map((item) => [item.name, item])), [models]);
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
        updateRouter.mutate({ id: router.id, ...patch }, {
            onError: (error) => toast.error('路由保存失败', { description: String(error) }),
        });
    };

    const updateEndpoint = (endpoint: RouteEndpoint, patch: Partial<RouteEndpoint>, options?: { onError?: () => void }) => {
        updateRouter.mutate({
            id: router.id,
            endpoints_to_update: [{ id: endpoint.id, ...patch }],
        }, {
            onError: (error) => {
                options?.onError?.();
                toast.error('端点保存失败', { description: String(error) });
            },
        });
    };

    const reorder = (endpoint: RouteEndpoint, dir: -1 | 1) => {
        const idx = endpoints.findIndex((item) => item.id === endpoint.id);
        const swap = endpoints[idx + dir];
        if (!swap) return;
        updateRouter.mutate({
            id: router.id,
            endpoints_to_update: [
                { id: endpoint.id, priority: swap.priority },
                { id: swap.id, priority: endpoint.priority },
            ],
        });
    };

    const addEndpoint = (endpoint: RouteEndpointAddRequest) => {
        const maxPriority = endpoints.reduce((max, item) => Math.max(max, item.priority), 0);
        updateRouter.mutate({
            id: router.id,
            endpoints_to_add: [{ ...endpoint, priority: maxPriority + 1 }],
        }, {
            onSuccess: () => toast.success('端点已添加'),
            onError: (error) => toast.error('端点添加失败', { description: String(error) }),
        });
    };

    return (
        <div className="flex h-full min-h-0 flex-col gap-4">
            <div className="rounded-2xl border border-border bg-card p-4">
                <SectionTitle
                    title="路由策略"
                    description="定义这条路由的名称、分配模式，以及上游失败后是否继续尝试其他端点。"
                />
                <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-center">
                    <EditableName
                        value={router.name}
                        onSave={(name, reset) => updateRouter.mutate({ id: router.id, name }, {
                            onError: (error) => {
                                reset();
                                toast.error('路由保存失败', { description: String(error) });
                            },
                        })}
                        className="rounded-xl font-semibold"
                        placeholder="路由名称"
                    />
                    <select
                        value={router.mode}
                        onChange={(e) => update({ mode: e.target.value as RouteMode })}
                        className="h-10 rounded-xl border border-border bg-background px-3 text-sm"
                    >
                        <option value="manual">手动</option>
                        <option value="weighted">加权</option>
                    </select>
                    <label className="flex items-center gap-2 text-sm">
                        <Switch checked={router.failover_enabled} onCheckedChange={(checked) => update({ failover_enabled: checked })} />
                        故障转移
                    </label>
                </div>
            </div>

            <AddEndpointForm options={options} endpoints={endpoints} onAdd={addEndpoint} />

            <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-border bg-card p-4">
                <SectionTitle
                    title="端点池"
                    description={router.mode === 'weighted'
                        ? '加权模式会按权重比例选择已启用端点。'
                        : '手动模式优先使用当前端点；开启故障转移后，失败时继续尝试后续端点。'}
                />
                <div className="min-h-0 flex-1 overflow-auto space-y-3 pr-1">
                    {endpoints.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                            添加端点后此路由才能使用。
                        </div>
                    ) : endpoints.map((endpoint) => {
                        const label = endpointLabel(endpoint, options);
                        const optionChannel = options.find((item) => item.id === endpoint.channel_id);
                        const optionKey = endpointOptionKey(endpoint, options);
                        const firstModelName = optionChannel?.models[0];
                        const baseModel = firstModelName ? modelPriceByName.get(firstModelName) : undefined;
                        const pricing = effectivePricingRule(endpoint, optionChannel);
                        const current = router.preferred_endpoint_id === endpoint.id;
                        const invalid = !label.keyEnabled;
                        const duplicate = duplicateEndpointIds.has(endpoint.id);
                        const totalWeight = endpoints.reduce((sum, item) => sum + Math.max(1, item.weight || 1), 0);
                        const percent = Math.round((Math.max(1, endpoint.weight || 1) / totalWeight) * 100);
                        return (
                            <div
                                key={endpoint.id}
                                className={cn(
                                    'rounded-2xl border bg-background p-4 transition-colors',
                                    current ? 'border-primary/60' : 'border-border',
                                    duplicate && 'border-amber-500/70',
                                    invalid && 'border-destructive/40'
                                )}
                            >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className={cn('size-2 rounded-full', statusClass(endpoint.status))} />
                                            <EditableName
                                                value={endpoint.name}
                                                onSave={(name, reset) => updateEndpoint(endpoint, { name }, { onError: reset })}
                                                className="h-8 max-w-[360px] rounded-lg border-0 bg-transparent px-1 font-semibold shadow-none"
                                            />
                                            {current ? <Badge>{router.mode === 'weighted' ? '已选' : '当前'}</Badge> : null}
                                            {duplicate ? <Badge variant="outline" className="border-amber-500/70 text-amber-700">重复</Badge> : null}
                                        </div>
                                        <div className="mt-1 text-xs text-muted-foreground">
                                            {label.channelName} / {label.keyName}
                                            {invalid ? <span className="ml-2 text-destructive">上游密钥无效</span> : null}
                                        </div>
                                        <div className="mt-1 text-xs text-muted-foreground">
                                            {optionKey?.pricing_rule?.enabled
                                                ? `密钥倍率 ${optionKey.pricing_rule.multiplier || 1}x`
                                                : '密钥未单独定价，将继承供应商默认或系统默认'}
                                        </div>
                                        {duplicate ? (
                                            <div className="mt-2 text-xs text-amber-700">同一供应商和密钥已被重复添加，请删除多余端点。</div>
                                        ) : null}
                                        {endpoint.last_error ? (
                                            <div className="mt-2 text-xs text-destructive line-clamp-2">{endpoint.last_error}</div>
                                        ) : null}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button variant="secondary" size="sm" onClick={() => reorder(endpoint, -1)}>上移</Button>
                                        <Button variant="secondary" size="sm" onClick={() => reorder(endpoint, 1)}>下移</Button>
                                        {router.mode === 'manual' ? (
                                            <Button
                                                variant={current ? 'secondary' : 'default'}
                                                size="sm"
                                                disabled={current || invalid || endpoint.status === 'error'}
                                                onClick={() => switchEndpoint.mutate({ router_id: router.id, endpoint_id: endpoint.id }, {
                                                    onSuccess: () => toast.success(`已切换到 ${endpoint.name}`),
                                                })}
                                            >
                                                <Check className="size-4 mr-1" />
                                                {current ? '当前使用' : '设为当前'}
                                            </Button>
                                        ) : (
                                            <Badge variant="outline">权重 {percent}%</Badge>
                                        )}
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            title="测试端点"
                                            onClick={() => testEndpoint.mutate(endpoint.id, {
                                                onSuccess: (result) => {
                                                    if (result.success) {
                                                        toast.success('端点测试成功', { description: `${result.latency_ms}ms` });
                                                    } else {
                                                        toast.error('端点测试失败', { description: result.error });
                                                    }
                                                },
                                                onError: (error) => toast.error('端点测试失败', { description: String(error) }),
                                            })}
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
                                                        onClick={() => updateRouter.mutate({ id: router.id, endpoints_to_delete: [endpoint.id] }, {
                                                            onError: (error) => toast.error('删除失败', { description: String(error) }),
                                                        })}
                                                    >
                                                        删除端点
                                                    </AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </div>
                                </div>
                                <div className="mt-3 grid gap-3 md:grid-cols-3">
                                    <label className="text-xs text-muted-foreground">
                                        优先级
                                        <Input
                                            type="number"
                                            value={endpoint.priority}
                                            onChange={(e) => updateEndpoint(endpoint, { priority: Number(e.target.value) || 1 })}
                                            className="mt-1 rounded-xl"
                                        />
                                    </label>
                                    <label className="text-xs text-muted-foreground">
                                        权重 {router.mode === 'weighted' ? `(${percent}%)` : ''}
                                        <Input
                                            type="number"
                                            value={endpoint.weight}
                                            onChange={(e) => updateEndpoint(endpoint, { weight: Number(e.target.value) || 1 })}
                                            className="mt-1 rounded-xl"
                                        />
                                    </label>
                                    <label className="flex items-center gap-2 pt-5 text-sm">
                                        <Switch checked={endpoint.enabled} onCheckedChange={(checked) => updateEndpoint(endpoint, { enabled: checked })} />
                                        启用
                                    </label>
                                </div>
                                <PricingRulePreview
                                    source={pricing.source}
                                    preview={pricingPreviewText(pricing.rule, baseModel)}
                                />
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

export function Router() {
    const { data: routers = [], error, isLoading } = useRouterList();
    const createRouter = useCreateRouter();
    const deleteRouter = useDeleteRouter();
    const createAPIKey = useCreateAPIKey();
    const [selectedId, setSelectedId] = useState<number | null>(null);

    const selected = selectedId ?? routers[0]?.id ?? null;

    const create = () => {
        createRouter.mutate({
            name: `路由 ${routers.length + 1}`,
            mode: 'manual',
            failover_enabled: true,
        }, {
            onSuccess: (router) => {
                toast.success('路由已创建');
                setSelectedId(router.id);
            },
            onError: (error) => toast.error('创建路由失败', { description: String(error) }),
        });
    };

    const createBoundAPIKey = (router: RouteProfile) => {
        createAPIKey.mutate({
            name: `${router.name} 令牌`,
            enabled: true,
            router_id: router.id,
        }, {
            onSuccess: () => toast.success('令牌已创建'),
            onError: (error) => {
                const msg = (error as unknown as ApiError)?.message;
                toast.error('令牌创建失败', { description: msg || String(error) });
            },
        });
    };

    return (
        <div className="grid h-full min-h-0 gap-4 md:grid-cols-[300px_1fr]">
            <div className="flex min-h-0 flex-col rounded-2xl border border-border bg-card p-4">
                <div className="mb-3 flex items-center justify-between">
                    <h2 className="flex items-center gap-2 text-lg font-bold">
                        <Cable className="size-5" />
                        路由
                    </h2>
                    <Button size="sm" onClick={create} disabled={createRouter.isPending}>
                        <Plus className="size-4" />
                    </Button>
                </div>
                <div className="min-h-0 flex-1 overflow-auto space-y-2">
                    {isLoading ? (
                        <div className="flex justify-center p-6"><Loader2 className="size-5 animate-spin" /></div>
                    ) : error ? (
                        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                            路由加载失败：{String(error)}
                        </div>
                    ) : routers.length === 0 ? (
                        <div className="p-6 text-center text-sm text-muted-foreground">暂无路由。</div>
                    ) : routers.map((router) => {
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
                                    'w-full cursor-pointer rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                    selected === router.id ? 'border-primary bg-primary/5' : 'border-border bg-muted/20 hover:bg-muted/40'
                                )}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="truncate text-sm font-semibold">{router.name}</span>
                                    <Badge variant="outline">{routeModeLabel(router.mode)}</Badge>
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                    {router.endpoints?.length ?? 0} 个端点 / {boundKeyCount} 个密钥
                                </div>
                                {boundKey ? (
                                    <div className="mt-3 rounded-lg border border-border/70 bg-background/80 p-2">
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
                                <div className="mt-2 flex justify-end">
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            <button
                                                type="button"
                                                onClick={(e) => e.stopPropagation()}
                                                className="rounded-lg p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
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
                                                    onClick={() => deleteRouter.mutate(router.id, {
                                                        onError: (error) => toast.error('删除失败', { description: String(error) }),
                                                    })}
                                                >
                                                    删除路由
                                                </AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
            <div className="min-h-0 rounded-2xl border border-border bg-background p-4">
                {selected ? <RouterDetail routerId={selected} /> : (
                    <div className="flex h-full items-center justify-center text-muted-foreground">创建一个路由后开始使用。</div>
                )}
            </div>
        </div>
    );
}
