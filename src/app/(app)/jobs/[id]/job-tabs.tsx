"use client";

import { createContext, useContext, useEffect, useState } from "react";
import {
  ClipboardList,
  CheckCircle2,
  Package,
  Wallet,
  SlidersHorizontal,
  FolderOpen,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Lightweight compartments for the job page. The server renders every section
 * once; switching tabs is instant client-side show/hide (display:none), so all
 * the server-action forms inside stay mounted and keep working. Multiple panels
 * can share a tab key — they show together when that tab is active.
 */
export type JobTab =
  | "documents"
  | "work_order"
  | "completion"
  | "warehouse"
  | "money"
  | "manage";

const TAB_META: Record<JobTab, { label: string; icon: LucideIcon }> = {
  documents: { label: "Documents", icon: FolderOpen },
  work_order: { label: "Work order", icon: ClipboardList },
  completion: { label: "Completion", icon: CheckCircle2 },
  warehouse: { label: "Materials & prep", icon: Package },
  money: { label: "Money", icon: Wallet },
  manage: { label: "Manage", icon: SlidersHorizontal },
};

interface TabState {
  active: JobTab;
  setActive: (t: JobTab) => void;
}
const TabCtx = createContext<TabState>({ active: "work_order", setActive: () => {} });

/** Switch job tabs programmatically (e.g. a Documents row jumps to Completion). */
export function useJobTab(): TabState {
  return useContext(TabCtx);
}

export function JobTabs({
  show,
  initial,
  children,
}: {
  show: JobTab[];
  initial?: JobTab;
  children: React.ReactNode;
}) {
  const start =
    initial && show.includes(initial) ? initial : (show[0] ?? "work_order");
  const [active, setActive] = useState<JobTab>(start);
  // Deep-link / guided-tour support: ?tab= or #tab in the URL focuses that tab.
  useEffect(() => {
    const applyHash = () => {
      const fromQuery = new URLSearchParams(window.location.search).get("tab") as JobTab | null;
      const fromHash = window.location.hash.replace("#", "") as JobTab;
      const h =
        fromQuery && show.includes(fromQuery)
          ? fromQuery
          : fromHash && show.includes(fromHash)
            ? fromHash
            : null;
      if (h) setActive(h);
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [show]);
  return (
    <TabCtx.Provider value={{ active, setActive }}>
      <div className="mb-6 flex gap-1 overflow-x-auto border-b">
        {show.map((key) => {
          const { label, icon: Icon } = TAB_META[key];
          const on = active === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActive(key)}
              aria-current={on ? "page" : undefined}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2.5 text-base font-semibold transition-colors",
                on
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          );
        })}
      </div>
      {children}
    </TabCtx.Provider>
  );
}

/** A section that belongs to a tab; hidden (but mounted) when that tab is off. */
export function JobTabPanel({
  tab,
  children,
}: {
  tab: JobTab;
  children: React.ReactNode;
}) {
  const { active } = useContext(TabCtx);
  return <div className={cn(active !== tab && "hidden")}>{children}</div>;
}
