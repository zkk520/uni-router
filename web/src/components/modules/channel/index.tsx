'use client';

import { useMemo, useState } from 'react';
import { Edit3, Plus, Radio, Trash2 } from 'lucide-react';
import { useChannelPage, ChannelType, useEnableChannel, type Channel } from '@/api/endpoints/channel';
import { AdminPagination, AdminTableShell, AdminToolbar } from '@/components/common/AdminTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
    MorphingDialog,
    MorphingDialogContainer,
    MorphingDialogContent,
    MorphingDialogTrigger,
} from '@/components/ui/morphing-dialog';
import { CreateDialogContent } from './Create';
import { CardContent } from './CardContent';
import { cn } from '@/lib/utils';

function channelTypeLabel(type: ChannelType) {
    switch (type) {
        case ChannelType.OpenAIChat:
            return 'OpenAI Chat';
        case ChannelType.NewAPIChat:
            return 'OpenAI 兼容';
        case ChannelType.OpenAIResponse:
            return 'OpenAI Response';
        case ChannelType.Anthropic:
            return 'Anthropic';
        case ChannelType.Gemini:
            return 'Gemini';
        case ChannelType.Volcengine:
            return '火山引擎';
        case ChannelType.OpenAIEmbedding:
            return 'OpenAI Embedding';
        default:
            return String(type);
    }
}

function modelCount(channel: Channel) {
    const names = new Set<string>();
    const add = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean).forEach((item) => names.add(item));
    add(channel.model);
    add(channel.custom_model);
    for (const key of channel.keys) {
        for (const model of key.models ?? []) names.add(model);
    }
    return names.size;
}

export function Channel() {
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [keyword, setKeyword] = useState('');
    const [enabled, setEnabled] = useState<string>('all');
    const [type, setType] = useState<string>('all');
    const enableChannel = useEnableChannel();

    const queryParams = useMemo(() => ({
        page,
        page_size: pageSize,
        keyword,
        enabled: enabled === 'all' ? 'all' as const : enabled === 'true',
        type: type === 'all' ? 'all' as const : Number(type),
        sort_by: 'id',
        sort_order: 'desc' as const,
    }), [enabled, keyword, page, pageSize, type]);

    const { data, isLoading, refetch } = useChannelPage(queryParams);
    const rows = data?.items ?? [];

    return (
        <div className="flex h-full min-h-0 flex-col gap-4">
            <AdminToolbar
                search={keyword}
                searchPlaceholder="搜索供应商或模型..."
                onSearchChange={(value) => {
                    setKeyword(value);
                    setPage(1);
                }}
                onRefresh={() => refetch()}
                filters={[
                    {
                        label: '状态',
                        value: enabled,
                        onChange: (value) => {
                            setEnabled(value);
                            setPage(1);
                        },
                        options: [
                            { value: 'all', label: '全部状态' },
                            { value: 'true', label: '已启用' },
                            { value: 'false', label: '已停用' },
                        ],
                    },
                    {
                        label: '协议',
                        value: type,
                        onChange: (value) => {
                            setType(value);
                            setPage(1);
                        },
                        options: [
                            { value: 'all', label: '全部协议' },
                            { value: String(ChannelType.OpenAIChat), label: 'OpenAI Chat' },
                            { value: String(ChannelType.OpenAIResponse), label: 'OpenAI Response' },
                            { value: String(ChannelType.Anthropic), label: 'Anthropic' },
                            { value: String(ChannelType.Gemini), label: 'Gemini' },
                            { value: String(ChannelType.NewAPIChat), label: 'OpenAI 兼容' },
                        ],
                    },
                ]}
                action={(
                    <MorphingDialog>
                        <MorphingDialogTrigger className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90">
                            <Plus className="size-4" />
                            创建供应商
                        </MorphingDialogTrigger>
                        <MorphingDialogContainer>
                            <MorphingDialogContent className="max-h-[calc(100vh-2rem)] w-fit max-w-full overflow-hidden rounded-lg bg-card px-6 py-4 text-card-foreground shadow-xl">
                                <CreateDialogContent />
                            </MorphingDialogContent>
                        </MorphingDialogContainer>
                    </MorphingDialog>
                )}
            />

            <AdminTableShell>
                <Table>
                    <TableHeader className="sticky top-0 z-10 bg-muted/50">
                        <TableRow>
                            <TableHead className="min-w-52">名称</TableHead>
                            <TableHead>协议</TableHead>
                            <TableHead>密钥</TableHead>
                            <TableHead>模型</TableHead>
                            <TableHead>请求</TableHead>
                            <TableHead>成本</TableHead>
                            <TableHead>状态</TableHead>
                            <TableHead className="text-right">操作</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableRow><TableCell colSpan={8} className="h-32 text-center text-muted-foreground">加载中...</TableCell></TableRow>
                        ) : rows.length === 0 ? (
                            <TableRow><TableCell colSpan={8} className="h-32 text-center text-muted-foreground">暂无供应商</TableCell></TableRow>
                        ) : rows.map(({ raw: channel, formatted }) => (
                            <TableRow key={channel.id}>
                                <TableCell>
                                    <div className="flex min-w-0 items-center gap-2">
                                        <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                            <Radio className="size-4" />
                                        </span>
                                        <div className="min-w-0">
                                            <div className="truncate font-medium">{channel.name}</div>
                                            <div className="truncate text-xs text-muted-foreground">{channel.base_urls[0]?.url || '未配置 Base URL'}</div>
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell><Badge variant="secondary">{channelTypeLabel(channel.type)}</Badge></TableCell>
                                <TableCell>{channel.keys.filter((item) => item.enabled).length} / {channel.keys.length}</TableCell>
                                <TableCell>{modelCount(channel)}</TableCell>
                                <TableCell>{formatted.request_count.formatted.value}{formatted.request_count.formatted.unit}</TableCell>
                                <TableCell>{formatted.total_cost.formatted.value}{formatted.total_cost.formatted.unit}</TableCell>
                                <TableCell>
                                    <Badge className={cn(channel.enabled ? 'bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15' : 'bg-rose-500/15 text-rose-700 hover:bg-rose-500/15')}>
                                        {channel.enabled ? '正常' : '停用'}
                                    </Badge>
                                </TableCell>
                                <TableCell>
                                    <div className="flex items-center justify-end gap-2">
                                        <Switch
                                            checked={channel.enabled}
                                            onCheckedChange={(checked) => enableChannel.mutate({ id: channel.id, enabled: checked })}
                                            disabled={enableChannel.isPending}
                                        />
                                        <MorphingDialog>
                                            <MorphingDialogTrigger className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                                                <Edit3 className="size-3.5" />
                                                编辑
                                            </MorphingDialogTrigger>
                                            <MorphingDialogContainer>
                                                <MorphingDialogContent className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-card px-4 py-3 text-card-foreground shadow-xl">
                                                    <CardContent channel={channel} stats={formatted} />
                                                </MorphingDialogContent>
                                            </MorphingDialogContainer>
                                        </MorphingDialog>
                                        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" disabled>
                                            <Trash2 className="size-4" />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
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
