'use client';

import { useMemo, useState } from 'react';
import { Cable, Check, Loader2, Plus, Trash2, X, TestTube2 } from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/common/Toast';
import { cn } from '@/lib/utils';

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

function AddEndpointForm({
    options,
    onAdd,
}: {
    options: RouteOptionChannel[];
    onAdd: (endpoint: RouteEndpointAddRequest) => void;
}) {
    const [channelId, setChannelId] = useState<number>(options[0]?.id ?? 0);
    const channel = options.find((item) => item.id === channelId);
    const [keyId, setKeyId] = useState<number>(channel?.keys[0]?.id ?? 0);
    const [mapping, setMapping] = useState('');

    const keys = channel?.keys ?? [];
    const selectedKey = keys.find((item) => item.id === keyId);

    const submit = () => {
        if (!channel || !selectedKey) return;
        onAdd({
            name: `${channel.name} / ${selectedKey.remark || selectedKey.masked_key}`,
            channel_id: channel.id,
            channel_key_id: selectedKey.id,
            priority: 1,
            weight: 1,
            enabled: true,
            model_mapping: mapping.trim(),
        });
    };

    return (
        <div className="grid gap-3 rounded-xl border border-border bg-muted/20 p-3">
            <div className="grid gap-2 md:grid-cols-2">
                <select
                    value={channelId}
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
                    value={keyId}
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
            <Input
                value={mapping}
                onChange={(e) => setMapping(e.target.value)}
                placeholder='可选模型映射 JSON，例如 {"claude":"provider/claude"}'
                className="rounded-xl"
            />
            <Button type="button" onClick={submit} disabled={!channel || !selectedKey} className="rounded-xl">
                <Plus className="size-4 mr-2" />
                添加端点
            </Button>
        </div>
    );
}

function RouterDetail({ routerId }: { routerId: number }) {
    const { data: router } = useRouterDetail(routerId);
    const { data: options = [] } = useRouterOptions();
    const updateRouter = useUpdateRouter();
    const switchEndpoint = useSwitchRouterEndpoint();
    const testEndpoint = useTestRouterEndpoint();

    const endpoints = useMemo(() => [...(router?.endpoints ?? [])].sort((a, b) => a.priority - b.priority), [router]);

    if (!router) {
        return (
            <div className="flex h-full items-center justify-center text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
            </div>
        );
    }

    const update = (patch: Partial<RouteProfile>) => {
        updateRouter.mutate({ id: router.id, ...patch }, {
            onSuccess: () => toast.success('路由已保存'),
            onError: (error) => toast.error('路由保存失败', { description: String(error) }),
        });
    };

    const updateEndpoint = (endpoint: RouteEndpoint, patch: Partial<RouteEndpoint>) => {
        updateRouter.mutate({
            id: router.id,
            endpoints_to_update: [{ id: endpoint.id, ...patch }],
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
        }, { onSuccess: () => toast.success('端点已添加') });
    };

    return (
        <div className="flex h-full min-h-0 flex-col gap-4">
            <div className="rounded-2xl border border-border bg-card p-4">
                <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-center">
                    <Input
                        value={router.name}
                        onChange={(e) => update({ name: e.target.value })}
                        className="rounded-xl font-semibold"
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

            <AddEndpointForm options={options} onAdd={addEndpoint} />

            <div className="min-h-0 flex-1 overflow-auto space-y-3 pr-1">
                {endpoints.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                        添加端点后此路由才能使用。
                    </div>
                ) : endpoints.map((endpoint) => {
                    const label = endpointLabel(endpoint, options);
                    const current = router.preferred_endpoint_id === endpoint.id;
                    const invalid = !label.keyEnabled;
                    const totalWeight = endpoints.reduce((sum, item) => sum + Math.max(1, item.weight || 1), 0);
                    const percent = Math.round((Math.max(1, endpoint.weight || 1) / totalWeight) * 100);
                    return (
                        <div
                            key={endpoint.id}
                            className={cn(
                                'rounded-2xl border bg-card p-4 transition-colors',
                                current ? 'border-primary/60' : 'border-border',
                                invalid && 'border-destructive/40'
                            )}
                        >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className={cn('size-2 rounded-full', statusClass(endpoint.status))} />
                                        <Input
                                            value={endpoint.name}
                                            onChange={(e) => updateEndpoint(endpoint, { name: e.target.value })}
                                            className="h-8 max-w-[360px] rounded-lg border-0 bg-transparent px-1 font-semibold shadow-none"
                                        />
                                        {current ? <Badge>当前</Badge> : null}
                                    </div>
                                    <div className="mt-1 text-xs text-muted-foreground">
                                        {label.channelName} / {label.keyName}
                                        {invalid ? <span className="ml-2 text-destructive">上游密钥无效</span> : null}
                                    </div>
                                    {endpoint.last_error ? (
                                        <div className="mt-2 text-xs text-destructive line-clamp-2">{endpoint.last_error}</div>
                                    ) : null}
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button variant="secondary" size="sm" onClick={() => reorder(endpoint, -1)}>上移</Button>
                                    <Button variant="secondary" size="sm" onClick={() => reorder(endpoint, 1)}>下移</Button>
                                    <Button
                                        variant={current ? 'secondary' : 'default'}
                                        size="sm"
                                        disabled={current || invalid || endpoint.status === 'error'}
                                        onClick={() => switchEndpoint.mutate({ router_id: router.id, endpoint_id: endpoint.id }, {
                                            onSuccess: () => toast.success(`已切换到 ${endpoint.name}`),
                                        })}
                                    >
                                        <Check className="size-4 mr-1" />
                                        {current ? '使用中' : '切换'}
                                    </Button>
                                    <Button variant="secondary" size="sm" onClick={() => testEndpoint.mutate(endpoint.id)}>
                                        <TestTube2 className="size-4" />
                                    </Button>
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        onClick={() => updateRouter.mutate({ id: router.id, endpoints_to_delete: [endpoint.id] })}
                                    >
                                        <Trash2 className="size-4" />
                                    </Button>
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
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export function Router() {
    const { data: routers = [], error, isLoading } = useRouterList();
    const createRouter = useCreateRouter();
    const deleteRouter = useDeleteRouter();
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
                    ) : routers.map((router) => (
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
                                {router.endpoints?.length ?? 0} 个端点 / {router.bound_api_key_count ?? 0} 个密钥
                            </div>
                            <div className="mt-2 flex justify-end">
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        deleteRouter.mutate(router.id, {
                                            onError: (error) => toast.error('删除失败', { description: String(error) }),
                                        });
                                    }}
                                    className="rounded-lg p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                >
                                    <X className="size-4" />
                                </button>
                            </div>
                        </div>
                    ))}
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
