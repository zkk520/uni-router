'use client';

import { useMemo, useState } from 'react';
import { ClipboardPaste, FileJson, Upload } from 'lucide-react';
import { useChannelList } from '@/api/endpoints/channel';
import {
    type PriceImportRule,
    type PriceRuleScope,
    useApplyPriceImport,
    useParsePriceImport,
    usePriceRuleList,
} from '@/api/endpoints/price';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/common/Toast';

type Template = 'auto' | 'standard_json' | 'new_api_text' | 'generic_table';

const scopeLabels: Record<PriceRuleScope, string> = {
    global: '全局兜底',
    channel: '供应商渠道',
    channel_key: '具体 API key',
    provider_group: '供应商分组',
};

const ruleKey = (rule: PriceImportRule, index: number) => `${rule.model_name}::${rule.group_name}::${index}`;

export function PriceImportDialog() {
    const [open, setOpen] = useState(false);
    const [template, setTemplate] = useState<Template>('auto');
    const [content, setContent] = useState('');
    const [scopeType, setScopeType] = useState<PriceRuleScope>('channel_key');
    const [scopeID, setScopeID] = useState('');
    const [providerName, setProviderName] = useState('');
    const [parsedRules, setParsedRules] = useState<PriceImportRule[]>([]);
    const [selectedRuleKeys, setSelectedRuleKeys] = useState<string[]>([]);
    const [warnings, setWarnings] = useState<string[]>([]);

    const { data: channels = [] } = useChannelList();
    const { data: existingRules = [] } = usePriceRuleList();
    const parseImport = useParsePriceImport();
    const applyImport = useApplyPriceImport();

    const targetOptions = useMemo(() => {
        if (scopeType === 'channel') {
            return channels.map(({ raw }) => ({
                value: String(raw.id),
                label: raw.name,
            }));
        }
        if (scopeType === 'channel_key') {
            return channels.flatMap(({ raw }) =>
                raw.keys.map((key) => ({
                    value: String(key.id),
                    label: `${raw.name} / ${key.remark || `key ${key.id}`}`,
                }))
            );
        }
        return [];
    }, [channels, scopeType]);

    const selectedRules = useMemo(() => {
        const selected = new Set(selectedRuleKeys);
        return parsedRules.filter((rule, index) => selected.has(ruleKey(rule, index)));
    }, [parsedRules, selectedRuleKeys]);

    const conflictSummary = useMemo(() => {
        const rules = selectedRules;
        if (rules.length === 0) return { create: 0, overwrite: 0 };
        const selectedScopeID = Number(scopeID) || 0;
        let overwrite = 0;
        for (const rule of rules) {
            if (existingRules.some((item) =>
                item.scope_type === scopeType &&
                item.scope_id === selectedScopeID &&
                item.model_name.toLowerCase() === rule.model_name.toLowerCase() &&
                (scopeType !== 'provider_group' || item.group_name === rule.group_name)
            )) {
                overwrite += 1;
            }
        }
        return { create: rules.length - overwrite, overwrite };
    }, [existingRules, scopeID, scopeType, selectedRules]);

    const handleParse = () => {
        if (!content.trim()) {
            toast.warning('请先粘贴价格页面内容');
            return;
        }
        parseImport.mutate({ template, content }, {
            onSuccess: (result) => {
                setParsedRules(result.rules);
                setSelectedRuleKeys(result.rules.map((rule, index) => ruleKey(rule, index)));
                setWarnings(result.warnings ?? []);
                if (result.rules.length === 0) {
                    toast.warning('没有解析出价格规则');
                } else {
                    toast.success(`已解析 ${result.rules.length} 条价格规则`);
                }
            },
            onError: (error) => {
                toast.error('解析失败', { description: error instanceof Error ? error.message : String(error) });
            },
        });
    };

    const handleApply = () => {
        if (selectedRules.length === 0) {
            toast.warning('请先解析价格规则');
            return;
        }
        const resolvedScopeID = Number(scopeID) || 0;
        if ((scopeType === 'channel' || scopeType === 'channel_key') && resolvedScopeID <= 0) {
            toast.warning('请选择绑定目标');
            return;
        }
        const rules = selectedRules.map((rule) => ({
            ...rule,
            provider_name: providerName.trim() || rule.provider_name,
        }));
        applyImport.mutate({ scope_type: scopeType, scope_id: resolvedScopeID, rules }, {
            onSuccess: (saved) => {
                toast.success(`已导入 ${saved.length} 条价格规则`);
                setOpen(false);
            },
            onError: (error) => {
                toast.error('导入失败', { description: error instanceof Error ? error.message : String(error) });
            },
        });
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 rounded-xl gap-2">
                    <Upload className="size-4" />
                    价格导入
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-5xl max-h-[calc(100vh-2rem)] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FileJson className="size-5" />
                        价格规则导入
                    </DialogTitle>
                    <DialogDescription>
                        粘贴公开价格页文本、HTML 或 price_import_v1 JSON，解析后绑定到渠道或具体 API key。
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 overflow-auto pr-1">
                    <FieldGroup className="gap-4">
                        <div className="grid gap-4 md:grid-cols-4">
                            <Field>
                                <FieldLabel>解析模板</FieldLabel>
                                <Select value={template} onValueChange={(value) => setTemplate(value as Template)}>
                                    <SelectTrigger className="rounded-xl">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl">
                                        <SelectItem value="auto">自动识别</SelectItem>
                                        <SelectItem value="standard_json">标准 JSON</SelectItem>
                                        <SelectItem value="new_api_text">New API 类文本</SelectItem>
                                        <SelectItem value="generic_table">通用表格</SelectItem>
                                    </SelectContent>
                                </Select>
                            </Field>
                            <Field>
                                <FieldLabel>绑定层级</FieldLabel>
                                <Select value={scopeType} onValueChange={(value) => {
                                    setScopeType(value as PriceRuleScope);
                                    setScopeID('');
                                }}>
                                    <SelectTrigger className="rounded-xl">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl">
                                        {Object.entries(scopeLabels).map(([value, label]) => (
                                            <SelectItem key={value} value={value}>{label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </Field>
                            {(scopeType === 'channel' || scopeType === 'channel_key') && (
                                <Field>
                                    <FieldLabel>绑定目标</FieldLabel>
                                    <Select value={scopeID} onValueChange={setScopeID}>
                                        <SelectTrigger className="rounded-xl">
                                            <SelectValue placeholder="选择目标" />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-xl">
                                            {targetOptions.map((option) => (
                                                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </Field>
                            )}
                            <Field>
                                <FieldLabel>供应商名称</FieldLabel>
                                <Input
                                    value={providerName}
                                    onChange={(event) => setProviderName(event.target.value)}
                                    placeholder="例如：星辰AI"
                                    className="rounded-xl"
                                />
                            </Field>
                        </div>

                        <Field>
                            <FieldLabel>页面内容</FieldLabel>
                            <textarea
                                value={content}
                                onChange={(event) => setContent(event.target.value)}
                                placeholder="粘贴价格页文本、HTML、表格复制内容或 price_import_v1 JSON"
                                className="min-h-48 w-full resize-y rounded-xl border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            />
                        </Field>
                    </FieldGroup>

                    <div className="flex flex-wrap items-center gap-2">
                        <Button type="button" onClick={handleParse} disabled={parseImport.isPending} className="rounded-xl gap-2">
                            <ClipboardPaste className="size-4" />
                            {parseImport.isPending ? '解析中' : '解析预览'}
                        </Button>
                        {parsedRules.length > 0 && (
                            <span className="text-sm text-muted-foreground">
                                已选 {selectedRules.length} 条，新增 {conflictSummary.create} 条，可能覆盖 {conflictSummary.overwrite} 条
                            </span>
                        )}
                    </div>

                    {warnings.length > 0 && (
                        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
                            {warnings.slice(0, 4).map((warning) => <div key={warning}>{warning}</div>)}
                        </div>
                    )}

                    {parsedRules.length > 0 && (
                        <div className="overflow-auto rounded-xl border">
                            <table className="w-full min-w-[880px] text-sm">
                                <thead className="bg-muted/60 text-muted-foreground">
                                    <tr>
                                        <th className="px-3 py-2 text-left font-medium">选择</th>
                                        <th className="px-3 py-2 text-left font-medium">模型</th>
                                        <th className="px-3 py-2 text-left font-medium">分组</th>
                                        <th className="px-3 py-2 text-left font-medium">币种</th>
                                        <th className="px-3 py-2 text-right font-medium">输入</th>
                                        <th className="px-3 py-2 text-right font-medium">输出</th>
                                        <th className="px-3 py-2 text-right font-medium">缓存读</th>
                                        <th className="px-3 py-2 text-right font-medium">缓存写</th>
                                        <th className="px-3 py-2 text-right font-medium">倍率</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {parsedRules.map((rule, index) => (
                                        <tr key={ruleKey(rule, index)} className="border-t">
                                            <td className="px-3 py-2">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedRuleKeys.includes(ruleKey(rule, index))}
                                                    onChange={(event) => {
                                                        const key = ruleKey(rule, index);
                                                        setSelectedRuleKeys((current) =>
                                                            event.target.checked
                                                                ? [...current, key]
                                                                : current.filter((item) => item !== key)
                                                        );
                                                    }}
                                                    className="size-4 rounded border-border"
                                                />
                                            </td>
                                            <td className="px-3 py-2 font-medium">{rule.model_name}</td>
                                            <td className="px-3 py-2">{rule.group_name || '-'}</td>
                                            <td className="px-3 py-2">{rule.currency}</td>
                                            <td className="px-3 py-2 text-right">{rule.input_price}</td>
                                            <td className="px-3 py-2 text-right">{rule.output_price}</td>
                                            <td className="px-3 py-2 text-right">{rule.cache_read_price}</td>
                                            <td className="px-3 py-2 text-right">{rule.cache_write_price}</td>
                                            <td className="px-3 py-2 text-right">{rule.multiplier || 1}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" className="rounded-xl" onClick={() => setOpen(false)}>
                        取消
                    </Button>
                    <Button type="button" className="rounded-xl" onClick={handleApply} disabled={applyImport.isPending || selectedRules.length === 0}>
                        {applyImport.isPending ? '导入中' : '确认导入'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
