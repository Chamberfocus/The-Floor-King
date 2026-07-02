"use client";

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
  type LucideIcon,
} from "lucide-react";

/** Counts drive the little number badge on each chip (hidden when zero). */
export interface QuickNavCounts {
  estimates: number;
  jobs: number;
  invoices: number;
  materials: number;
  files: number;
  messages: number;
}

type Item = {
  id: string;
  label: string;
  icon: LucideIcon;
  count?: keyof QuickNavCounts;
};

const ITEMS: Item[] = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "contact", label: "Contact", icon: User },
  { id: "estimates", label: "Estimates", icon: FileText, count: "estimates" },
  { id: "jobs", label: "Work orders", icon: Wrench, count: "jobs" },
  { id: "invoices", label: "Invoices", icon: Receipt, count: "invoices" },
  { id: "materials", label: "Materials & POs", icon: Package, count: "materials" },
  { id: "files", label: "Files", icon: Paperclip, count: "files" },
  { id: "messages", label: "Messages", icon: MessageSquare, count: "messages" },
  { id: "activity", label: "Activity", icon: History },
];

/**
 * Jump straight to any part of a customer's file. Opens the section if it's
 * behind a collapsed <details>, then smooth-scrolls it into view. Sticky so it
 * stays reachable as you scroll the record. The trailing slot holds the
 * Settings menu (passed in from the server page).
 */
export function CustomerQuickNav({
  counts,
  settings,
}: {
  counts: QuickNavCounts;
  settings: React.ReactNode;
}) {
  const goTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    // Open the target (and any ancestors) if they're collapsed <details>.
    let node: HTMLElement | null = el;
    while (node) {
      if (node.tagName === "DETAILS") (node as HTMLDetailsElement).open = true;
      node = node.parentElement;
    }
    // Let the layout settle after opening, then scroll.
    requestAnimationFrame(() =>
      el.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };

  return (
    <nav className="sticky top-0 z-20 mb-6 flex items-center gap-1 rounded-xl border bg-background/90 p-1.5 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="flex flex-1 items-center gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const n = item.count ? counts[item.count] : 0;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => goTo(item.id)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Icon className="size-3.5" />
              {item.label}
              {n > 0 ? (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-foreground">
                  {n}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="shrink-0 border-l pl-1.5">{settings}</div>
    </nav>
  );
}
