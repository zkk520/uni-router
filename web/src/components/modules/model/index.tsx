'use client';

import { useMemo, useState } from 'react';
import { Copy, Edit3, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useDeleteModel, useModelPage, useUpdateModel, type LLMInfo } from '@/api/endpoints/model';
import { AdminPagination, AdminTableShell, AdminToolbar } from '@/components/common/AdminTable';
import { ResizableColGroup, ResizableTableHead, useResizableColumns, type ResizableColumnConfig } from '@/components/common/ResizableTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import {
    MorphingDialog,
    MorphingDialogContainer,
    MorphingDialogContent,
    MorphingDialogTrigger,
    useMorphingDialog,
} from '@/components/ui/morphing-dialog';
import { CreateDialogContent } from './Create';
import { getModelIcon } from '@/lib/model-icons';
import { toast } from '@/components/common/Toast';

const modelTableColumns: ResizableColumnConfig[] = [
    { key: 'model', defaultWidth: 360, minWidth: 240, maxWidth: 640 },
    { key: 'provider', defaultWidth: 140, minWidth: 110, maxWidth: 220 },
    { key: 'input', defaultWidth: 112, minWidth: 96, maxWidth: 170 },
    { key: 'output', defaultWidth: 112, minWidth: 96, maxWidth: 170 },
    { key: 'cacheRead', defaultWidth: 116, minWidth: 100, maxWidth: 180 },
    { key: 'cacheWrite', defaultWidth: 116, minWidth: 100, maxWidth: 180 },
    { key: 'status', defaultWidth: 104, minWidth: 88, maxWidth: 150 },
    { key: 'actions', defaultWidth: 210, minWidth: 190, maxWidth: 300 },
];

type ProviderGroupKey = 'openai' | 'anthropic' | 'google' | 'deepseek' | 'xai' | 'alibaba' | 'other';

function getProviderKey(modelName: string): ProviderGroupKey {
    const normalized = modelName.includes('/') ? modelName.split('/').pop() ?? modelName : modelName;
    const name = normalized.toLowerCase();
    if (name.startsWith('gpt-') || name.startsWith('o1') || name.startsWith('o3') || name.startsWith('o4') || name.startsWith('openai') || name.startsWith('chatgpt') || name.startsWith('text-embedding')) return 'openai';
    if (name.startsWith('claude') || name.startsWith('anthropic')) return 'anthropic';
    if (name.startsWith('gemini') || name.startsWith('gemma') || name.startsWith('google')) return 'google';
    if (name.startsWith('deepseek')) return 'deepseek';
    if (name.startsWith('grok') || name.startsWith('xai')) return 'xai';
    if (name.startsWith('qwen') || name.startsWith('qwq') || name.startsWith('alibaba')) return 'alibaba';
    return 'other';
}

function providerLabel(provider: ProviderGroupKey) {
    const labels: Record<ProviderGroupKey, string> = {
        openai: 'OpenAI',
        anthropic: 'Anthropic',
        google: 'Google',
        deepseek: 'DeepSeek',
        xai: 'xAI',
        alibaba: 'Alibaba',
        other: 'Other',
    };
    return labels[provider];
}

function hasPricing(model: LLMInfo) {
    return model.input + model.output + model.cache_read + model.cache_write > 0;
}

function EditModelForm({ model }: { model: LLMInfo }) {
    const { setIsOpen } = useMorphingDialog();
    const t = useTranslations('model');
    const updateModel = useUpdateModel();
    const [form, setForm] = useState({
        input: String(model.input),
        output: String(model.output),
        cache_read: String(model.cache_read),
        cache_write: String(model.cache_write),
    });

    const save = () => {
        updateModel.mutate({
            name: model.name,
            input: parseFloat(form.input) || 0,
            output: parseFloat(form.output) || 0,
            cache_read: parseFloat(form.cache_read) || 0,
            cache_write: parseFloat(form.cache_write) || 0,
        }, {
            onSuccess: () => {
                toast.success(t('toast.updated'));
                setIsOpen(false);
            },
            onError: (error) => toast.error(t('toast.updateFailed'), { description: error.message }),
        });
    };

    return (
        <div className="grid w-[min(420px,calc(100vw-2rem))] gap-4">
            <div>
                <h3 className="text-lg font-semibold">编辑价格</h3>
                <p className="mt-1 truncate text-sm text-muted-foreground">{model.name}</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
                {(['input', 'output', 'cache_read', 'cache_write'] as const).map((key) => (
                    <label key={key} className="grid gap-1 text-xs text-muted-foreground">
                        {key}
                        <Input value={form[key]} onChange={(event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))} />
                    </label>
                ))}
            </div>
            <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsOpen(false)}>取消</Button>
                <Button onClick={save} disabled={updateModel.isPending}>保存</Button>
            </div>
        </div>
    );
}

export function Model() {
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [keyword, setKeyword] = useState('');
    const [provider, setProvider] = useState<string>('all');
    const [priced, setPriced] = useState<string>('all');
    const deleteModel = useDeleteModel();
    const t = useTranslations('model');

    const queryParams = useMemo(() => ({
        page,
        page_size: pageSize,
        keyword,
        provider,
        priced: priced === 'all' ? 'all' as const : priced === 'true',
        sort_by: 'name',
        sort_order: 'asc' as const,
    }), [keyword, page, pageSize, priced, provider]);
    const { data, isLoading, refetch } = useModelPage(queryParams);
    const rows = data?.items ?? [];
    const { widths, tableWidth, getResizeHandleProps } = useResizableColumns('model', modelTableColumns);

    return (
        <div className="flex h-full min-h-0 flex-col gap-4">
            <AdminToolbar
                search={keyword}
                searchPlaceholder="搜索模型..."
                onSearchChange={(value) => {
                    setKeyword(value);
                    setPage(1);
                }}
                onRefresh={() => refetch()}
                filters={[
                    {
                        label: '供应商',
                        value: provider,
                        onChange: (value) => {
                            setProvider(value);
                            setPage(1);
                        },
                        options: [
                            { value: 'all', label: '全部供应商' },
                            { value: 'openai', label: 'OpenAI' },
                            { value: 'anthropic', label: 'Anthropic' },
                            { value: 'google', label: 'Google' },
                            { value: 'deepseek', label: 'DeepSeek' },
                            { value: 'xai', label: 'xAI' },
                            { value: 'alibaba', label: 'Alibaba' },
                            { value: 'other', label: 'Other' },
                        ],
                    },
                    {
                        label: '计费',
                        value: priced,
                        onChange: (value) => {
                            setPriced(value);
                            setPage(1);
                        },
                        options: [
                            { value: 'all', label: '全部计费' },
                            { value: 'true', label: '已配置价格' },
                            { value: 'false', label: '免费/未配置' },
                        ],
                    },
                ]}
                action={(
                    <MorphingDialog>
                        <MorphingDialogTrigger className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90">
                            <Plus className="size-4" />
                            创建模型
                        </MorphingDialogTrigger>
                        <MorphingDialogContainer>
                            <MorphingDialogContent className="w-fit max-w-full rounded-lg bg-card px-6 py-4 text-card-foreground shadow-xl">
                                <CreateDialogContent />
                            </MorphingDialogContent>
                        </MorphingDialogContainer>
                    </MorphingDialog>
                )}
            />

            <AdminTableShell>
                <Table className="min-w-full table-fixed" style={{ width: `${tableWidth}px` }}>
                    <ResizableColGroup columns={modelTableColumns} widths={widths} />
                    <TableHeader className="sticky top-0 z-10 bg-muted/50">
                        <TableRow>
                            <ResizableTableHead columnKey="model" getResizeHandleProps={getResizeHandleProps}>模型</ResizableTableHead>
                            <ResizableTableHead columnKey="provider" getResizeHandleProps={getResizeHandleProps}>供应商</ResizableTableHead>
                            <ResizableTableHead columnKey="input" getResizeHandleProps={getResizeHandleProps}>输入</ResizableTableHead>
                            <ResizableTableHead columnKey="output" getResizeHandleProps={getResizeHandleProps}>输出</ResizableTableHead>
                            <ResizableTableHead columnKey="cacheRead" getResizeHandleProps={getResizeHandleProps}>缓存读</ResizableTableHead>
                            <ResizableTableHead columnKey="cacheWrite" getResizeHandleProps={getResizeHandleProps}>缓存写</ResizableTableHead>
                            <ResizableTableHead columnKey="status" getResizeHandleProps={getResizeHandleProps}>状态</ResizableTableHead>
                            <ResizableTableHead columnKey="actions" align="right" getResizeHandleProps={getResizeHandleProps}>操作</ResizableTableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableRow><TableCell colSpan={8} className="h-32 text-center text-muted-foreground">加载中...</TableCell></TableRow>
                        ) : rows.length === 0 ? (
                            <TableRow><TableCell colSpan={8} className="h-32 text-center text-muted-foreground">暂无模型</TableCell></TableRow>
                        ) : rows.map((model) => {
                            const { Avatar, color } = getModelIcon(model.name);
                            const providerKey = getProviderKey(model.name);
                            return (
                                <TableRow key={model.name}>
                                    <TableCell>
                                        <div className="flex min-w-0 items-center gap-3">
                                            <Avatar size={34} />
                                            <span className="truncate font-medium">{model.name}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell><Badge variant="secondary" style={{ color }}>{providerLabel(providerKey)}</Badge></TableCell>
                                    <TableCell className="font-mono">${model.input.toFixed(4)}</TableCell>
                                    <TableCell className="font-mono">${model.output.toFixed(4)}</TableCell>
                                    <TableCell className="font-mono">${model.cache_read.toFixed(4)}</TableCell>
                                    <TableCell className="font-mono">${model.cache_write.toFixed(4)}</TableCell>
                                    <TableCell>
                                        <Badge className={hasPricing(model) ? 'bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15' : 'bg-slate-500/15 text-slate-600 hover:bg-slate-500/15'}>
                                            {hasPricing(model) ? '已计费' : '未计费'}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center justify-end gap-1">
                                            <MorphingDialog>
                                                <MorphingDialogTrigger className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                                                    <Edit3 className="size-3.5" />
                                                    编辑
                                                </MorphingDialogTrigger>
                                                <MorphingDialogContainer>
                                                    <MorphingDialogContent className="rounded-lg bg-card p-5 text-card-foreground shadow-xl">
                                                        <EditModelForm model={model} />
                                                    </MorphingDialogContent>
                                                </MorphingDialogContainer>
                                            </MorphingDialog>
                                            <MorphingDialog>
                                                <MorphingDialogTrigger className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                                                    <Copy className="size-3.5" />
                                                    复制
                                                </MorphingDialogTrigger>
                                                <MorphingDialogContainer>
                                                    <MorphingDialogContent className="w-fit max-w-full rounded-lg bg-card px-6 py-4 text-card-foreground shadow-xl">
                                                        <CreateDialogContent initialValues={{ name: `${model.name}-copy`, input: String(model.input), output: String(model.output), cache_read: String(model.cache_read), cache_write: String(model.cache_write) }} />
                                                    </MorphingDialogContent>
                                                </MorphingDialogContainer>
                                            </MorphingDialog>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-8 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
                                                onClick={() => {
                                                    if (window.confirm(`删除模型 ${model.name}？`)) {
                                                        deleteModel.mutate(model.name, {
                                                            onSuccess: () => toast.success(t('toast.deleted')),
                                                            onError: (error) => toast.error(t('toast.deleteFailed'), { description: error.message }),
                                                        });
                                                    }
                                                }}
                                            >
                                                <Trash2 className="size-3.5" />
                                                删除
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </AdminTableShell>

            <AdminPagination
                page={data?.page ?? page}
                pageSize={data?.page_size ?? pageSize}
                total={data?.total ?? 0}
                onPageChange={setPage}
                onPageSizeChange={(value) => {
                    setPageSize(value);
                    setPage(1);
                }}
            />
        </div>
    );
}
