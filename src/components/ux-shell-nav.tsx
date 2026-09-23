"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  activeShellLink,
  mobileTabsForRole,
  shellSectionsForRole,
} from "@/lib/nav";
import type { UserRole } from "@/lib/types";

function pathIs(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

const linkClass = (active: boolean) =>
  cn(
    "flex min-h-11 items-center gap-3 rounded-lg px-3.5 text-sm transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
    active
      ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
      : "font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
  );

/** Desktop and mobile-sheet navigation for the Phase A shell. */
export function UxShellNav({
  role,
  onNavigate,
}: {
  role: UserRole;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const sections = shellSectionsForRole(role);
  const current = activeShellLink(pathname, role);

  return (
    <nav aria-label="Primary" className="flex flex-col gap-5 px-3 py-1">
      {sections.map((section) => {
        const solitary = section.id === "home" || section.id === "customers";
        if (solitary && section.items.length === 1) {
          const item = section.items[0];
          const active = current?.sectionId === section.id && current.href === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={section.id}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={linkClass(active)}
            >
              <Icon className="size-5 shrink-0" aria-hidden />
              <span className="min-w-0 leading-snug">{item.label}</span>
            </Link>
          );
        }

        const sectionActive = current?.sectionId === section.id;
        return (
          <div key={section.id} className="flex flex-col gap-0.5">
            <div
              className={cn(
                "px-3.5 pb-1 text-xs font-semibold tracking-wide uppercase",
                sectionActive ? "text-sidebar-foreground" : "text-sidebar-foreground/55",
              )}
            >
              {section.label}
            </div>
            {section.items.map((item) => {
              const active = current?.sectionId === section.id && current.href === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={linkClass(active)}
                >
                  <Icon className="size-5 shrink-0" aria-hidden />
                  <span className="min-w-0 leading-snug">{item.label}</span>
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

const tabClass = (active: boolean) =>
  cn(
    "flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-xs font-medium",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active ? "text-primary" : "text-muted-foreground",
  );

/**
 * Role-chosen bottom tabs plus More. More opens the full menu, which is where
 * the rest of that role's destinations live.
 */
export function UxMobileNav({
  role,
  onMore,
}: {
  role: UserRole;
  onMore: () => void;
}) {
  const pathname = usePathname();
  const tabs = mobileTabsForRole(role);
  if (!tabs.length) return null;
  const current = activeShellLink(pathname, role);
  const activeTab = tabs.reduce<string | null>((best, tab) => {
    if (!pathIs(pathname, tab.href)) return best;
    if (!best || tab.href.length > best.length) return tab.href;
    return best;
  }, null);
  const moreActive = activeTab == null && current != null;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 pb-[env(safe-area-inset-bottom)] md:hidden print:hidden"
      aria-label="Primary"
    >
      {tabs.map((tab) => {
        const active = activeTab === tab.href;
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={tabClass(active)}
          >
            <Icon className="size-5 shrink-0" aria-hidden />
            <span className="max-w-full truncate">{tab.label}</span>
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onMore}
        aria-label="More destinations"
        aria-current={moreActive ? "page" : undefined}
        className={tabClass(moreActive)}
      >
        <MoreHorizontal className="size-5 shrink-0" aria-hidden />
        <span>More</span>
      </button>
    </nav>
  );
}
