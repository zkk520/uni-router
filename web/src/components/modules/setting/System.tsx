'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Monitor, Globe, Clock, Shield, HelpCircle, X, Server, Laptop, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { usePortsInfo, useSetPorts, useSettingList, useSetSetting, SettingKey, type PortConflictData } from '@/api/endpoints/setting';
import { toast } from '@/components/common/Toast';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/animate-ui/components/animate/tooltip';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { ApiError } from '@/api/types';

function isPortConflictData(value: unknown): value is PortConflictData {
    return typeof value === 'object'
        && value !== null
        && 'field' in value
        && 'recommended_port' in value
        && typeof (value as PortConflictData).recommended_port === 'number';
}

function parsePort(value: string) {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return port;
}

export function SettingSystem() {
    const t = useTranslations('setting');
    const { data: settings } = useSettingList();
    const { data: portsInfo } = usePortsInfo();
    const setSetting = useSetSetting();
    const setPorts = useSetPorts();

    const [proxyUrl, setProxyUrl] = useState('');
    const [statsSaveInterval, setStatsSaveInterval] = useState('');
    const [corsAllowOrigins, setCorsAllowOrigins] = useState('');
    const [corsInputValue, setCorsInputValue] = useState('');
    const [backendPort, setBackendPort] = useState('');
    const [frontendPort, setFrontendPort] = useState('');
    const [confirmPortsOpen, setConfirmPortsOpen] = useState(false);
    const [portConflict, setPortConflict] = useState<PortConflictData | null>(null);

    const initialProxyUrl = useRef('');
    const initialStatsSaveInterval = useRef('');
    const initialCorsAllowOrigins = useRef('');
    const initialBackendPort = useRef('');
    const initialFrontendPort = useRef('');

    useEffect(() => {
        if (settings) {
            const proxy = settings.find(s => s.key === SettingKey.ProxyURL);
            const interval = settings.find(s => s.key === SettingKey.StatsSaveInterval);
            const cors = settings.find(s => s.key === SettingKey.CORSAllowOrigins);
            if (proxy) {
                queueMicrotask(() => setProxyUrl(proxy.value));
                initialProxyUrl.current = proxy.value;
            }
            if (interval) {
                queueMicrotask(() => setStatsSaveInterval(interval.value));
                initialStatsSaveInterval.current = interval.value;
            }
            if (cors) {
                queueMicrotask(() => setCorsAllowOrigins(cors.value));
                initialCorsAllowOrigins.current = cors.value;
            }
        }
    }, [settings]);

    useEffect(() => {
        if (!portsInfo) return;
        const backend = String(portsInfo.backend_port);
        const frontend = String(portsInfo.frontend_port);
        queueMicrotask(() => {
            setBackendPort(backend);
            setFrontendPort(frontend);
        });
        initialBackendPort.current = backend;
        initialFrontendPort.current = frontend;
    }, [portsInfo]);

    const handleSave = (key: string, value: string, initialValue: string) => {
        if (value === initialValue) return;

        setSetting.mutate({ key, value }, {
            onSuccess: () => {
                toast.success(t('saved'));
                if (key === SettingKey.ProxyURL) {
                    initialProxyUrl.current = value;
                } else if (key === SettingKey.StatsSaveInterval) {
                    initialStatsSaveInterval.current = value;
                } else if (key === SettingKey.CORSAllowOrigins) {
                    initialCorsAllowOrigins.current = value;
                }
            }
        });
    };

    const corsAllowOriginsList = useMemo(() => {
        const value = corsAllowOrigins.trim();
        if (!value) return [];
        if (value === '*') return ['*'];
        return Array.from(new Set(
            value
                .split(/[,\n，]/)
                .map(item => item.trim())
                .filter(Boolean)
        ));
    }, [corsAllowOrigins]);

    const corsAllowOriginsDisplay = useMemo(
        () => (corsAllowOriginsList.length > 0 ? corsAllowOriginsList.join(', ') : t('corsAllowOrigins.hint')),
        [corsAllowOriginsList, t]
    );

    const saveCorsAllowOrigins = (origins: string[]) => {
        const normalizedOrigins = Array.from(new Set(
            origins
                .map(origin => origin.trim())
                .filter(Boolean)
        ));
        const normalizedValue = normalizedOrigins.includes('*') ? '*' : normalizedOrigins.join(',');
        setCorsAllowOrigins(normalizedValue);
        handleSave(SettingKey.CORSAllowOrigins, normalizedValue, initialCorsAllowOrigins.current);
    };

    const handleAddCorsOrigin = () => {
        const newOrigins = Array.from(new Set(
            corsInputValue
                .split(/[,\n，]/)
                .map(item => item.trim())
                .filter(Boolean)
        ));
        if (newOrigins.length === 0) return;

        if (newOrigins.includes('*')) {
            saveCorsAllowOrigins(['*']);
            setCorsInputValue('');
            return;
        }

        const base = corsAllowOriginsList.includes('*') ? [] : corsAllowOriginsList;
        const merged = Array.from(new Set([...base, ...newOrigins]));
        saveCorsAllowOrigins(merged);
        setCorsInputValue('');
    };

    const handleRemoveCorsOrigin = (originToRemove: string) => {
        const nextOrigins = corsAllowOriginsList.filter(origin => origin !== originToRemove);
        saveCorsAllowOrigins(nextOrigins);
    };

    const portsChanged = backendPort !== initialBackendPort.current
        || (portsInfo?.frontend_port_configurable && frontendPort !== initialFrontendPort.current);

    const buildPortsPayload = () => {
        const parsedBackendPort = parsePort(backendPort);
        const parsedFrontendPort = parsePort(frontendPort);
        if (!parsedBackendPort) {
            toast.error(t('ports.invalidBackend'));
            return null;
        }
        if (portsInfo?.frontend_port_configurable && !parsedFrontendPort) {
            toast.error(t('ports.invalidFrontend'));
            return null;
        }
        return {
            backend_port: parsedBackendPort,
            frontend_port: parsedFrontendPort ?? portsInfo?.frontend_port ?? 3000,
            restart: true,
        };
    };

    const handlePreparePortSave = () => {
        if (!portsChanged) return;
        if (!buildPortsPayload()) return;
        setConfirmPortsOpen(true);
    };

    const handleConfirmPortSave = () => {
        const payload = buildPortsPayload();
        if (!payload) return;

        setPortConflict(null);
        setPorts.mutate(payload, {
            onSuccess: (data) => {
                setConfirmPortsOpen(false);
                initialBackendPort.current = String(data.backend_port);
                initialFrontendPort.current = String(data.frontend_port);
                toast.success(t('ports.restartSuccess'));
                const targetURL = data.debug && data.frontend_port_configurable ? data.frontend_url : data.backend_url;
                window.setTimeout(() => {
                    window.location.href = targetURL;
                }, data.backend_restarting ? 1800 : 800);
            },
            onError: (error) => {
                const apiError = error as unknown as ApiError;
                if (apiError.code === 409 && isPortConflictData(apiError.data)) {
                    setPortConflict(apiError.data);
                    toast.warning(t('ports.conflict'), {
                        description: t('ports.recommended', { port: apiError.data.recommended_port }),
                    });
                    return;
                }
                toast.error(apiError.message || t('ports.saveFailed'));
            }
        });
    };

    const handleUseRecommendedPort = () => {
        if (!portConflict) return;
        const value = String(portConflict.recommended_port);
        if (portConflict.field === 'backend_port') {
            setBackendPort(value);
        } else {
            setFrontendPort(value);
        }
        setPortConflict(null);
    };

    return (
        <div className="rounded-3xl border border-border bg-card p-6 space-y-5">
            <h2 className="text-lg font-bold text-card-foreground flex items-center gap-2">
                <Monitor className="h-5 w-5" />
                {t('system')}
            </h2>

            {/* 运行端口 */}
            <div className="space-y-3 rounded-2xl border border-border/60 p-4">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <Server className="h-5 w-5 text-muted-foreground" />
                        <span className="text-sm font-medium">{t('ports.backend.label')}</span>
                    </div>
                    <Input
                        type="number"
                        min={1}
                        max={65535}
                        value={backendPort}
                        onChange={(e) => setBackendPort(e.target.value)}
                        placeholder={t('ports.backend.placeholder')}
                        className="w-48 rounded-xl"
                    />
                </div>

                {portsInfo?.frontend_port_configurable && (
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <Laptop className="h-5 w-5 text-muted-foreground" />
                            <span className="text-sm font-medium">{t('ports.frontend.label')}</span>
                        </div>
                        <Input
                            type="number"
                            min={1}
                            max={65535}
                            value={frontendPort}
                            onChange={(e) => setFrontendPort(e.target.value)}
                            placeholder={t('ports.frontend.placeholder')}
                            className="w-48 rounded-xl"
                        />
                    </div>
                )}

                {portConflict && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
                        <span className="text-destructive">
                            {t('ports.conflictWithPort', { port: portConflict.port, recommended: portConflict.recommended_port })}
                        </span>
                        <Button type="button" size="sm" variant="outline" onClick={handleUseRecommendedPort}>
                            {t('ports.useRecommended')}
                        </Button>
                    </div>
                )}

                <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">
                        {portsInfo?.frontend_port_configurable ? t('ports.devHint') : t('ports.productionHint')}
                    </span>
                    <Button
                        type="button"
                        size="sm"
                        onClick={handlePreparePortSave}
                        disabled={!portsChanged || setPorts.isPending}
                    >
                        {setPorts.isPending && <Loader2 className="size-4 animate-spin" />}
                        {t('ports.saveAndRestart')}
                    </Button>
                </div>
            </div>

            {/* 代理地址 */}
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <Globe className="h-5 w-5 text-muted-foreground" />
                    <span className="text-sm font-medium">{t('proxyUrl.label')}</span>
                </div>
                <Input
                    value={proxyUrl}
                    onChange={(e) => setProxyUrl(e.target.value)}
                    onBlur={() => handleSave('proxy_url', proxyUrl, initialProxyUrl.current)}
                    placeholder={t('proxyUrl.placeholder')}
                    className="w-48 rounded-xl"
                />
            </div>

            {/* 统计保存周期 */}
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <Clock className="h-5 w-5 text-muted-foreground" />
                    <span className="text-sm font-medium">{t('statsSaveInterval.label')}</span>
                </div>
                <Input
                    type="number"
                    value={statsSaveInterval}
                    onChange={(e) => setStatsSaveInterval(e.target.value)}
                    onBlur={() => handleSave('stats_save_interval', statsSaveInterval, initialStatsSaveInterval.current)}
                    placeholder={t('statsSaveInterval.placeholder')}
                    className="w-48 rounded-xl"
                />
            </div>

            {/* CORS 跨域白名单 */}
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <Shield className="h-5 w-5 text-muted-foreground" />
                    <span className="text-sm font-medium">{t('corsAllowOrigins.label')}</span>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <HelpCircle className="size-4 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent>
                                {t('corsAllowOrigins.hint')}
                                <br />
                                {t('corsAllowOrigins.example')}
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
                <Popover>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            className="border-input focus-visible:border-ring focus-visible:ring-ring/50 w-48 min-h-9 rounded-xl border bg-transparent px-3 py-2 text-left text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]"
                            title={corsAllowOriginsDisplay}
                        >
                            <span className={`block overflow-hidden text-ellipsis whitespace-nowrap ${corsAllowOriginsList.length === 0 ? 'text-muted-foreground' : ''}`}>
                                {corsAllowOriginsDisplay}
                            </span>
                        </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 space-y-2 rounded-3xl p-3 bg-card">
                        <Input
                            value={corsInputValue}
                            onChange={(e) => setCorsInputValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleAddCorsOrigin();
                                }
                            }}
                            placeholder={t('corsAllowOrigins.example')}
                            className="h-9 rounded-xl"
                            autoFocus
                        />
                        <div className="max-h-48 space-y-1 overflow-y-auto">
                            {corsAllowOriginsList.length > 0 && (
                                corsAllowOriginsList.map((origin) => (
                                    <div key={origin} className="flex items-center justify-between gap-2 rounded-xl border border-border/60 px-2 py-1">
                                        <span className="break-all text-xs leading-5">{origin}</span>
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveCorsOrigin(origin)}
                                            className="text-muted-foreground transition-colors hover:text-destructive"
                                            aria-label={`remove ${origin}`}
                                        >
                                            <X className="size-4" />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </PopoverContent>
                </Popover>
            </div>

            <AlertDialog open={confirmPortsOpen} onOpenChange={setConfirmPortsOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('ports.confirmTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('ports.confirmDescription')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={setPorts.isPending}>{t('ports.cancel')}</AlertDialogCancel>
                        <AlertDialogAction onClick={handleConfirmPortSave} disabled={setPorts.isPending}>
                            {setPorts.isPending ? t('ports.restarting') : t('ports.confirm')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
