import { useState } from 'react';
import {
    MorphingDialogClose,
    MorphingDialogTitle,
    MorphingDialogDescription,
    useMorphingDialog,
} from '@/components/ui/morphing-dialog';
import { useCreateChannel, ChannelType, DEFAULT_PRICING_RULE, normalizePricingRule } from '@/api/endpoints/channel';
import { useTranslations } from 'next-intl';
import { ChannelForm, type ChannelFormData } from './Form';
import { toast } from '@/components/common/Toast';

export function CreateDialogContent() {
    const { setIsOpen } = useMorphingDialog();
    const createChannel = useCreateChannel();
    const [formData, setFormData] = useState<ChannelFormData>({
        name: '',
        type: ChannelType.OpenAIChat,
        base_urls: [{ url: '', delay: 0 }],
        custom_header: [],
        channel_proxy: '',
        param_override: '',
        keys: [{ enabled: true, channel_key: '', remark: '', type: null, pricing_rule: DEFAULT_PRICING_RULE, models: [], models_synced_at: 0, models_sync_error: '' }],
        model: '',
        custom_model: '',
        auto_sync: false,
        enabled: true,
        proxy: false,
        match_regex: '',
        pricing_rule: DEFAULT_PRICING_RULE,
    });
    const t = useTranslations('channel.create');

    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const normalizedBaseUrls = (formData.base_urls ?? []).filter((u) => u.url.trim()).map((u) => ({
            url: u.url.trim(),
            delay: Number(u.delay || 0),
        }));
        const normalizedKeys = formData.keys
            .filter((k) => k.channel_key.trim())
            .map((k) => ({
                enabled: k.enabled,
                channel_key: k.channel_key,
                remark: k.remark ?? '',
                type: k.type ?? null,
                pricing_rule: normalizePricingRule(k.pricing_rule),
                models: k.models ?? [],
                models_synced_at: k.models_synced_at ?? 0,
                models_sync_error: k.models_sync_error ?? '',
            }));
        const normalizedHeaders = (formData.custom_header ?? [])
            .map((h) => ({ header_key: h.header_key.trim(), header_value: h.header_value }))
            .filter((h) => h.header_key && h.header_value !== '');

        const channelProxy = formData.channel_proxy.trim();
        const paramOverride = formData.param_override.trim();
        createChannel.mutate(
            {
                name: formData.name,
                type: formData.type,
                enabled: formData.enabled,
                base_urls: normalizedBaseUrls,
                keys: normalizedKeys,
                model: formData.model,
                custom_model: formData.custom_model,
                proxy: formData.proxy,
                auto_sync: formData.auto_sync,
                custom_header: normalizedHeaders,
                channel_proxy: channelProxy,
                param_override: paramOverride,
                match_regex: formData.match_regex.trim(),
                pricing_rule: formData.pricing_rule,
            },
            {
                onSuccess: () => {
                    setFormData({
                        name: '',
                        type: ChannelType.OpenAIChat,
                        base_urls: [{ url: '', delay: 0 }],
                        custom_header: [],
                        channel_proxy: '',
                        param_override: '',
                        keys: [{ enabled: true, channel_key: '', remark: '', type: null, pricing_rule: DEFAULT_PRICING_RULE, models: [], models_synced_at: 0, models_sync_error: '' }],
                        model: '',
                        custom_model: '',
                        auto_sync: false,
                        enabled: true,
                        proxy: false,
                        match_regex: '',
                        pricing_rule: DEFAULT_PRICING_RULE,
                    });
                    setIsOpen(false);
                },
                onError: (error) => {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    toast.error(t('toast.createFailed'), { description: errorMessage });
                }
            });
    };

    return (
        <div className="flex h-full min-h-0 w-screen max-w-full flex-col md:max-w-xl">
            <MorphingDialogTitle className="shrink-0">
                <header className="mb-6 flex items-center justify-between">
                    <h2 className="text-2xl font-bold text-card-foreground">{t('dialogTitle')}</h2>
                    <MorphingDialogClose
                        className="relative right-0 top-0"
                        variants={{
                            initial: { opacity: 0, scale: 0.8 },
                            animate: { opacity: 1, scale: 1 },
                            exit: { opacity: 0, scale: 0.8 }
                        }}
                    />
                </header>
            </MorphingDialogTitle>
            <MorphingDialogDescription disableLayoutAnimation className="min-h-0 flex-1 overflow-y-auto pr-1">
                <ChannelForm
                    formData={formData}
                    onFormDataChange={setFormData}
                    onSubmit={handleSubmit}
                    isPending={createChannel.isPending}
                    submitText={t('submit')}
                    pendingText={t('submitting')}
                    idPrefix="new-channel"
                />
            </MorphingDialogDescription>
        </div>
    );
}
