import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';
import type { Channel, ChannelType, PricingRule } from './channel';
import type { APIKey } from './apikey';

export type RouteMode = 'manual' | 'weighted';
export type RouteEndpointStatus = 'unknown' | 'normal' | 'error';

export interface RouteEndpoint {
    id: number;
    router_id: number;
    name: string;
    channel_id: number;
    channel_key_id: number;
    priority: number;
    weight: number;
    enabled: boolean;
    status: RouteEndpointStatus;
    last_checked_at?: number;
    last_error?: string;
    use_pricing_override: boolean;
    pricing_rule_override: PricingRule;
}

export interface RouteProfile {
    id: number;
    name: string;
    mode: RouteMode;
    preferred_endpoint_id: number;
    failover_enabled: boolean;
    endpoints?: RouteEndpoint[];
    bound_api_key_count?: number;
    bound_api_key?: APIKey;
    created_at?: number;
    updated_at?: number;
}

export interface RouteOptionChannelKey {
    id: number;
    enabled: boolean;
    remark: string;
    masked_key: string;
    type?: ChannelType | null;
    effective_type: ChannelType;
    models: string[];
    models_synced_at: number;
    models_sync_error: string;
    pricing_rule: PricingRule;
}

export interface RouteOptionChannel {
    id: number;
    name: string;
    enabled: boolean;
    models: string[];
    keys: RouteOptionChannelKey[];
    pricing_rule: PricingRule;
}

export type RouteEndpointAddRequest = Omit<RouteEndpoint, 'id' | 'router_id' | 'status' | 'last_checked_at' | 'last_error'>;

export interface RouteProfileUpdateRequest {
    id: number;
    name?: string;
    mode?: RouteMode;
    preferred_endpoint_id?: number;
    failover_enabled?: boolean;
    endpoints_to_add?: RouteEndpointAddRequest[];
    endpoints_to_update?: Array<Partial<RouteEndpoint> & { id: number }>;
    endpoints_to_delete?: number[];
}

const routerListQueryKey = ['routers', 'list'] as const;
const routerDetailQueryKey = (id: number) => ['routers', 'detail', id] as const;

type RouterCacheSnapshot = {
    list?: RouteProfile[];
    detail?: RouteProfile;
};

function mergeRoute(router: RouteProfile, next: RouteProfile) {
    return { ...router, ...next };
}

function applyRouteCache(queryClient: QueryClient, router: RouteProfile) {
    queryClient.setQueryData<RouteProfile>(routerDetailQueryKey(router.id), router);
    queryClient.setQueryData<RouteProfile[]>(routerListQueryKey, (current) =>
        current?.map((item) => item.id === router.id ? mergeRoute(item, router) : item)
    );
}

function patchRouteCache(
    queryClient: QueryClient,
    routerID: number,
    patcher: (router: RouteProfile) => RouteProfile
) {
    queryClient.setQueryData<RouteProfile>(routerDetailQueryKey(routerID), (current) =>
        current ? patcher(current) : current
    );
    queryClient.setQueryData<RouteProfile[]>(routerListQueryKey, (current) =>
        current?.map((item) => item.id === routerID ? patcher(item) : item)
    );
}

function restoreRouteCache(queryClient: QueryClient, routerID: number, snapshot?: RouterCacheSnapshot) {
    if (!snapshot) return;
    queryClient.setQueryData(routerListQueryKey, snapshot.list);
    queryClient.setQueryData(routerDetailQueryKey(routerID), snapshot.detail);
}

function routeCacheSnapshot(queryClient: QueryClient, routerID: number): RouterCacheSnapshot {
    return {
        list: queryClient.getQueryData<RouteProfile[]>(routerListQueryKey),
        detail: queryClient.getQueryData<RouteProfile>(routerDetailQueryKey(routerID)),
    };
}

function canOptimisticallyUpdateRoute(data: RouteProfileUpdateRequest) {
    return !data.endpoints_to_add?.length && !data.endpoints_to_delete?.length;
}

function applyRouteUpdate(router: RouteProfile, data: RouteProfileUpdateRequest): RouteProfile {
    const next: RouteProfile = { ...router };
    if (data.name !== undefined) next.name = data.name;
    if (data.mode !== undefined) next.mode = data.mode;
    if (data.preferred_endpoint_id !== undefined) next.preferred_endpoint_id = data.preferred_endpoint_id;
    if (data.failover_enabled !== undefined) next.failover_enabled = data.failover_enabled;
    if (data.endpoints_to_update?.length && router.endpoints) {
        const updates = new Map(data.endpoints_to_update.map((endpoint) => [endpoint.id, endpoint]));
        next.endpoints = router.endpoints.map((endpoint) => {
            const update = updates.get(endpoint.id);
            return update ? { ...endpoint, ...update } : endpoint;
        });
    }
    return next;
}

export function useRouterList() {
    return useQuery({
        queryKey: routerListQueryKey,
        queryFn: () => apiClient.get<RouteProfile[]>('/api/v1/router/list'),
        refetchInterval: 30000,
    });
}

export function useRouterDetail(id?: number) {
    return useQuery({
        queryKey: ['routers', 'detail', id],
        queryFn: () => apiClient.get<RouteProfile>(`/api/v1/router/${id}`),
        enabled: !!id,
        refetchInterval: 30000,
    });
}

export function useRouterOptions() {
    return useQuery({
        queryKey: ['routers', 'options'],
        queryFn: () => apiClient.get<RouteOptionChannel[]>('/api/v1/router/options'),
        refetchInterval: 30000,
    });
}

export function useCreateRouter() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: Partial<RouteProfile>) => apiClient.post<RouteProfile>('/api/v1/router/create', data),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['routers'] }),
    });
}

export function useUpdateRouter() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: RouteProfileUpdateRequest) => apiClient.post<RouteProfile>('/api/v1/router/update', data),
        onMutate: async (variables) => {
            await queryClient.cancelQueries({ queryKey: ['routers'] });
            const snapshot = routeCacheSnapshot(queryClient, variables.id);
            if (canOptimisticallyUpdateRoute(variables)) {
                patchRouteCache(queryClient, variables.id, (router) => applyRouteUpdate(router, variables));
            }
            return { snapshot };
        },
        onError: (_, variables, context) => {
            restoreRouteCache(queryClient, variables.id, context?.snapshot);
        },
        onSuccess: (router, variables) => {
            applyRouteCache(queryClient, router);
            queryClient.invalidateQueries({ queryKey: ['routers'] });
            queryClient.invalidateQueries({ queryKey: ['routers', 'detail', variables.id] });
        },
    });
}

export function useDeleteRouter() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: number) => apiClient.delete<null>(`/api/v1/router/delete/${id}`),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['routers'] }),
    });
}

export function useSwitchRouterEndpoint() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: { router_id: number; endpoint_id: number }) =>
            apiClient.post<RouteProfile>('/api/v1/router/switch', data),
        onMutate: async (variables) => {
            await queryClient.cancelQueries({ queryKey: ['routers'] });
            const snapshot = routeCacheSnapshot(queryClient, variables.router_id);
            patchRouteCache(queryClient, variables.router_id, (router) => ({
                ...router,
                preferred_endpoint_id: variables.endpoint_id,
            }));
            return { snapshot };
        },
        onError: (_, variables, context) => {
            restoreRouteCache(queryClient, variables.router_id, context?.snapshot);
        },
        onSuccess: (router, variables) => {
            applyRouteCache(queryClient, router);
            queryClient.invalidateQueries({ queryKey: ['routers'] });
            queryClient.invalidateQueries({ queryKey: ['routers', 'detail', variables.router_id] });
        },
    });
}

export function useTestRouterEndpoint() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (endpoint_id: number) =>
            apiClient.post<{ success: boolean; latency_ms: number; error: string }>('/api/v1/router/test-endpoint', { endpoint_id }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['routers'] }),
    });
}

export function endpointChannel(endpoint: RouteEndpoint, channels: RouteOptionChannel[] | Channel[]) {
    return channels.find((channel) => channel.id === endpoint.channel_id);
}
