import { ChannelType, DEFAULT_PRICING_RULE, PRICING_CURRENCY_OPTIONS, normalizePricingRule, type Channel, type FetchModelResponse, type FetchModelResult, type PricingRule, useFetchModel } from '@/api/endpoints/channel';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/common/Toast';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { RefreshCw, X, Plus } from 'lucide-react';
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";

export interface ChannelKeyFormItem {
    id?: number;
    enabled: boolean;
    channel_key: string;
    status_code?: number;
    last_use_time_stamp?: number;
    total_cost?: number;
    remark?: string;
    pricing_rule: PricingRule;
    models?: string[];
    models_synced_at?: number;
    models_sync_error?: string;
}

export interface ChannelFormData {
    name: string;
    type: ChannelType;
    base_urls: Channel['base_urls'];
    custom_header: Channel['custom_header'];
    channel_proxy: string;
    param_override: string;
    keys: ChannelKeyFormItem[];
    model: string;
    custom_model: string;
    enabled: boolean;
    proxy: boolean;
    auto_sync: boolean;
    match_regex: string;
    pricing_rule: PricingRule;
}

export interface ChannelFormProps {
    formData: ChannelFormData;
    onFormDataChange: (data: ChannelFormData) => void;
    onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
    isPending: boolean;
    submitText: string;
    pendingText: string;
    onCancel?: () => void;
    cancelText?: string;
    idPrefix?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function normalizeModelList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(
        value
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter(Boolean)
    ));
}

function normalizeFetchModelResponse(data: unknown): FetchModelResponse {
    if (Array.isArray(data)) {
        return { results: [], models: normalizeModelList(data) };
    }

    if (!isRecord(data)) {
        return { results: [], models: [] };
    }

    const results = Array.isArray(data.results)
        ? data.results.map((item, index): FetchModelResult => {
            const result = isRecord(item) ? item : {};
            return {
                key_id: typeof result.key_id === 'number' ? result.key_id : undefined,
                key_index: typeof result.key_index === 'number' ? result.key_index : index,
                remark: typeof result.remark === 'string' ? result.remark : '',
                masked_key: typeof result.masked_key === 'string' ? result.masked_key : '',
                success: result.success === true,
                models: normalizeModelList(result.models),
                error: typeof result.error === 'string' ? result.error : undefined,
                models_synced_at: typeof result.models_synced_at === 'number' ? result.models_synced_at : undefined,
            };
        })
        : [];

    return {
        results,
        models: normalizeModelList(data.models),
    };
}

function PricingCurrencySelect({
    id,
    rule,
    onChange,
}: {
    id: string;
    rule: PricingRule;
    onChange: (patch: Pick<PricingRule, 'currency' | 'currency_symbol'>) => void;
}) {
    const normalized = normalizePricingRule(rule);
    const currentOption = PRICING_CURRENCY_OPTIONS.find((item) => item.currency === normalized.currency);
    const currentValue = currentOption?.currency ?? normalized.currency;

    return (
        <Select
            value={currentValue}
            onValueChange={(currency) => {
                const next = PRICING_CURRENCY_OPTIONS.find((item) => item.currency === currency);
                if (!next) return;
                onChange({ currency: next.currency, currency_symbol: next.currency_symbol });
            }}
        >
            <SelectTrigger id={id} className="rounded-xl w-full border border-border px-4 py-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
                {!currentOption ? (
                    <SelectItem className="rounded-xl" value={normalized.currency} disabled>
                        {normalized.currency} {normalized.currency_symbol}
                    </SelectItem>
                ) : null}
                {PRICING_CURRENCY_OPTIONS.map((item) => (
                    <SelectItem className="rounded-xl" key={item.currency} value={item.currency}>
                        {item.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

function PricingMultiplierInput({
    id,
    value,
    onValueChange,
}: {
    id?: string;
    value: number;
    onValueChange: (value: number) => void;
}) {
    const [draft, setDraft] = useState(String(value));
    const [focused, setFocused] = useState(false);

    return (
        <Input
            id={id}
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={focused ? draft : String(value)}
            onFocus={() => {
                setFocused(true);
                setDraft(String(value));
            }}
            onChange={(e) => {
                const next = e.target.value;
                setDraft(next);
                if (next === '' || next === '.' || next === '0.') return;
                const parsed = Number(next);
                if (Number.isFinite(parsed) && parsed >= 0) {
                    onValueChange(parsed);
                }
            }}
            onBlur={() => {
                setFocused(false);
                setDraft(String(value));
                if (draft === '' || draft === '.' || draft === '0.') {
                    setDraft(String(value));
                    return;
                }
                const parsed = Number(draft);
                if (Number.isFinite(parsed) && parsed >= 0) {
                    onValueChange(parsed);
                    setDraft(String(parsed));
                } else {
                    setDraft(String(value));
                }
            }}
            className="rounded-xl"
        />
    );
}

export function ChannelForm({
    formData,
    onFormDataChange,
    onSubmit,
    isPending,
    submitText,
    pendingText,
    onCancel,
    cancelText,
    idPrefix = 'channel',
}: ChannelFormProps) {
    const t = useTranslations('channel.form');

    // Ensure the form always shows at least 1 row for base_urls / keys / custom_header.
    // This avoids "empty list" UI and also keeps URL + APIKEY layout consistent.
    useEffect(() => {
        if (!formData.base_urls || formData.base_urls.length === 0) {
            onFormDataChange({ ...formData, base_urls: [{ url: '', delay: 0 }] });
            return;
        }
        if (!formData.keys || formData.keys.length === 0) {
            onFormDataChange({ ...formData, keys: [{ enabled: true, channel_key: '', pricing_rule: DEFAULT_PRICING_RULE, models: [], models_synced_at: 0, models_sync_error: '' }] });
            return;
        }
        if (!formData.custom_header || formData.custom_header.length === 0) {
            onFormDataChange({ ...formData, custom_header: [{ header_key: '', header_value: '' }] });
        }
    }, [formData, onFormDataChange]);

    const autoModels = formData.model
        ? formData.model.split(',').map((m) => m.trim()).filter(Boolean)
        : [];
    const customModels = formData.custom_model
        ? formData.custom_model.split(',').map((m) => m.trim()).filter(Boolean)
        : [];
    const [inputValue, setInputValue] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const fetchModel = useFetchModel();

    const effectiveKey =
        formData.keys.find((k) => k.enabled && k.channel_key.trim())?.channel_key.trim() || '';
    const enabledKeyCount = formData.keys.filter((k) => k.enabled && k.channel_key.trim()).length;

    const updateModels = (nextAuto: string[], nextCustom: string[]) => {
        const model = nextAuto.join(',');
        const custom_model = nextCustom.join(',');
        if (formData.model === model && formData.custom_model === custom_model) return;
        onFormDataChange({ ...formData, model, custom_model });
    };

    const applyFetchedModels = (results: FetchModelResult[]) => {
        const nextKeys = formData.keys.map((key, idx) => {
            const result = results.find((item) =>
                (key.id && item.key_id === key.id) || (!key.id && item.key_index === idx)
            );
            if (!result) return key;
            return {
                ...key,
                models: result.success ? result.models : [],
                models_synced_at: result.models_synced_at ?? Math.floor(Date.now() / 1000),
                models_sync_error: result.success ? '' : result.error ?? t('modelRefreshFailed'),
            };
        });
        const nextAuto = Array.from(new Set(nextKeys.flatMap((key) => key.models ?? []).map((m) => m.trim()).filter(Boolean)));
        onFormDataChange({
            ...formData,
            keys: nextKeys,
            model: nextAuto.join(','),
            custom_model: customModels.join(','),
        });
    };

    const handleRefreshModels = async () => {
        if (!formData.base_urls?.[0]?.url || !effectiveKey) return;
        fetchModel.mutate(
            {
                type: formData.type,
                base_urls: formData.base_urls,
                keys: formData.keys
                    .map((k) => ({ enabled: k.enabled, channel_key: k.channel_key.trim() })),
                proxy: formData.proxy,
                channel_proxy: formData.channel_proxy?.trim() || null,
                match_regex: formData.match_regex.trim() || null,
                custom_header: formData.custom_header?.filter((h) => h.header_key.trim()) || [],
            },
            {
                onSuccess: (data) => {
                    const normalized = normalizeFetchModelResponse(data);
                    if (normalized.results.length > 0) {
                        applyFetchedModels(normalized.results);
                        const successCount = normalized.results.filter((item) => item.success).length;
                        const failedCount = normalized.results.length - successCount;
                        if (normalized.models.length > 0) {
                            const description = failedCount > 0
                                ? `${successCount}/${normalized.results.length} 个 Key 成功，${failedCount} 个失败`
                                : `${successCount} 个 Key 成功`;
                            toast.success(t('modelRefreshSuccess'), { description });
                        } else if (failedCount > 0) {
                            toast.error(t('modelRefreshFailed'), { description: normalized.results.find((item) => item.error)?.error });
                        } else {
                            toast.warning(t('modelRefreshEmpty'));
                        }
                    } else if (normalized.models.length > 0) {
                        onFormDataChange({
                            ...formData,
                            model: normalized.models.join(','),
                            custom_model: customModels.join(','),
                        });
                        toast.success(t('modelRefreshSuccess'), { description: `${normalized.models.length} 个模型` });
                    } else {
                        toast.warning(t('modelRefreshEmpty'));
                    }
                },
                onError: (error) => {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    toast.error(t('modelRefreshFailed'), { description: errorMessage });
                },
            }
        );
    };

    const handleRefreshKeyModels = (idx: number) => {
        const key = formData.keys[idx];
        if (!formData.base_urls?.[0]?.url || !key?.channel_key.trim()) return;
        fetchModel.mutate(
            {
                type: formData.type,
                base_urls: formData.base_urls,
                keys: [{ enabled: key.enabled, channel_key: key.channel_key.trim() }],
                proxy: formData.proxy,
                channel_proxy: formData.channel_proxy?.trim() || null,
                match_regex: formData.match_regex.trim() || null,
                custom_header: formData.custom_header?.filter((h) => h.header_key.trim()) || [],
            },
            {
                onSuccess: (data) => {
                    const normalized = normalizeFetchModelResponse(data);
                    const patched = normalized.results.length > 0
                        ? normalized.results.map((item) => ({
                            ...item,
                            key_id: key.id,
                            key_index: idx,
                        }))
                        : normalized.models.length > 0
                            ? [{
                                key_id: key.id,
                                key_index: idx,
                                remark: key.remark ?? '',
                                masked_key: '',
                                success: true,
                                models: normalized.models,
                            }]
                            : [];
                    applyFetchedModels(patched);
                    const result = patched[0];
                    if (result?.success) {
                        toast.success(t('modelRefreshSuccess'), { description: `${result.models.length} 个模型` });
                    } else {
                        toast.error(t('modelRefreshFailed'), { description: result?.error });
                    }
                },
                onError: (error) => {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    toast.error(t('modelRefreshFailed'), { description: errorMessage });
                },
            }
        );
    };

    const handleAddModel = (model: string) => {
        const trimmedModel = model.trim();
        if (trimmedModel && !customModels.includes(trimmedModel) && !autoModels.includes(trimmedModel)) {
            updateModels(autoModels, [...customModels, trimmedModel]);
        }
        setInputValue('');
    };

    const handleRemoveAutoModel = (model: string) => {
        const nextKeys = formData.keys.map((key) => ({
            ...key,
            models: (key.models ?? []).filter((item) => item !== model),
        }));
        onFormDataChange({
            ...formData,
            keys: nextKeys,
            model: autoModels.filter(m => m !== model).join(','),
            custom_model: customModels.join(','),
        });
    };

    const handleRemoveCustomModel = (model: string) => {
        updateModels(autoModels, customModels.filter(m => m !== model));
    };

    const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (inputValue.trim()) handleAddModel(inputValue);
        }
    };

    const handleAddKey = () => {
        onFormDataChange({
            ...formData,
            keys: [...formData.keys, { enabled: true, channel_key: '', pricing_rule: DEFAULT_PRICING_RULE, models: [], models_synced_at: 0, models_sync_error: '' }],
        });
    };

    const handleUpdateKeyPricingRule = (idx: number, patch: Partial<PricingRule>) => {
        const current = formData.keys[idx]?.pricing_rule ?? DEFAULT_PRICING_RULE;
        handleUpdateKey(idx, { pricing_rule: { ...current, ...patch } });
    };

    const handleUpdateKey = (idx: number, patch: Partial<ChannelKeyFormItem>) => {
        const next = formData.keys.map((k, i) => (i === idx ? { ...k, ...patch } : k));
        onFormDataChange({ ...formData, keys: next });
    };

    const handleRemoveKey = (idx: number) => {
        const curr = formData.keys ?? [];
        if (curr.length <= 1) return;
        const next = curr.filter((_, i) => i !== idx);
        onFormDataChange({ ...formData, keys: next });
    };

    const handleAddBaseUrl = () => {
        onFormDataChange({
            ...formData,
            base_urls: [...(formData.base_urls ?? []), { url: '', delay: 0 }],
        });
    };

    const handleUpdateBaseUrl = (idx: number, patch: Partial<Channel['base_urls'][number]>) => {
        const next = (formData.base_urls ?? []).map((u, i) => (i === idx ? { ...u, ...patch } : u));
        onFormDataChange({ ...formData, base_urls: next });
    };

    const handleRemoveBaseUrl = (idx: number) => {
        const curr = formData.base_urls ?? [];
        if (curr.length <= 1) return;
        onFormDataChange({ ...formData, base_urls: curr.filter((_, i) => i !== idx) });
    };

    const handleAddHeader = () => {
        onFormDataChange({
            ...formData,
            custom_header: [...(formData.custom_header ?? []), { header_key: '', header_value: '' }],
        });
    };

    const handleUpdateHeader = (idx: number, patch: Partial<Channel['custom_header'][number]>) => {
        const next = (formData.custom_header ?? []).map((h, i) => (i === idx ? { ...h, ...patch } : h));
        onFormDataChange({ ...formData, custom_header: next });
    };

    const handleRemoveHeader = (idx: number) => {
        const curr = formData.custom_header ?? [];
        if (curr.length <= 1) return;
        onFormDataChange({ ...formData, custom_header: curr.filter((_, i) => i !== idx) });
    };

    const updatePricingRule = (patch: Partial<PricingRule>) => {
        onFormDataChange({
            ...formData,
            pricing_rule: normalizePricingRule({ ...(formData.pricing_rule ?? DEFAULT_PRICING_RULE), ...patch }),
        });
    };

    const pricingRule = normalizePricingRule(formData.pricing_rule);

    return (
        <form onSubmit={onSubmit} className="space-y-4 px-1">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <label htmlFor={`${idPrefix}-name`} className="text-sm font-medium text-card-foreground">
                        {t('name')}
                    </label>
                    <Input
                        className='rounded-xl'
                        id={`${idPrefix}-name`}
                        type="text"
                        value={formData.name}
                        onChange={(event) => onFormDataChange({ ...formData, name: event.target.value })}
                        required
                    />
                </div>

                <div className="space-y-2">
                    <label htmlFor={`${idPrefix}-type`} className="text-sm font-medium text-card-foreground">
                        {t('type')}
                    </label>
                    <Select
                        value={String(formData.type)}
                        onValueChange={(value) => onFormDataChange({ ...formData, type: Number(value) as ChannelType })}
                    >
                        <SelectTrigger id={`${idPrefix}-type`} className="rounded-xl w-full border border-border px-4 py-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className='rounded-xl'>
                            <SelectItem className='rounded-xl' value={String(ChannelType.OpenAIChat)}>{t('typeOpenAIChat')}</SelectItem>
                            <SelectItem className='rounded-xl' value={String(ChannelType.OpenAIResponse)}>{t('typeOpenAIResponse')}</SelectItem>
                            <SelectItem className='rounded-xl' value={String(ChannelType.Anthropic)}>{t('typeAnthropic')}</SelectItem>
                            <SelectItem className='rounded-xl' value={String(ChannelType.Gemini)}>{t('typeGemini')}</SelectItem>
                            <SelectItem className='rounded-xl' value={String(ChannelType.Volcengine)}>{t('typeVolcengine')}</SelectItem>
                            <SelectItem className='rounded-xl' value={String(ChannelType.OpenAIEmbedding)}>{t('typeOpenAIEmbedding')}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <div className="text-sm font-medium text-card-foreground">{t('pricingRule')}</div>
                        <div className="text-xs text-muted-foreground">{t('pricingRuleHint')}</div>
                    </div>
                    <Switch
                        checked={pricingRule.enabled}
                        onCheckedChange={(checked) => updatePricingRule({ enabled: checked })}
                    />
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <div className="space-y-1 md:col-span-2">
                        <label htmlFor={`${idPrefix}-pricing-currency`} className="text-xs text-muted-foreground">{t('pricingCurrency')}</label>
                        <PricingCurrencySelect
                            id={`${idPrefix}-pricing-currency`}
                            rule={pricingRule}
                            onChange={updatePricingRule}
                        />
                    </div>
                    <div className="space-y-1">
                        <label htmlFor={`${idPrefix}-pricing-multiplier`} className="text-xs text-muted-foreground">{t('pricingMultiplier')}</label>
                        <PricingMultiplierInput
                            id={`${idPrefix}-pricing-multiplier`}
                            value={pricingRule.multiplier}
                            onValueChange={(value) => updatePricingRule({ multiplier: value })}
                        />
                    </div>
                    <div className="space-y-1">
                        <label htmlFor={`${idPrefix}-pricing-unit`} className="text-xs text-muted-foreground">{t('pricingUnit')}</label>
                        <Input
                            id={`${idPrefix}-pricing-unit`}
                            value={pricingRule.unit}
                            onChange={(e) => updatePricingRule({ unit: e.target.value })}
                            placeholder="1M Tokens"
                            className="rounded-xl"
                        />
                    </div>
                </div>
                <div className="text-xs text-muted-foreground">
                    {pricingRule.enabled
                        ? `${pricingRule.currency_symbol || pricingRule.currency} · ${pricingRule.multiplier || 1}x / ${pricingRule.unit || '1M Tokens'}`
                        : t('pricingRuleDisabled')}
                </div>
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-card-foreground">
                        {t('baseUrls')} {formData.base_urls.length > 0 ? `(${formData.base_urls.length})` : ''}
                    </label>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleAddBaseUrl}
                        className="h-6 px-2 text-xs text-muted-foreground/70 hover:text-muted-foreground hover:bg-transparent"
                    >
                        <Plus className="h-3 w-3 mr-1" />
                        {t('add')}
                    </Button>
                </div>
                <div className="space-y-2">
                    {(formData.base_urls ?? []).map((u, idx) => (
                        <div key={`baseurl-${idx}`} className="flex items-center gap-2">
                            <Input
                                id={`${idPrefix}-base-${idx}`}
                                type="url"
                                value={u.url}
                                onChange={(e) => handleUpdateBaseUrl(idx, { url: e.target.value })}
                                placeholder={t('baseUrlUrl')}
                                required={idx === 0}
                                className="rounded-xl flex-1"
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRemoveBaseUrl(idx)}
                                disabled={(formData.base_urls ?? []).length <= 1}
                                className="h-8 w-8 p-0 rounded-xl text-muted-foreground hover:text-destructive disabled:opacity-40 hover:bg-transparent"
                                title="Remove"
                            >
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                    ))}
                </div>
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-card-foreground">
                        {t('apiKey')} {formData.keys.length > 0 ? `(${formData.keys.length})` : ''}
                    </label>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleAddKey}
                        className="h-6 px-2 text-xs text-muted-foreground/70 hover:text-muted-foreground hover:bg-transparent"
                    >
                        <Plus className="h-3 w-3 mr-1" />
                        {t('add')}
                    </Button>
                </div>
                <div className="space-y-2">
                    {(formData.keys ?? []).map((k, idx) => (
                        <div key={k.id ?? `new-${idx}`} className="rounded-xl border border-border/60 bg-muted/10 p-3">
                            <div className="flex items-center gap-2">
                                <Input
                                    type="text"
                                    value={k.channel_key}
                                    onChange={(e) => handleUpdateKey(idx, { channel_key: e.target.value })}
                                    placeholder={t('apiKey')}
                                    required={idx === 0}
                                    className="rounded-xl flex-1"
                                />
                                <Input
                                    type="text"
                                    value={k.remark ?? ''}
                                    onChange={(e) => handleUpdateKey(idx, { remark: e.target.value })}
                                    placeholder={t('remark')}
                                    className="rounded-xl w-32"
                                />
                                <Switch
                                    checked={k.enabled}
                                    onCheckedChange={(checked) => handleUpdateKey(idx, { enabled: checked })}
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleRemoveKey(idx)}
                                    disabled={(formData.keys ?? []).length <= 1}
                                    className="h-8 w-8 p-0 rounded-xl text-muted-foreground hover:text-destructive hover:bg-transparent disabled:opacity-40"
                                    title="Remove"
                                >
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                            <div className="mt-3 flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="text-xs font-medium text-card-foreground">{t('keyPricingRule')}</div>
                                    <div className="mt-1 truncate text-xs text-muted-foreground">
                                        {(k.pricing_rule ?? DEFAULT_PRICING_RULE).enabled
                                            ? `${(k.pricing_rule ?? DEFAULT_PRICING_RULE).currency_symbol || (k.pricing_rule ?? DEFAULT_PRICING_RULE).currency} · ${(k.pricing_rule ?? DEFAULT_PRICING_RULE).multiplier || 1}x / ${(k.pricing_rule ?? DEFAULT_PRICING_RULE).unit || '1M Tokens'}`
                                            : t('keyPricingInherit')}
                                    </div>
                                </div>
                                <Switch
                                    checked={(k.pricing_rule ?? DEFAULT_PRICING_RULE).enabled}
                                    onCheckedChange={(checked) => handleUpdateKeyPricingRule(idx, { enabled: checked })}
                                />
                            </div>
                            {(k.pricing_rule ?? DEFAULT_PRICING_RULE).enabled ? (
                                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                                    <div className="md:col-span-2">
                                        <PricingCurrencySelect
                                            id={`${idPrefix}-key-${idx}-pricing-currency`}
                                            rule={normalizePricingRule(k.pricing_rule)}
                                            onChange={(patch) => handleUpdateKeyPricingRule(idx, patch)}
                                        />
                                    </div>
                                    <PricingMultiplierInput
                                        value={(k.pricing_rule ?? DEFAULT_PRICING_RULE).multiplier}
                                        onValueChange={(value) => handleUpdateKeyPricingRule(idx, { multiplier: value })}
                                    />
                                    <Input
                                        value={(k.pricing_rule ?? DEFAULT_PRICING_RULE).unit}
                                        onChange={(e) => handleUpdateKeyPricingRule(idx, { unit: e.target.value })}
                                        placeholder={t('pricingUnit')}
                                        className="rounded-xl"
                                    />
                                </div>
                            ) : null}
                            <div className="mt-3 rounded-xl border border-border/60 bg-background/70 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="text-xs font-medium text-card-foreground">
                                            Key 模型 {(k.models?.length ?? 0) > 0 ? `(${k.models?.length})` : ''}
                                        </div>
                                        <div className="mt-1 truncate text-xs text-muted-foreground">
                                            {k.models_sync_error
                                                ? k.models_sync_error
                                                : k.models_synced_at
                                                    ? `最近同步 ${new Date((k.models_synced_at ?? 0) * 1000).toLocaleString()}`
                                                    : '尚未同步'}
                                        </div>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleRefreshKeyModels(idx)}
                                        disabled={!formData.base_urls?.[0]?.url || !k.channel_key.trim() || fetchModel.isPending}
                                        className="h-7 px-2 text-xs text-muted-foreground hover:text-muted-foreground hover:bg-muted"
                                    >
                                        <RefreshCw className={`h-3 w-3 mr-1 ${fetchModel.isPending ? 'animate-spin' : ''}`} />
                                        刷新此 Key
                                    </Button>
                                </div>
                                {(k.models?.length ?? 0) > 0 ? (
                                    <div className="mt-2 flex max-h-20 flex-wrap gap-1.5 overflow-y-auto">
                                        {(k.models ?? []).map((model) => (
                                            <Badge key={`${idx}-${model}`} variant="outline" className="max-w-full truncate text-[10px]">
                                                {model}
                                            </Badge>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-card-foreground">{t('model')}</label>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleRefreshModels}
                        disabled={!formData.base_urls?.[0]?.url || !effectiveKey || fetchModel.isPending}
                        className="h-6 px-2 text-xs text-muted-foreground/50 hover:text-muted-foreground hover:bg-transparent"
                    >
                        <RefreshCw className={`h-3 w-3 mr-1 ${fetchModel.isPending ? 'animate-spin' : ''}`} />
                        {t('modelRefresh')}{enabledKeyCount > 0 ? `(${enabledKeyCount})` : ''}
                    </Button>
                </div>
                <input type="hidden" value={formData.model} required />

                <div className="relative">
                    <Input
                        ref={inputRef}
                        id={`${idPrefix}-model-custom`}
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleInputKeyDown}
                        placeholder={t('modelCustomPlaceholder')}
                        className="pr-10 rounded-xl"
                    />
                    {inputValue.trim() && !customModels.includes(inputValue.trim()) && !autoModels.includes(inputValue.trim()) && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleAddModel(inputValue)}
                            className="absolute rounded-lg right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                            title={t('modelAdd')}
                        >
                            <Plus className="size-4" />
                        </Button>
                    )}
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-card-foreground">
                            {t('modelSelected')} {(autoModels.length + customModels.length) > 0 && `(${autoModels.length + customModels.length})`}
                        </label>
                        {(autoModels.length + customModels.length) > 0 && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    updateModels([], []);
                                }}
                                className="h-6 px-2 text-xs text-muted-foreground/50 hover:text-muted-foreground hover:bg-transparent"
                            >
                                {t('modelClearAll')}
                            </Button>
                        )}
                    </div>
                    <div className="rounded-xl border border-border bg-muted/30 p-2.5 max-h-40 min-h-12 overflow-y-auto">
                        {(autoModels.length + customModels.length) > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                                {autoModels.map((model) => (
                                    <Badge key={model} variant="secondary" className="bg-muted hover:bg-muted/80">
                                        {model}
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveAutoModel(model)}
                                            className="ml-1 rounded-sm opacity-70 hover:opacity-100 focus:outline-none focus:ring-1 focus:ring-ring"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </Badge>
                                ))}
                                {customModels.map((model) => (
                                    <Badge key={model} className="bg-primary hover:bg-primary/90">
                                        {model}
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveCustomModel(model)}
                                            className="ml-1 rounded-sm opacity-70 hover:opacity-100 focus:outline-none focus:ring-1 focus:ring-ring"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </Badge>
                                ))}
                            </div>
                        ) : (
                            <div className="flex items-center justify-center h-8 text-xs text-muted-foreground">
                                {t('modelNoSelected')}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <Accordion type="single" collapsible className="w-full border rounded-xl bg-card">
                <AccordionItem value="advanced" className="border-none">
                    <AccordionTrigger className="text-sm font-medium text-card-foreground py-3 px-4 hover:no-underline hover:bg-muted/30 rounded-xl transition-colors">
                        {t('advanced')}
                    </AccordionTrigger>
                    <AccordionContent className="pt-4 px-4 pb-4 space-y-4 border-t">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label htmlFor={`${idPrefix}-channel-proxy`} className="text-sm font-medium text-card-foreground">
                                    {t('channelProxy')}
                                </label>
                                <Input
                                    id={`${idPrefix}-channel-proxy`}
                                    type="text"
                                    value={formData.channel_proxy}
                                    onChange={(e) => onFormDataChange({ ...formData, channel_proxy: e.target.value })}
                                    placeholder={t('channelProxyPlaceholder')}
                                    className="rounded-xl"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium text-card-foreground">
                                    {t('customHeader')} {formData.custom_header.length > 0 ? `(${formData.custom_header.length})` : ''}
                                </label>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleAddHeader}
                                    className="h-6 px-2 text-xs text-muted-foreground/70 hover:text-muted-foreground hover:bg-transparent"
                                >
                                    <Plus className="h-3 w-3 mr-1" />
                                    {t('customHeaderAdd')}
                                </Button>
                            </div>
                            <div className="space-y-2">
                                {(formData.custom_header ?? []).map((h, idx) => (
                                    <div key={`hdr-${idx}`} className="flex items-center gap-2">
                                        <Input
                                            type="text"
                                            value={h.header_key}
                                            onChange={(e) => handleUpdateHeader(idx, { header_key: e.target.value })}
                                            placeholder={t('customHeaderKey')}
                                            className="rounded-xl flex-1"
                                        />
                                        <Input
                                            type="text"
                                            value={h.header_value}
                                            onChange={(e) => handleUpdateHeader(idx, { header_value: e.target.value })}
                                            placeholder={t('customHeaderValue')}
                                            className="rounded-xl flex-1"
                                        />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleRemoveHeader(idx)}
                                            disabled={(formData.custom_header ?? []).length <= 1}
                                            className="h-8 w-8 p-0 rounded-xl text-muted-foreground hover:text-destructive hover:bg-transparent disabled:opacity-40"
                                            title="Remove"
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label htmlFor={`${idPrefix}-match-regex`} className="text-sm font-medium text-card-foreground">
                                {t('matchRegex')}
                            </label>
                            <Input
                                id={`${idPrefix}-match-regex`}
                                type="text"
                                value={formData.match_regex}
                                onChange={(e) => onFormDataChange({ ...formData, match_regex: e.target.value })}
                                placeholder={t('matchRegexPlaceholder')}
                                className="rounded-xl"
                            />
                        </div>

                        <div className="space-y-2">
                            <label htmlFor={`${idPrefix}-param-override`} className="text-sm font-medium text-card-foreground">
                                {t('paramOverride')}
                            </label>
                            <textarea
                                id={`${idPrefix}-param-override`}
                                value={formData.param_override}
                                onChange={(e) => onFormDataChange({ ...formData, param_override: e.target.value })}
                                placeholder={t('paramOverridePlaceholder')}
                                className="min-h-28 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            />
                        </div>
                    </AccordionContent>
                </AccordionItem>
            </Accordion>

            <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-muted/20 border border-border/50">
                <label className="flex items-center gap-2 cursor-pointer">
                    <Switch
                        checked={formData.enabled}
                        onCheckedChange={(checked) => onFormDataChange({ ...formData, enabled: checked })}
                    />
                    <span className="text-sm font-medium text-card-foreground">{t('enabled')}</span>
                </label>
                <div className="flex items-center gap-6">
                    <label className="flex items-center gap-2 cursor-pointer">
                        <Switch
                            checked={formData.proxy}
                            onCheckedChange={(checked) => onFormDataChange({ ...formData, proxy: checked })}
                        />
                        <span className="text-sm text-card-foreground">{t('proxy')}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <Switch
                            checked={formData.auto_sync}
                            onCheckedChange={(checked) => onFormDataChange({ ...formData, auto_sync: checked })}
                        />
                        <span className="text-sm text-card-foreground">{t('autoSync')}</span>
                    </label>
                </div>
            </div>

            <div className={`flex flex-col gap-3 pt-2 ${onCancel ? 'sm:flex-row' : ''}`}>
                {onCancel && cancelText && (
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={onCancel}
                        className="w-full sm:flex-1 rounded-2xl h-12"
                    >
                        {cancelText}
                    </Button>
                )}
                <Button
                    type="submit"
                    disabled={isPending}
                    className="w-full sm:flex-1 rounded-2xl h-12"
                >
                    {isPending ? pendingText : submitText}
                </Button>
            </div>
        </form>
    );
}
