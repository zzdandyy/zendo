import { useTranslation } from "react-i18next";
import { Monitor, Settings, ArrowLeftRight } from "lucide-react";
import { useUiStore, type HomePage } from "../../stores/ui-store";
import { TransferPage } from "../transfer/TransferPage";
import { HostsDashboard } from "../dashboard";
import { SettingsPage } from "../settings";
import type { PaneSource } from "../../stores/tab-store";

// ─── Nav items ───────────────────────────────────────────────────────────────

interface NavItem {
  id: HomePage;
  icon: React.ElementType;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "hosts", icon: Monitor, label: "common:nav.hosts" },
  { id: "transfer", icon: ArrowLeftRight, label: "common:nav.transfers" },
];

// ─── Page content ────────────────────────────────────────────────────────────

function PageContent({ page }: { page: HomePage }) {
  switch (page) {
    case "hosts":
      return <HostsDashboard />;
    case "transfer":
      return <TransferPageHome />;
    case "settings":
      return <SettingsPage />;
  }
}

// ─── TransferPage wrapper (standalone, no tab) ───────────────────────────────

const DEFAULT_LEFT: PaneSource = { type: "local" };

function TransferPageHome() {
  const pendingRight = useUiStore((s) => s.pendingTransferRight);
  const clearPending = useUiStore((s) => s.setPendingTransferRight);
  const persistedLeft = useUiStore((s) => s.transferLeftSource);
  const persistedRight = useUiStore((s) => s.transferRightSource);

  // pendingRight (from "File Browse" on a host card) wins over persisted.
  const initialRight = pendingRight ?? persistedRight ?? null;
  const initialLeft = persistedLeft ?? DEFAULT_LEFT;

  // Clear the pending source after reading it.
  if (pendingRight) {
    queueMicrotask(() => clearPending(null));
  }

  return (
    <TransferPage
      left={initialLeft}
      right={initialRight}
      standalone
    />
  );
}

// ─── Nav button ──────────────────────────────────────────────────────────────

function NavButton({
  icon: Icon,
  label,
  isActive,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-left",
        "transition-colors duration-[var(--duration-fast)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isActive
          ? "text-accent bg-accent-muted"
          : "text-text-muted hover:text-text-secondary hover:bg-bg-overlay",
      ].join(" ")}
    >
      <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
      <span className="text-[length:var(--text-sm)] font-medium">{label}</span>
    </button>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function HomePanel() {
  const { t } = useTranslation();
  const homeActivePage = useUiStore((s) => s.homeActivePage);
  const setHomePage = useUiStore((s) => s.setHomePage);

  return (
    <div className="flex h-full bg-bg-base pt-2">
      {/* ── Left nav rail ── */}
      <div className="flex flex-col gap-1 w-40 shrink-0 py-3 px-2 bg-bg-surface/40 rounded-xl mr-2">
        {/* Page nav */}
        {NAV_ITEMS.map((item) => (
          <NavButton
            key={item.id}
            icon={item.icon}
            label={t(item.label)}
            isActive={homeActivePage === item.id}
            onClick={() => setHomePage(item.id)}
          />
        ))}

        <div className="flex-1" />

        {/* Settings */}
        <NavButton
          icon={Settings}
          label={t('common:nav.settings')}
          isActive={homeActivePage === "settings"}
          onClick={() => setHomePage("settings")}
        />
      </div>

      {/* ── Page content ── */}
      <div className="flex-1 min-w-0">
        <PageContent page={homeActivePage} />
      </div>
    </div>
  );
}
