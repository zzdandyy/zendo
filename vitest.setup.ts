import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Mock react-i18next so tests don't need their own i18n setup.
// t() returns a string that includes both the key and any interpolation
// values, so tests can distinguish between different call sites.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (!opts || Object.keys(opts).length === 0) return key;
      const entries = Object.entries(opts);
      if (entries.length === 1 && entries[0][0] === "count") {
        // ICU plural: "Copy {count} items" → "Copy 5 items"
        return key.replace(/\{count[^}]*\}/g, String(entries[0][1]));
      }
      // General interpolation: return key + sorted params
      const paramStr = entries
        .map(([k, v]) => `${k}=${v}`)
        .sort()
        .join(",");
      return `${key}[${paramStr}]`;
    },
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

// Unmount React trees between tests so the DOM/listeners don't leak across specs.
afterEach(() => {
  cleanup();
});
