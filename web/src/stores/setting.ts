import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Locale = 'zh_hans' | 'zh_hant' | 'en';

interface SettingState {
    locale: Locale;
    advancedMotionEnabled: boolean;
    setLocale: (locale: Locale) => void;
    setAdvancedMotionEnabled: (enabled: boolean) => void;
}

export const useSettingStore = create<SettingState>()(
    persist(
        (set) => ({
            locale: 'zh_hans',
            advancedMotionEnabled: false,
            setLocale: (locale) => set({ locale }),
            setAdvancedMotionEnabled: (advancedMotionEnabled) => set({ advancedMotionEnabled }),
        }),
        {
            name: 'uni-router-settings',
        }
    )
);

