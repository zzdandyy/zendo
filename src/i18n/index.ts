import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import ICU from 'i18next-icu';
import detector from './settings';
import common_en from './locales/en/common.json';
import settings_en from './locales/en/settings.json';
import hosts_en from './locales/en/hosts.json';
import common_zh from './locales/zh/common.json';
import settings_zh from './locales/zh/settings.json';
import hosts_zh from './locales/zh/hosts.json';

let initialized = false;

/** Initialise i18next. Idempotent — safe to call multiple times. */
export function initI18n(): Promise<void> {
  if (initialized) return Promise.resolve();
  initialized = true;
  return i18next
    .use(ICU)
    .use(detector)
    .use(initReactI18next)
    .init({
      resources: {
        en: { common: common_en, settings: settings_en, hosts: hosts_en },
        zh: { common: common_zh, settings: settings_zh, hosts: hosts_zh },
      },
      fallbackLng: 'en',
      defaultNS: 'common',
      ns: ['common', 'settings', 'hosts'],
      interpolation: {
        escapeValue: false, // React already escapes
      },
      returnNull: false,
    }).then(() => { /* void */ });
}

export default i18next;
