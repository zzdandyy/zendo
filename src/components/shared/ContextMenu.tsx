import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";

export interface ContextMenuItem {
  label: string;
  icon?: React.ElementType;
  /** Leaf action. Omitted for items that only open a `submenu`. */
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Render a separator line above this item */
  separator?: boolean;
  /** Nested items — turns this row into a flyout submenu. */
  submenu?: ContextMenuItem[];
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  position: { x: number; y: number };
  onClose: () => void;
}

// ─── Viewport-aware positioning ───────────────────────────────────────────────

const MENU_WIDTH = 180;
const ESTIMATED_ITEM_HEIGHT = 32; // px per item
const PADDING_V = 8; // top + bottom padding

function clampPosition(
  x: number,
  y: number,
  itemCount: number,
): { x: number; y: number } {
  const menuHeight = itemCount * ESTIMATED_ITEM_HEIGHT + PADDING_V;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const clampedX = x + MENU_WIDTH > vw ? vw - MENU_WIDTH - 8 : x;
  const clampedY = y + menuHeight > vh ? vh - menuHeight - 8 : y;

  return { x: Math.max(8, clampedX), y: Math.max(8, clampedY) };
}

// ─── Item ──────────────────────────────────────────────────────────────────────

function MenuRow({ item, onClose }: { item: ContextMenuItem; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const [subTop, setSubTop] = useState<number | undefined>(undefined);
  const hasSubmenu = !!item.submenu && item.submenu.length > 0;
  const Icon = item.icon;

  useLayoutEffect(() => {
    if (open && ref.current) {
      setFlip(ref.current.getBoundingClientRect().right + MENU_WIDTH > window.innerWidth);
    }
    if (open && subRef.current) {
      const r = subRef.current.getBoundingClientRect();
      if (r.bottom > window.innerHeight) {
        setSubTop(window.innerHeight - r.bottom - 8);
      } else {
        setSubTop(undefined);
      }
    }
  }, [open, item.submenu?.length]);

  const handleMouseEnter = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (hasSubmenu) setOpen(true);
  };
  const handleMouseLeave = () => {
    // Delay close so the user can move to the absolutely-positioned submenu.
    if (hasSubmenu) {
      timerRef.current = setTimeout(() => setOpen(false), 150);
    }
  };

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {item.separator && <div className="h-px bg-border my-1" role="separator" />}
      <button
        role="menuitem"
        aria-haspopup={hasSubmenu || undefined}
        aria-expanded={hasSubmenu ? open : undefined}
        disabled={item.disabled}
        onClick={() => {
          if (item.disabled) return;
          if (hasSubmenu) {
            setOpen((o) => !o);
            return;
          }
          item.onClick?.();
          onClose();
        }}
        className={[
          "w-full px-3 py-1.5 flex items-center gap-2",
          "text-[length:var(--text-sm)] text-left cursor-pointer",
          "transition-colors duration-[var(--duration-fast)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          item.disabled
            ? "opacity-40 pointer-events-none"
            : item.danger
              ? "text-status-error hover:bg-status-error/10"
              : "text-text-primary hover:bg-bg-subtle",
        ].join(" ")}
      >
        {Icon && (
          <Icon
            size={15}
            strokeWidth={1.8}
            aria-hidden="true"
            className={item.danger ? "text-status-error" : "text-text-muted"}
          />
        )}
        <span className="flex-1 truncate">{item.label}</span>
        {hasSubmenu && <ChevronRight size={14} strokeWidth={1.8} aria-hidden="true" className="-mr-1 text-text-muted" />}
      </button>

      {hasSubmenu && open && (
        <div
          ref={subRef}
          role="menu"
          style={subTop !== undefined ? { top: subTop } : undefined}
          className={[
            "absolute top-0 z-10 py-1 min-w-[160px] max-h-[50vh] overflow-y-auto no-scrollbar",
            flip ? "right-full mr-0.5" : "left-full ml-0.5",
            "bg-bg-overlay border border-border rounded-lg",
            "shadow-[var(--shadow-lg)]",
            "animate-in fade-in-0 zoom-in-95 duration-[var(--duration-fast)]",
          ].join(" ")}
        >
          {item.submenu!.map((sub, i) => (
            <MenuRow key={i} item={sub} onClose={onClose} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ContextMenu({ items, position, onClose }: ContextMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const initialY = clampPosition(position.x, position.y, items.length).y;
  const x = clampPosition(position.x, position.y, items.length).x;
  const [adjustedY, setAdjustedY] = useState(initialY);

  // Re-clamp Y based on actual rendered height (clampPosition only estimates).
  useLayoutEffect(() => {
    if (menuRef.current) {
      const r = menuRef.current.getBoundingClientRect();
      if (r.bottom > window.innerHeight) {
        setAdjustedY(window.innerHeight - r.height - 8);
      }
    }
  }, []);

  // Close on outside click or Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };

    // Use capture so we catch clicks that land on other interactive elements
    document.addEventListener("mousedown", handleClick, true);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("mousedown", handleClick, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onClose]);

  const menu = (
    <div
      ref={menuRef}
      role="menu"
      aria-label={t('common:aria.contextMenu')}
      style={{ left: x, top: adjustedY }}
      className={[
        "fixed z-50 py-1 min-w-[160px]",
        "bg-bg-overlay border border-border rounded-lg",
        "shadow-[var(--shadow-lg)]",
        "animate-in fade-in-0 zoom-in-95 duration-[var(--duration-fast)]",
      ].join(" ")}
    >
      {items.map((item, index) => (
        <MenuRow key={index} item={item} onClose={onClose} />
      ))}
    </div>
  );

  return createPortal(menu, document.body);
}
