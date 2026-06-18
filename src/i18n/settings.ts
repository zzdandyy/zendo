import type { LanguageDetectorModule } from 'i18next';
import { useSettingsStore } from '../stores/settings-store';

/**
 * Custom i18next language detector that reads/writes the language preference
 * from the Zustand settings store (persisted to SQLite). This is a desktop
 * app — no URL, no browser navigator.language — so the store is the single
 * source of truth.
 *
 * When the persisted language is loaded later (loadSettings completes), the
 * store calls i18next.changeLanguage() to apply it.
 */
const detector: LanguageDetectorModule = {
  type: 'languageDetector' as const,
  detect() {
    return useSettingsStore.getState().lang;
  },
  cacheUserLanguage(lng: string) {
    const store = useSettingsStore.getState();
    if (store.lang !== lng) {
      store.setLang(lng as 'en' | 'zh');
    }
  },
};

export default detector;
