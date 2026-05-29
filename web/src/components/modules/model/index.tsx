'use client';

import { useMemo, useState } from 'react';
import { BadgeDollarSign, Calculator, ChevronDown, ChevronRight, GitBranch, HelpCircle, Settings2 } from 'lucide-react';
import { useModelList, type LLMInfo } from '@/api/endpoints/model';
import { ModelItem } from './Item';
import { useSearchStore, useToolbarViewOptionsStore } from '@/components/modules/toolbar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { useSettingStore, type Locale } from '@/stores/setting';

type ProviderGroupKey = 'openai' | 'anthropic' | 'google' | 'deepseek' | 'xai' | 'alibaba' | 'other';

type ProviderGroup = {
    key: ProviderGroupKey;
    label: string;
    models: LLMInfo[];
};

const PROVIDER_ORDER: ProviderGroupKey[] = ['openai', 'anthropic', 'google', 'deepseek', 'xai', 'alibaba', 'other'];

function getProviderKey(modelName: string): ProviderGroupKey {
    const normalized = modelName.includes('/') ? modelName.split('/').pop() ?? modelName : modelName;
    const name = normalized.toLowerCase();

    if (
        name.startsWith('gpt-') ||
        name.startsWith('o1') ||
        name.startsWith('o3') ||
        name.startsWith('o4') ||
        name.startsWith('openai') ||
        name.startsWith('chatgpt') ||
        name.startsWith('text-embedding')
    ) {
        return 'openai';
    }
    if (name.startsWith('claude') || name.startsWith('anthropic')) return 'anthropic';
    if (name.startsWith('gemini') || name.startsWith('gemma') || name.startsWith('google')) return 'google';
    if (name.startsWith('deepseek')) return 'deepseek';
    if (name.startsWith('grok') || name.startsWith('xai')) return 'xai';
    if (name.startsWith('qwen') || name.startsWith('qwq') || name.startsWith('alibaba')) return 'alibaba';
    return 'other';
}

function hasPricing(model: LLMInfo) {
    return model.input + model.output + model.cache_read + model.cache_write > 0;
}

function formatGroupSummary(locale: Locale, total: number, priced: number) {
    if (locale === 'en') return `${total} total, ${priced} priced`;
    if (locale === 'zh_hant') return `共 ${total} 個，已收費 ${priced} 個`;
    return `共 ${total} 个，已收费 ${priced} 个`;
}

function PricingModeHelp() {
    const t = useTranslations('model.pricingMode');

    const items = [
        {
            icon: BadgeDollarSign,
            title: t('baseTitle'),
            description: t('baseDescription'),
        },
        {
            icon: Settings2,
            title: t('channelTitle'),
            description: t('channelDescription'),
        },
        {
            icon: GitBranch,
            title: t('endpointTitle'),
            description: t('endpointDescription'),
        },
    ];

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label={t('helpAriaLabel')}
                    className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                    <HelpCircle className="size-4" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" side="bottom" sideOffset={8} className="w-[min(90vw,520px)] rounded-2xl border-border/70 bg-card p-4 shadow-xl">
                <div className="flex items-center gap-2 text-sm font-semibold text-card-foreground">
                    <Calculator className="size-4 text-primary" />
                    {t('title')}
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('description')}</p>
                <div className="mt-3 rounded-xl border border-border/70 bg-background px-3 py-2 text-xs text-muted-foreground">
                    <span className="font-medium text-card-foreground">{t('formulaLabel')}</span>
                    <span className="ml-2">{t('formula')}</span>
                </div>
                <div className="mt-3 grid gap-2">
                    {items.map((item) => (
                        <div key={item.title} className="rounded-xl border border-border/70 bg-background p-3">
                            <div className="flex items-center gap-2 text-sm font-medium text-card-foreground">
                                <item.icon className="size-4 text-primary" />
                                {item.title}
                            </div>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.description}</p>
                        </div>
                    ))}
                </div>
                <div className="mt-3 text-xs text-muted-foreground">{t('priority')}</div>
            </PopoverContent>
        </Popover>
    );
}

export function Model() {
    const { data: models } = useModelList();
    const t = useTranslations('model.pricingMode');
    const pageKey = 'model' as const;
    const searchTerm = useSearchStore((s) => s.getSearchTerm(pageKey));
    const layout = useToolbarViewOptionsStore((s) => s.getLayout(pageKey));
    const sortOrder = useToolbarViewOptionsStore((s) => s.getSortOrder(pageKey));
    const filter = useToolbarViewOptionsStore((s) => s.modelFilter);
    const locale = useSettingStore((s) => s.locale);
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

    const sortedModels = useMemo(() => {
        if (!models) return [];
        return [...models].sort((a, b) =>
            sortOrder === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)
        );
    }, [models, sortOrder]);

    const visibleModels = useMemo(() => {
        const term = searchTerm.toLowerCase().trim();
        const byName = !term ? sortedModels : sortedModels.filter((m) => m.name.toLowerCase().includes(term));

        if (filter === 'priced') return byName.filter(hasPricing);
        if (filter === 'free') return byName.filter((m) => !hasPricing(m));
        return byName;
    }, [sortedModels, searchTerm, filter]);

    const groups = useMemo<ProviderGroup[]>(() => {
        const labels: Record<ProviderGroupKey, string> = {
            openai: t('providers.openai'),
            anthropic: t('providers.anthropic'),
            google: t('providers.google'),
            deepseek: t('providers.deepseek'),
            xai: t('providers.xai'),
            alibaba: t('providers.alibaba'),
            other: t('providers.other'),
        };
        const grouped = new Map<ProviderGroupKey, LLMInfo[]>();
        for (const key of PROVIDER_ORDER) grouped.set(key, []);
        for (const model of visibleModels) {
            grouped.get(getProviderKey(model.name))?.push(model);
        }
        return PROVIDER_ORDER
            .map((key) => ({ key, label: labels[key], models: grouped.get(key) ?? [] }))
            .filter((group) => group.models.length > 0);
    }, [visibleModels, t]);

    const toggleGroup = (key: ProviderGroupKey) => {
        setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    return (
        <div className="flex h-full min-h-0 flex-col gap-4">
            <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-1.5">
                    <h2 className="text-sm font-semibold text-foreground">{t('listTitle')}</h2>
                    <PricingModeHelp />
                </div>
                <div className="text-xs text-muted-foreground">{t('listUnit')}</div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-t-3xl pr-1">
                <div className="grid gap-3 pb-1">
                    {groups.map((group, groupIndex) => {
                        const expanded = expandedGroups[group.key] ?? (groupIndex === 0 && Object.keys(expandedGroups).length === 0);
                        const pricedCount = group.models.filter(hasPricing).length;
                        return (
                            <section key={group.key} className="rounded-2xl border border-border/70 bg-card/70">
                                <button
                                    type="button"
                                    onClick={() => toggleGroup(group.key)}
                                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                                >
                                    <span className="flex min-w-0 items-center gap-2">
                                        {expanded ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
                                        <span className="truncate text-sm font-semibold text-card-foreground">{group.label}</span>
                                    </span>
                                    <span className="shrink-0 text-xs text-muted-foreground">
                                        {formatGroupSummary(locale, group.models.length, pricedCount)}
                                    </span>
                                </button>

                                {expanded ? (
                                    <div
                                        className={cn(
                                            'px-3 pb-3',
                                            layout === 'grid'
                                                ? 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] gap-3'
                                                : 'grid gap-3'
                                        )}
                                    >
                                        {group.models.map((model) => (
                                            <ModelItem key={model.name} model={model} layout={layout} />
                                        ))}
                                    </div>
                                ) : null}
                            </section>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
