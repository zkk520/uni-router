export const SW_MESSAGE_TYPE = {
    SKIP_WAITING: 'SKIP_WAITING',
    CLEAR_CACHE: 'CLEAR_CACHE',
    CACHE_CLEARED: 'CACHE_CLEARED',
} as const;

export type SwMessageType = (typeof SW_MESSAGE_TYPE)[keyof typeof SW_MESSAGE_TYPE];

// Keep in sync with `web/public/sw.js`
export const UNI_ROUTER_CACHE_PREFIX = 'uni-router-';
// Font cache is version-independent and should persist across updates
export const UNI_ROUTER_FONT_CACHE_NAME = 'uni-router-font';

export function isUniRouterCacheName(name: string) {
    return name.startsWith(UNI_ROUTER_CACHE_PREFIX);
}

export function isFontCacheName(name: string) {
    return name === UNI_ROUTER_FONT_CACHE_NAME;
}

