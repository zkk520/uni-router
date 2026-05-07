import { lazyWithPreload } from './lazy-with-preload';
import { lazy, ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Home, Radio, Sparkles, Cable, Settings, Logs } from 'lucide-react';

export type LazyComponent = ReturnType<typeof lazy> & {
    preload: () => Promise<{ default: ComponentType<Record<string, never>> }>
};

export interface RouteConfig {
    id: string;
    label: string;
    icon: LucideIcon;
    component: LazyComponent;
}

const Home_Module = lazyWithPreload(() => import('@/components/modules/home').then(m => ({ default: m.Home })));
const Channel_Module = lazyWithPreload(() => import('@/components/modules/channel').then(m => ({ default: m.Channel })));
const Model_Module = lazyWithPreload(() => import('@/components/modules/model').then(m => ({ default: m.Model })));
const Router_Module = lazyWithPreload(() => import('@/components/modules/router').then(m => ({ default: m.Router })));
const Log_Module = lazyWithPreload(() => import('@/components/modules/log').then(m => ({ default: m.Log })));
const Setting_Module = lazyWithPreload(() => import('@/components/modules/setting').then(m => ({ default: m.Setting })));

export const ROUTES: RouteConfig[] = [
    { id: 'home', label: '主页', icon: Home, component: Home_Module },
    { id: 'channel', label: '供应商', icon: Radio, component: Channel_Module },
    { id: 'router', label: '路由', icon: Cable, component: Router_Module },
    { id: 'model', label: '价格', icon: Sparkles, component: Model_Module },
    { id: 'log', label: '日志', icon: Logs, component: Log_Module },
    { id: 'setting', label: '设置', icon: Settings, component: Setting_Module },
];

export const CONTENT_MAP = ROUTES.reduce((acc, route) => {
    acc[route.id] = route.component;
    return acc;
}, {} as Record<string, LazyComponent>);
