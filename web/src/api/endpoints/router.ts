import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';
import type { Channel, PricingRule } from './channel';

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
    created_at?: number;
    updated_at?: number;
}

export interface RouteOptionChannelKey {
    id: number;
    enabled: boolean;
    remark: string;
    masked_key: string;
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

export function useRouterList() {
    return useQuery({
        queryKey: ['routers', 'list'],
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
        onSuccess: (_, variables) => {
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
        onSuccess: (_, variables) => {
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
