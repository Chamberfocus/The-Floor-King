"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  LayoutGrid,
  User,
  FileText,
  Wrench,
  Receipt,
  Package,
  Paperclip,
  MessageSquare,
  History,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TAB_ORDER, type CustomerTab } from "@/lib/preferences";

/**
 * Hybrid tabs for a customer file. "Overview" shows the whole record (the full
 * two-column layout); every other tab zooms into just that section, full width.
 * Sections are rendered ONCE by the server page and passed through as children —
 * switching tabs is instant client-side show/hide, no refetch, no duplication.
 *
 * Which tabs show, their order, and the default tab come from the signed-in
 * user's preferences (see @/lib/preferences).
 */

export type { CustomerTab };

export interface TabCounts {
  estimates: number;
  jobs: number;
  invoices: number;
  materials: number;
  files: number;
  messages: number;
}

const TabCtx = createContext<CustomerTab>("overview");

const TABS: {
  key: CustomerTab;
  label: string;
  icon: LucideIcon;
  count?: keyof TabCounts;
}[] = [
  { key: "overview", label: "Overview", icon: LayoutGrid },
  { key: "contact", label: "Contact", icon: User },
  { key: "estimates", label: "Estimates", icon: FileText, count: "estimates" },
  { key: "jobs", label: "Jobs", icon: Wrench, count: "jobs" },
  { key: "invoices", label: "Invoices", icon: Receipt, count: "invoices" },
  { key: "materials", label: "Materials & POs", icon: Package, count: "materials" },
  { key: "files", label: "Files", icon: Paperclip, count: "files" },
  { key: "messages", label: "Messages", icon: MessageSquare, count: "messages" },
  { key: "activity", label: "Activity", icon: History },
];

export function CustomerTabs({
  counts,
  settings,
  children,
  tabs = TAB_ORDER,
  defaultTab = "overview",
}: {
  counts: TabCounts;
  settings?: React.ReactNode;
  children: React.ReactNode;
  /** Visible tabs, in order (personal preference). */
  tabs?: CustomerTab[];
  /** Tab the file opens on. */
  defaultTab?: CustomerTab;
}) {
  // Reorder/filter the rich tab metadata by the user's chosen order.
  const visible = tabs
    .map((k) => TABS.find((t) => t.key === k))
    .filter((t): t is (typeof TABS)[number] => Boolean(t));
  const initial: CustomerTab = tabs.includes(defaultTab)
    ? defaultTab
    : (tabs[0] ?? "overview");
  const [active, setActive] = useState<CustomerTab>(initial);
  const navRef = useRef<HTMLElement>(null);

  // Deep-link / jump support: a #tab in the URL (from a snapshot link or a
  // post-action redirect like #jobs) focuses that tab. Keeps everything in the
  // customer's context instead of leaving the page.
  useEffect(() => {
    const applyHash = () => {
      const h = window.location.hash.replace("#", "");
      if (h && tabs.includes(h as CustomerTab)) setActive(h as CustomerTab);
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [tabs]);

  const pick = (key: CustomerTab) => {
    setActive(key);
    // Start the newly-focused view from the top so nothing looks "half-scrolled".
    navRef.current?.closest("main")?.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <TabCtx.Provider value={active}>
      <nav
        ref={navRef}
        className="sticky top-0 z-20 mb-6 flex items-center gap-1 rounded-xl border bg-background/90 p-1.5 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/70"
      >
        <div className="flex flex-1 items-center gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {visible.map((t) => {
            const Icon = t.icon;
            const n = t.count ? counts[t.count] : 0;
            const on = active === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => pick(t.key)}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                  on
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
                {t.label}
                {n > 0 ? (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-xs font-semibold",
                      on ? "bg-primary-foreground/20" : "bg-muted text-foreground",
                    )}
                  >
                    {n}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {settings ? (
          <div className="shrink-0 border-l pl-1.5">{settings}</div>
        ) : null}
      </nav>
      {children}
    </TabCtx.Provider>
  );
}

/** Grid that is two-column on Overview and a single full-width column when a
 *  specific section is in focus. */
export function TabGrid({ children }: { children: React.ReactNode }) {
  const active = useContext(TabCtx);
  return (
    <div
      className={cn(
        "grid gap-6",
        active === "overview" ? "lg:grid-cols-3" : "grid-cols-1",
      )}
    >
      {children}
    </div>
  );
}

/** A layout column that only renders for the given tabs — so the *other*
 *  column doesn't leave an empty grid row (and its gap) in a focused view. */
export function TabColumn({
  show,
  className,
  children,
}: {
  show: CustomerTab[];
  className?: string;
  children: React.ReactNode;
}) {
  const active = useContext(TabCtx);
  if (!show.includes(active)) return null;
  return <div className={className}>{children}</div>;
}

/** Show its children on its own tab, and on Overview unless `overview={false}`.
 *  Heavy full lists pass `overview={false}` so Overview stays a scannable
 *  summary instead of dumping the whole file. */
export function TabSection({
  tab,
  overview = true,
  children,
}: {
  tab: CustomerTab;
  overview?: boolean;
  children: React.ReactNode;
}) {
  const active = useContext(TabCtx);
  if (active === "overview") return overview ? <>{children}</> : null;
  return active === tab ? <>{children}</> : null;
}

/**
 * A collapsible section that stays tucked away on Overview (to keep it tidy) but
 * auto-expands when you open its own tab. Same visibility rules as TabSection.
 */
export function TabCollapse({
  tab,
  title,
  defaultOpen = false,
  overview = true,
  children,
}: {
  tab: CustomerTab;
  title: string;
  defaultOpen?: boolean;
  overview?: boolean;
  children: React.ReactNode;
}) {
  const active = useContext(TabCtx);
  if (active === "overview" && !overview) return null;
  if (active !== "overview" && active !== tab) return null;
  const open = tab !== "overview" && active === tab ? true : defaultOpen;
  return (
    <details open={open} className="group scroll-mt-24">
      <summary className="mb-2 flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
        {title}
      </summary>
      {children}
    </details>
  );
}
