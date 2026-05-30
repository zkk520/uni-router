'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from "motion/react"
import { useTheme } from 'next-themes';
import { useAuth } from '@/api/endpoints/user';
import { LoginForm } from '@/components/modules/login';
import { APIKeyDashboard } from '@/components/modules/apikey-dashboard';
import { ContentLoader } from '@/route/content-loader';
import { NavBar, useNavStore } from '@/components/modules/navbar';
import { useTranslations } from 'next-intl'
import Logo, { LOGO_DRAW_END_MS } from '@/components/modules/logo';
import { ENTRANCE_VARIANTS } from '@/lib/animations/fluid-transitions';
import { useQueryClient } from '@tanstack/react-query';
import { CONTENT_MAP } from '@/route';
import { ROUTES } from '@/route/config';
import { apiClient } from '@/api/client';
import { logger } from '@/lib/logger';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { useSettingStore } from '@/stores/setting';
import { Languages, LogOut, Menu, Moon, Sun } from 'lucide-react';

function timeout(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

const pageDescriptions: Record<string, string> = {
    home: '查看请求、Token、成本与供应商表现。',
    channel: '管理供应商、协议、上游密钥和模型能力。',
    router: '配置路由策略、候选端点和绑定令牌。',
    model: '维护模型价格与计费配置。',
    log: '检索请求日志、路由尝试和响应详情。',
    token: '管理 API 访问令牌和路由绑定。',
    setting: '调整系统、账户、备份和外观配置。',
};

export function AppContainer() {
    const { isAuthenticated, isAPIKeyAuth, isLoading: authLoading, logout } = useAuth();
    const { activeItem, direction } = useNavStore();
    const t = useTranslations('navbar');
    const queryClient = useQueryClient();
    const { theme, setTheme } = useTheme();
    const { locale, setLocale } = useSettingStore();

    const [logoAnimationComplete, setLogoAnimationComplete] = useState(false);
    const [bootstrapComplete, setBootstrapComplete] = useState(false);
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const bootstrapStartedRef = useRef(false);

    useEffect(() => {
        const el = document.getElementById('initial-loader');
        if (!el) return;

        el.classList.add('octo-hide');
        const timer = setTimeout(() => el.remove(), 220);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => setLogoAnimationComplete(true), LOGO_DRAW_END_MS);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        if (authLoading) return;
        if (!isAuthenticated) {
            setBootstrapComplete(true);
            return;
        }

        if (bootstrapStartedRef.current) return;
        bootstrapStartedRef.current = true;

        let cancelled = false;

        (async () => {
            try {
                const prefetches: Array<Promise<unknown>> = [];

                if (isAPIKeyAuth) {
                    prefetches.push(
                        queryClient.prefetchQuery({
                            queryKey: ['apikey', 'dashboard', 'stats'],
                            queryFn: async () => apiClient.get('/api/v1/apikey/stats'),
                        })
                    );
                } else {
                    const component = CONTENT_MAP[activeItem];
                    if (component?.preload) {
                        prefetches.push(component.preload());
                    }

                    switch (activeItem) {
                        case 'home': {
                            prefetches.push(
                                queryClient.prefetchQuery({
                                    queryKey: ['stats', 'total'],
                                    queryFn: async () => apiClient.get('/api/v1/stats/total'),
                                })
                            );
                            prefetches.push(
                                queryClient.prefetchQuery({
                                    queryKey: ['stats', 'daily'],
                                    queryFn: async () => apiClient.get('/api/v1/stats/daily'),
                                })
                            );
                            prefetches.push(
                                queryClient.prefetchQuery({
                                    queryKey: ['stats', 'hourly'],
                                    queryFn: async () => apiClient.get('/api/v1/stats/hourly'),
                                })
                            );
                            prefetches.push(
                                queryClient.prefetchQuery({
                                    queryKey: ['channels', 'list'],
                                    queryFn: async () => apiClient.get('/api/v1/channel/list'),
                                })
                            );
                            break;
                        }
                        case 'channel': {
                            prefetches.push(
                                queryClient.prefetchQuery({
                                    queryKey: ['channels', 'page', { page: 1, page_size: 20 }],
                                    queryFn: async () => apiClient.get('/api/v1/channel/page', { page: 1, page_size: 20 }),
                                })
                            );
                            break;
                        }
                        case 'model': {
                            prefetches.push(
                                queryClient.prefetchQuery({
                                    queryKey: ['models', 'page', { page: 1, page_size: 20 }],
                                    queryFn: async () => apiClient.get('/api/v1/model/page', { page: 1, page_size: 20 }),
                                })
                            );
                            break;
                        }
                        case 'token': {
                            prefetches.push(
                                queryClient.prefetchQuery({
                                    queryKey: ['apikeys', 'page', { page: 1, page_size: 20 }],
                                    queryFn: async () => apiClient.get('/api/v1/apikey/page', { page: 1, page_size: 20 }),
                                })
                            );
                            break;
                        }
                        default:
                            break;
                    }
                }

                await Promise.race([
                    Promise.allSettled(prefetches),
                    timeout(5000),
                ]);
            } catch (e) {
                logger.warn('bootstrap prefetch failed:', e);
            } finally {
                if (!cancelled) setBootstrapComplete(true);
            }
        })();

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authLoading, isAuthenticated]);

    const isLoading =
        authLoading ||
        !logoAnimationComplete ||
        (isAuthenticated && !bootstrapComplete);

    const handleAdminLogout = () => {
        queryClient.clear();
        bootstrapStartedRef.current = false;
        setBootstrapComplete(false);
        logout();
    };

    const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');
    const toggleLanguage = () => {
        if (locale === 'zh_hans') setLocale('zh_hant');
        else if (locale === 'zh_hant') setLocale('en');
        else setLocale('zh_hans');
    };

    const activeRoute = ROUTES.find((route) => route.id === activeItem);

    if (isLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-background">
                <Logo size={120} animate />
            </div>
        );
    }

    if (isAPIKeyAuth) {
        return (
            <AnimatePresence mode="wait">
                <APIKeyDashboard key="apikey-dashboard" />
            </AnimatePresence>
        );
    }

    if (!isAuthenticated) {
        return (
            <AnimatePresence mode="wait">
                <LoginForm key="login" />
            </AnimatePresence>
        );
    }

    return (
        <motion.div
            key="main-app"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="flex h-dvh overflow-hidden bg-background text-foreground"
        >
            <div className="hidden shrink-0 md:block">
                <NavBar />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
                <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card/90 px-4 shadow-sm backdrop-blur md:px-6">
                    <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
                        <DialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="md:hidden">
                                <Menu className="size-5" />
                            </Button>
                        </DialogTrigger>
                        <DialogContent
                            className="left-0 top-0 h-dvh w-72 max-w-[85vw] translate-x-0 translate-y-0 rounded-none border-y-0 border-l-0 p-0 data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left"
                            showCloseButton={false}
                        >
                            <DialogTitle className="sr-only">导航</DialogTitle>
                            <NavBar onNavigate={() => setMobileNavOpen(false)} />
                        </DialogContent>
                    </Dialog>

                    <div className="min-w-0 flex-1">
                        <AnimatePresence mode="wait" custom={direction}>
                            <motion.div
                                key={activeItem}
                                custom={direction}
                                variants={{
                                    initial: (direction: number) => ({ y: 12 * direction, opacity: 0 }),
                                    animate: { y: 0, opacity: 1 },
                                    exit: (direction: number) => ({ y: -12 * direction, opacity: 0 }),
                                }}
                                initial="initial"
                                animate="animate"
                                exit="exit"
                                transition={{ duration: 0.18 }}
                            >
                                <h1 className="truncate text-xl font-bold tracking-tight">{t(activeItem)}</h1>
                                <p className="hidden truncate text-xs text-muted-foreground sm:block">
                                    {pageDescriptions[activeItem] ?? activeRoute?.label}
                                </p>
                            </motion.div>
                        </AnimatePresence>
                    </div>

                    <div className="ml-auto flex shrink-0 items-center gap-2">
                        <Button variant="ghost" size="icon" onClick={toggleTheme} className="rounded-lg">
                            <Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                            <Moon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={toggleLanguage} className="rounded-lg">
                            <Languages className="size-4" />
                        </Button>
                        <div className="hidden items-center gap-2 rounded-lg px-2 py-1.5 md:flex">
                            <div className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">AD</div>
                            <div className="leading-tight">
                                <div className="text-sm font-medium">admin</div>
                                <div className="text-xs text-muted-foreground">Admin</div>
                            </div>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleAdminLogout}
                            className="rounded-lg hover:bg-destructive/10 hover:text-destructive"
                            aria-label={t('logout')}
                            title={t('logout')}
                        >
                            <LogOut className="size-4" />
                        </Button>
                    </div>
                </header>

                <main className="min-h-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_28%_10%,oklch(0.92_0.04_185)_0%,transparent_34%),linear-gradient(180deg,oklch(0.97_0.015_190)_0%,var(--background)_42%)] p-4 md:p-6">
                    <AnimatePresence mode="wait" initial={false}>
                        <motion.div
                            key={activeItem}
                            variants={ENTRANCE_VARIANTS.content}
                            initial="initial"
                            animate="animate"
                            exit={{ opacity: 0, scale: 0.99 }}
                            transition={{ duration: 0.2 }}
                            className="h-full min-h-0"
                        >
                            <ContentLoader activeRoute={activeItem} />
                        </motion.div>
                    </AnimatePresence>
                </main>
            </div>
        </motion.div>
    );
}
