import common from './locales/en/common.json';
import settings from './locales/en/settings.json';
import hosts from './locales/en/hosts.json';

// Recursively convert nested object keys to dot-notation paths.
type DotKey<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : T[K] extends object
      ? DotKey<T[K], `${Prefix}${K}.`>
      : never;
}[keyof T & string];

// Namespace key unions derived from the English translation files.
export type CommonKey = DotKey<typeof common>;
export type SettingsKey = DotKey<typeof settings>;
export type HostsKey = DotKey<typeof hosts>;

declare module 'i18next' {
  interface CustomTypeOptions {
    resources: {
      common: typeof common;
      settings: typeof settings;
      hosts: typeof hosts;
    };
  }
}
