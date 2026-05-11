'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useCreateModel, useModelPresetList, type LLMInfo } from '@/api/endpoints/model';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel, FieldGroup } from '@/components/ui/field';
import {
    MorphingDialogClose,
    MorphingDialogTitle,
    MorphingDialogDescription,
    useMorphingDialog,
} from '@/components/ui/morphing-dialog';
import { useTranslations } from 'next-intl';

type ModelFormValues = {
    name: string;
    input: string;
    output: string;
    cache_read: string;
    cache_write: string;
};

function createEmptyFormValues(initialValues?: Partial<ModelFormValues>): ModelFormValues {
    return {
        name: initialValues?.name ?? '',
        input: initialValues?.input ?? '',
        output: initialValues?.output ?? '',
        cache_read: initialValues?.cache_read ?? '',
        cache_write: initialValues?.cache_write ?? '',
    };
}

export type CreateDialogContentProps = {
    initialValues?: Partial<ModelFormValues>;
};

export function CreateDialogContent({ initialValues }: CreateDialogContentProps) {
    const { isOpen, setIsOpen } = useMorphingDialog();
    const t = useTranslations('model.create');
    const createModel = useCreateModel();

    const [formData, setFormData] = useState<ModelFormValues>(() => createEmptyFormValues(initialValues));
    const [presetSearch, setPresetSearch] = useState('');
    const isCopyMode = initialValues !== undefined;
    const presetList = useModelPresetList(isOpen && !isCopyMode);

    useEffect(() => {
        setFormData(createEmptyFormValues(initialValues));
    }, [initialValues]);

    const filteredPresets = useMemo(() => {
        const presets = presetList.data ?? [];
        const keyword = presetSearch.trim().toLowerCase();
        if (!keyword) return presets.slice(0, 8);
        return presets
            .filter((preset) => preset.name.toLowerCase().includes(keyword))
            .slice(0, 8);
    }, [presetList.data, presetSearch]);

    const handleSelectPreset = (preset: LLMInfo) => {
        setFormData({
            name: preset.name,
            input: preset.input.toString(),
            output: preset.output.toString(),
            cache_read: preset.cache_read.toString(),
            cache_write: preset.cache_write.toString(),
        });
        setPresetSearch(preset.name);
    };

    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!formData.name.trim()) return;

        createModel.mutate({
            name: formData.name.trim(),
            input: parseFloat(formData.input) || 0,
            output: parseFloat(formData.output) || 0,
            cache_read: parseFloat(formData.cache_read) || 0,
            cache_write: parseFloat(formData.cache_write) || 0,
        }, {
            onSuccess: () => {
                setFormData(createEmptyFormValues());
                setPresetSearch('');
                setIsOpen(false);
            }
        });
    };

    return (
        <div className="w-screen max-w-full md:max-w-xl">
            <MorphingDialogTitle>
                <header className="mb-5 flex items-center justify-between">
                    <div>
                        <h2 className="text-2xl font-bold text-card-foreground">
                            {isCopyMode ? t('copyTitle') : t('title')}
                        </h2>
                        {isCopyMode ? (
                            <p className="mt-1 text-sm text-muted-foreground">{t('copyDescription')}</p>
                        ) : null}
                    </div>
                    <MorphingDialogClose
                        className="relative right-0 top-0"
                        variants={{
                            initial: { opacity: 0, scale: 0.8 },
                            animate: { opacity: 1, scale: 1 },
                            exit: { opacity: 0, scale: 0.8 },
                        }}
                    />
                </header>
            </MorphingDialogTitle>
            <MorphingDialogDescription>
                <form onSubmit={handleSubmit}>
                    <FieldGroup className="gap-4">
                        {!isCopyMode ? (
                            <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
                                <label htmlFor="model-preset-search" className="text-xs font-medium text-muted-foreground">
                                    {t('presetLabel')}
                                </label>
                                <div className="mt-2 flex h-10 items-center gap-2 rounded-xl border border-border bg-background px-3">
                                    <Search className="size-4 shrink-0 text-muted-foreground" />
                                    <input
                                        id="model-preset-search"
                                        value={presetSearch}
                                        onChange={(e) => setPresetSearch(e.target.value)}
                                        placeholder={t('presetPlaceholder')}
                                        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                                    />
                                </div>
                                <div className="mt-2 max-h-48 overflow-y-auto pr-1">
                                    {presetList.isLoading ? (
                                        <div className="px-2 py-3 text-xs text-muted-foreground">{t('presetLoading')}</div>
                                    ) : presetList.isError ? (
                                        <div className="px-2 py-3 text-xs text-destructive">{t('presetLoadFailed')}</div>
                                    ) : filteredPresets.length > 0 ? (
                                        <div className="grid gap-1.5">
                                            {filteredPresets.map((preset) => (
                                                <button
                                                    key={preset.name}
                                                    type="button"
                                                    onClick={() => handleSelectPreset(preset)}
                                                    className="rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted"
                                                >
                                                    <div className="truncate text-sm font-medium text-card-foreground">{preset.name}</div>
                                                    <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                                        <span>{t('input')}: {preset.input}</span>
                                                        <span>{t('output')}: {preset.output}</span>
                                                        <span>{t('cacheRead')}: {preset.cache_read}</span>
                                                        <span>{t('cacheWrite')}: {preset.cache_write}</span>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="px-2 py-3 text-xs text-muted-foreground">{t('presetEmpty')}</div>
                                    )}
                                </div>
                            </div>
                        ) : null}
                        <Field>
                            <FieldLabel htmlFor="model-name">{t('name')}</FieldLabel>
                            <Input
                                id="model-name"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                className="rounded-xl"
                            />
                        </Field>
                        <div className="grid grid-cols-2 gap-4">
                            <Field>
                                <FieldLabel htmlFor="model-input">{t('input')}</FieldLabel>
                                <Input
                                    id="model-input"
                                    type="number"
                                    step="any"
                                    value={formData.input}
                                    onChange={(e) => setFormData({ ...formData, input: e.target.value })}
                                    className="rounded-xl"
                                />
                            </Field>
                            <Field>
                                <FieldLabel htmlFor="model-output">{t('output')}</FieldLabel>
                                <Input
                                    id="model-output"
                                    type="number"
                                    step="any"
                                    value={formData.output}
                                    onChange={(e) => setFormData({ ...formData, output: e.target.value })}
                                    className="rounded-xl"
                                />
                            </Field>
                            <Field>
                                <FieldLabel htmlFor="model-cache-read">{t('cacheRead')}</FieldLabel>
                                <Input
                                    id="model-cache-read"
                                    type="number"
                                    step="any"
                                    value={formData.cache_read}
                                    onChange={(e) => setFormData({ ...formData, cache_read: e.target.value })}
                                    className="rounded-xl"
                                />
                            </Field>
                            <Field>
                                <FieldLabel htmlFor="model-cache-write">{t('cacheWrite')}</FieldLabel>
                                <Input
                                    id="model-cache-write"
                                    type="number"
                                    step="any"
                                    value={formData.cache_write}
                                    onChange={(e) => setFormData({ ...formData, cache_write: e.target.value })}
                                    className="rounded-xl"
                                />
                            </Field>
                        </div>
                        <Button
                            type="submit"
                            disabled={createModel.isPending || !formData.name.trim()}
                            className="w-full rounded-xl h-11"
                        >
                            {createModel.isPending ? t('submitting') : t('submit')}
                        </Button>
                    </FieldGroup>
                </form>
            </MorphingDialogDescription>
        </div>
    );
}
