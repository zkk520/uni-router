import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';
import { logger } from '@/lib/logger';

export type PriceRuleScope = 'global' | 'channel' | 'channel_key' | 'provider_group';

export type PriceImportRule = {
    provider_name: string;
    model_name: string;
    group_name: string;
    billing_mode: 'token' | 'request' | 'custom' | string;
    currency: 'CNY' | 'USD' | 'CUSTOM' | string;
    unit: 'per_1m_tokens' | 'per_request' | string;
    input_price: number;
    output_price: number;
    cache_read_price: number;
    cache_write_price: number;
    request_price: number;
    multiplier: number;
    source_site: string;
    source_url: string;
    captured_at: string;
    raw?: string;
};

export type PriceRule = PriceImportRule & {
    id: number;
    scope_type: PriceRuleScope;
    scope_id: number;
    created_at: number;
    updated_at: number;
};

export type PriceImportParseResult = {
    rules: PriceImportRule[];
    warnings: string[];
};

export type PriceImportParseRequest = {
    template: string;
    content: string;
};

export type PriceImportApplyRequest = {
    scope_type: PriceRuleScope;
    scope_id: number;
    rules: PriceImportRule[];
};

export function usePriceRuleList() {
    return useQuery({
        queryKey: ['price', 'rules'],
        queryFn: async () => apiClient.get<PriceRule[]>('/api/v1/price/rules'),
        refetchInterval: 30000,
    });
}

export function useParsePriceImport() {
    return useMutation({
        mutationFn: async (data: PriceImportParseRequest) =>
            apiClient.post<PriceImportParseResult>('/api/v1/price/import/parse', data),
        onError: (error) => {
            logger.error('价格导入解析失败:', error);
        },
    });
}

export function useApplyPriceImport() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (data: PriceImportApplyRequest) =>
            apiClient.post<PriceRule[]>('/api/v1/price/import/apply', data),
        onSuccess: (data) => {
            logger.log('价格规则导入成功:', data);
            queryClient.invalidateQueries({ queryKey: ['price', 'rules'] });
        },
        onError: (error) => {
            logger.error('价格规则导入失败:', error);
        },
    });
}

export function useUpdatePriceRule() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (data: PriceRule) => apiClient.post<PriceRule>('/api/v1/price/rules/update', data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['price', 'rules'] });
        },
    });
}

export function useDeletePriceRule() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => apiClient.post<null>('/api/v1/price/rules/delete', { id }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['price', 'rules'] });
        },
    });
}
