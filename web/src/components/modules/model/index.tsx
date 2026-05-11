'use client';

import { useMemo } from 'react';
import { BadgeDollarSign, Calculator, GitBranch, Settings2 } from 'lucide-react';
import { useModelList } from '@/api/endpoints/model';
import { ModelItem } from './Item';
import { useSearchStore, useToolbarViewOptionsStore } from '@/components/modules/toolbar';
import { VirtualizedGrid } from '@/components/common/VirtualizedGrid';
import { useTranslations } from 'next-intl';

function PricingModeSummary() {
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
        <section className="rounded-2xl border border-border bg-card p-4 text-card-foreground">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        <Calculator className="size-4 text-primary" />
                        {t('title')}
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{t('description')}</p>
                </div>
                <div className="rounded-xl border border-border/70 bg-background px-3 py-2 text-xs text-muted-foreground lg:max-w-md">
                    <span className="font-medium text-card-foreground">{t('formulaLabel')}</span>
                    <span className="ml-2">{t('formula')}</span>
                </div>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
                {items.map((item) => (
                    <div key={item.title} className="rounded-xl border border-border/70 bg-background p-3">
                        <div className="flex items-center gap-2 text-sm font-medium">
                            <item.icon className="size-4 text-primary" />
                            {item.title}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.description}</p>
                    </div>
                ))}
            </div>
            <div className="mt-3 text-xs text-muted-foreground">{t('priority')}</div>
        </section>
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

    const sortedModels = useMemo(() => {
        if (!models) return [];
        return [...models].sort((a, b) =>
            sortOrder === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)
        );
    }, [models, sortOrder]);

    const visibleModels = useMemo(() => {
        const term = searchTerm.toLowerCase().trim();
        const byName = !term ? sortedModels : sortedModels.filter((m) => m.name.toLowerCase().includes(term));
        const hasPricing = (model: (typeof byName)[number]) =>
            model.input + model.output + model.cache_read + model.cache_write > 0;

        if (filter === 'priced') {
            return byName.filter(hasPricing);
        }
        if (filter === 'free') {
            return byName.filter((m) => !hasPricing(m));
        }

        return byName;
    }, [sortedModels, searchTerm, filter]);

    return (
        <div className="flex h-full min-h-0 flex-col gap-4">
            <PricingModeSummary />
            <div className="flex items-center justify-between px-1">
                <h2 className="text-sm font-semibold text-foreground">{t('listTitle')}</h2>
                <div className="text-xs text-muted-foreground">{t('listUnit')}</div>
            </div>
            <div className="min-h-0 flex-1">
                <VirtualizedGrid
                    items={visibleModels}
                    layout={layout}
                    columns={{ default: 1, md: 2, lg: 3 }}
                    estimateItemHeight={112}
                    getItemKey={(model) => `model-${model.name}`}
                    renderItem={(model) => <ModelItem model={model} layout={layout} />}
                />
            </div>
        </div>
    );
}
