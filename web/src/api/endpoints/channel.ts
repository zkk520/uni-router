import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';
import { logger } from '@/lib/logger';
import { formatCount, formatCurrencyCosts, formatTime } from '@/lib/utils';
import { StatsChannel, StatsChannelKey, type StatsMetricsFormatted } from './stats';
/**
 * 协议类型枚举
 */
export enum ChannelType {
    OpenAIChat = 0,
    OpenAIResponse = 1,
    Anthropic = 2,
    Gemini = 3,
    Volcengine = 4,
    OpenAIEmbedding = 5,
    NewAPIChat = 6,
}

export type BaseUrl = {
    url: string;
    delay: number;
};

export type CustomHeader = {
    header_key: string;
    header_value: string;
};

export type PricingRule = {
    enabled: boolean;
    currency: string;
    currency_symbol: string;
    unit: string;
    multiplier: number;
    base_source: string;
};

export const DEFAULT_PRICING_RULE: PricingRule = {
    enabled: false,
    currency: 'CNY',
    currency_symbol: '¥',
    unit: '1M Tokens',
    multiplier: 7.2,
    base_source: 'model_price',
};

export const PRICING_CURRENCY_OPTIONS = [
    { currency: 'CNY', currency_symbol: '¥', label: 'CNY ¥' },
    { currency: 'USD', currency_symbol: '$', label: 'USD $' },
    { currency: 'EUR', currency_symbol: '€', label: 'EUR €' },
    { currency: 'GBP', currency_symbol: '£', label: 'GBP £' },
    { currency: 'JPY', currency_symbol: '¥', label: 'JPY ¥' },
    { currency: 'HKD', currency_symbol: 'HK$', label: 'HKD HK$' },
    { currency: 'TWD', currency_symbol: 'NT$', label: 'TWD NT$' },
    { currency: 'SGD', currency_symbol: 'S$', label: 'SGD S$' },
    { currency: 'KRW', currency_symbol: '₩', label: 'KRW ₩' },
] as const;

export function normalizePricingRule(rule?: PricingRule): PricingRule {
    const base = rule ?? DEFAULT_PRICING_RULE;
    return {
        enabled: base.enabled ?? DEFAULT_PRICING_RULE.enabled,
        currency: base.currency || DEFAULT_PRICING_RULE.currency,
        currency_symbol: base.currency_symbol || DEFAULT_PRICING_RULE.currency_symbol,
        unit: base.unit || DEFAULT_PRICING_RULE.unit,
        multiplier: base.multiplier || DEFAULT_PRICING_RULE.multiplier,
        base_source: base.base_source || DEFAULT_PRICING_RULE.base_source,
    };
}

export type ChannelKey = {
    id: number;
    channel_id: number;
    enabled: boolean;
    channel_key: string;
    status_code: number;
    last_use_time_stamp: number;
    total_cost: number;
    remark: string;
    type?: ChannelType | null;
    pricing_rule: PricingRule;
    models: string[];
    models_synced_at: number;
    models_sync_error: string;
    stats?: StatsChannelKey;
};

/**
 * 供应商完整数据（与后端 model.Channel 对齐；数组字段在前端保证为 []）
 */
export type Channel = {
    id: number;
    name: string;
    type: ChannelType;
    enabled: boolean;
    base_urls: BaseUrl[];
    keys: ChannelKey[];
    model: string;
    custom_model: string;
    proxy: boolean;
    auto_sync: boolean;
    custom_header: CustomHeader[];
    param_override?: string | null;
    channel_proxy?: string | null;
    match_regex?: string | null;
    pricing_rule: PricingRule;
    stats: StatsChannel;
};

// Internal type: backend may return null for slice fields; normalize to [] in select()
type ChannelServer = Omit<Channel, 'base_urls' | 'custom_header' | 'keys'> & {
    base_urls: BaseUrl[] | null;
    custom_header: CustomHeader[] | null;
    keys: ChannelKey[] | null;
};

/**
 * 创建供应商请求：必填字段 + 可选字段
 */
export type CreateChannelRequest = {
    name: string;
    type: ChannelType;
    enabled?: boolean;
    base_urls: BaseUrl[];
    keys: Array<Pick<ChannelKey, 'enabled' | 'channel_key' | 'remark' | 'type' | 'pricing_rule' | 'models' | 'models_synced_at' | 'models_sync_error'>>;
    model: string;
    custom_model?: string;
    proxy?: boolean;
    auto_sync?: boolean;
    custom_header?: CustomHeader[];
    channel_proxy?: string | null;
    param_override?: string | null;
    match_regex?: string | null;
    pricing_rule?: PricingRule;
};

/**
 * 更新供应商请求：id + 可选字段 + keys diff
 */
export type UpdateChannelRequest = {
    id: number;
    name?: string;
    type?: ChannelType;
    enabled?: boolean;
    base_urls?: BaseUrl[];
    model?: string;
    custom_model?: string;
    proxy?: boolean;
    auto_sync?: boolean;
    custom_header?: CustomHeader[];
    channel_proxy?: string | null;
    param_override?: string | null;
    match_regex?: string | null;
    pricing_rule?: PricingRule;
    // keys diff
    keys_to_add?: Array<Pick<ChannelKey, 'enabled' | 'channel_key' | 'remark' | 'type' | 'pricing_rule' | 'models' | 'models_synced_at' | 'models_sync_error'>>;
    keys_to_update?: Array<{ id: number; enabled?: boolean; channel_key?: string; remark?: string; type?: ChannelType | null; pricing_rule?: PricingRule; models?: string[]; models_synced_at?: number; models_sync_error?: string }>;
    keys_to_delete?: number[];
};

export type FetchModelRequest = {
    type: ChannelType;
    base_urls: BaseUrl[];
    keys: Array<Pick<ChannelKey, 'enabled' | 'channel_key' | 'type'>>;
    proxy?: boolean;
    channel_proxy?: string | null;
    match_regex?: string | null;
    custom_header?: CustomHeader[];
};

export type FetchModelResult = {
    key_id?: number;
    key_index: number;
    remark: string;
    masked_key: string;
    success: boolean;
    models: string[];
    error?: string;
    models_synced_at?: number;
};

export type FetchModelResponse = {
    results: FetchModelResult[];
    models: string[];
};

/**
 * 获取供应商列表 Hook
 * 
 * @example
 * const { data: channels, isLoading, error } = useChannelList();
 * 
 * if (isLoading) return <Loading />;
 * if (error) return <Error message={error.message} />;
 * 
 * channels?.forEach(channel => console.log(channel.raw.name));
 */
export function useChannelList() {
    return useQuery({
        queryKey: ['channels', 'list'],
        queryFn: async () => {
            return apiClient.get<ChannelServer[]>('/api/v1/channel/list');
        },
        select: (data) => data.map((item) => ({
            raw: ({
                ...item,
                base_urls: item.base_urls ?? [],
                custom_header: item.custom_header ?? [],
                keys: (item.keys ?? []).map((key) => ({
                    ...key,
                    models: key.models ?? [],
                    models_synced_at: key.models_synced_at ?? 0,
                    models_sync_error: key.models_sync_error ?? '',
                    pricing_rule: normalizePricingRule(key.pricing_rule),
                })),
                pricing_rule: normalizePricingRule(item.pricing_rule),
            }) satisfies Channel,
            formatted: {
                input_token: formatCount(item.stats.input_token),
                output_token: formatCount(item.stats.output_token),
                total_token: formatCount(item.stats.input_token + item.stats.output_token),
                input_cost: formatCurrencyCosts(item.stats.input_cost_by_currency, item.stats.input_cost),
                output_cost: formatCurrencyCosts(item.stats.output_cost_by_currency, item.stats.output_cost),
                total_cost: formatCurrencyCosts(item.stats.total_cost_by_currency, item.stats.input_cost + item.stats.output_cost),
                request_success: formatCount(item.stats.request_success),
                request_failed: formatCount(item.stats.request_failed),
                request_count: formatCount(item.stats.request_success + item.stats.request_failed),
                wait_time: formatTime(item.stats.wait_time),
            }
        })) as Array<{ raw: Channel; formatted: StatsMetricsFormatted }>,
        refetchInterval: 30000,
        refetchOnMount: 'always',
    });
}

/**
 * 创建供应商 Hook
 * 
 * @example
 * const createChannel = useCreateChannel();
 * 
 * createChannel.mutate({
 *   name: 'OpenAI',
 *   type: ChannelType.OpenAIChat,
 *   base_urls: [{ url: 'https://api.openai.com', delay: 0 }],
 *   keys: [{ enabled: true, channel_key: 'sk-xxx' }],
 *   model: 'gpt-4',
 * });
 */
export function useCreateChannel() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (data: CreateChannelRequest) => {
            return apiClient.post<ChannelServer>('/api/v1/channel/create', data);
        },
        onSuccess: (data) => {
            logger.log('供应商创建成功:', data);
            queryClient.invalidateQueries({ queryKey: ['channels', 'list'] });
            queryClient.invalidateQueries({ queryKey: ['models', 'list'] });
            queryClient.invalidateQueries({ queryKey: ['models', 'channel'] });
        },
        onError: (error) => {
            logger.warn('供应商创建失败:', error instanceof Error ? error.message : String(error));
        },
    });
}

/**
 * 更新供应商 Hook
 * 
 * @example
 * const updateChannel = useUpdateChannel();
 * 
 * updateChannel.mutate({
 *   id: 1,
 *   name: 'OpenAI Updated',
 *   type: ChannelType.OpenAIChat,
 *   enabled: true,
 *   base_urls: [{ url: 'https://api.openai.com', delay: 0 }],
 *   keys_to_add: [{ enabled: true, channel_key: 'sk-xxx' }],
 *   model: 'gpt-4-turbo',
 *   proxy: false,
 * });
 */
export function useUpdateChannel() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (data: UpdateChannelRequest) => {
            return apiClient.post<ChannelServer>('/api/v1/channel/update', data);
        },
        onSuccess: (data) => {
            logger.log('供应商更新成功:', data);
            queryClient.invalidateQueries({ queryKey: ['channels', 'list'] });
            queryClient.invalidateQueries({ queryKey: ['models', 'channel'] });
        },
        onError: (error) => {
            logger.warn('供应商更新失败:', error instanceof Error ? error.message : String(error));
        },
    });
}

/**
 * 删除供应商 Hook
 * 
 * @example
 * const deleteChannel = useDeleteChannel();
 * 
 * deleteChannel.mutate(1); // 删除 ID 为 1 的供应商
 */
export function useDeleteChannel() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (id: number) => {
            return apiClient.delete<null>(`/api/v1/channel/delete/${id}`);
        },
        onSuccess: () => {
            logger.log('供应商删除成功');
            queryClient.invalidateQueries({ queryKey: ['channels', 'list'] });
            queryClient.invalidateQueries({ queryKey: ['models', 'channel'] });
        },
        onError: (error) => {
            logger.warn('供应商删除失败:', error instanceof Error ? error.message : String(error));
        },
    });
}

/**
 * 启用/禁用供应商 Hook
 * 
 * @example
 * const enableChannel = useEnableChannel();
 * 
 * enableChannel.mutate({ id: 1, enabled: true }); // 启用 ID 为 1 的供应商
 * enableChannel.mutate({ id: 1, enabled: false }); // 禁用 ID 为 1 的供应商
 */
export function useEnableChannel() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (data: { id: number; enabled: boolean }) => {
            return apiClient.post<null>('/api/v1/channel/enable', data);
        },
        onSuccess: () => {
            logger.log('供应商状态更新成功');
            queryClient.invalidateQueries({ queryKey: ['channels', 'list'] });
        },
        onError: (error) => {
            logger.warn('供应商状态更新失败:', error instanceof Error ? error.message : String(error));
        },
    });
}

/**
 * 获取供应商模型列表 Hook
 * 
 * @example
 * const fetchModel = useFetchModel();
 * 
 * fetchModel.mutate({
 *   type: ChannelType.OpenAIChat,
 *   base_urls: [{ url: 'https://api.openai.com', delay: 0 }],
 *   keys: [{ enabled: true, channel_key: 'sk-xxx' }],
 *   proxy: false,
 * });
 * 
 * // 在 onSuccess 中获取模型列表
 * fetchModel.data // ['gpt-4', 'gpt-3.5-turbo', ...]
 */
export function useFetchModel() {
    return useMutation({
        mutationFn: async (data: FetchModelRequest) => {
            return apiClient.post<FetchModelResponse>('/api/v1/channel/fetch-model', data);
        },
        onSuccess: (data) => {
            logger.log('模型列表获取成功:', data);
        },
        onError: (error) => {
            logger.warn('模型列表获取失败:', error instanceof Error ? error.message : String(error));
        },
    });
}

/**
 * 获取供应商最后同步时间 Hook
 * 
 * @example
 * const lastSyncTime = useLastSyncTime();
 * 
 * if (lastSyncTime) {
 *   console.log('最后同步时间:', new Date(lastSyncTime).toLocaleString());
 * }
 */
export function useLastSyncTime() {
    return useQuery({
        queryKey: ['channels', 'last-sync-time'],
        queryFn: async () => {
            return apiClient.get<string>('/api/v1/channel/last-sync-time');
        },
        refetchInterval: 30000,
    });
}
/**
 * 同步供应商 Hook
 * 
 * @example
 * const syncChannel = useSyncChannel();
 * 
 * syncChannel.mutate();
 */
export function useSyncChannel() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async () => {
            return apiClient.post<null>('/api/v1/channel/sync');
        },
        onSuccess: () => {
            logger.log('供应商同步成功');
            queryClient.invalidateQueries({ queryKey: ['channels', 'last-sync-time'] });
            queryClient.invalidateQueries({ queryKey: ['channels', 'list'] });
            queryClient.invalidateQueries({ queryKey: ['models', 'list'] });
            queryClient.invalidateQueries({ queryKey: ['models', 'channel'] });
        },
        onError: (error) => {
            logger.warn('供应商同步失败:', error instanceof Error ? error.message : String(error));
        },
    });
}

export function useTestChannel() {
    return useMutation({
        mutationFn: async (channel: Channel) => {
            const firstKey = channel.keys.find((key) => key.enabled && key.channel_key);
            return apiClient.post<FetchModelResponse>('/api/v1/channel/fetch-model', {
                type: channel.type,
                base_urls: channel.base_urls,
                keys: firstKey ? [{ enabled: true, channel_key: firstKey.channel_key }] : [],
                proxy: channel.proxy,
                channel_proxy: channel.channel_proxy ?? null,
                match_regex: channel.match_regex ?? null,
                custom_header: channel.custom_header ?? [],
            } satisfies FetchModelRequest);
        },
    });
}
