"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  activeShellLink,
  isCollapsibleShellSection,
  mobileTabsForRole,
  nextOpenGroup,
  openGroupForRoute,
  shellSectionsForRole,
  type ShellSectionId,
} from "@/lib/nav";
import type { UserRole } from "@/lib/types";

function pathIs(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function groupPanelId(id: ShellSectionId): string {
  return `shell-nav-${id}`;
}

const linkClass = (active: boolean) =>
  cn(
    "flex min-h-11 items-center gap-3 rounded-lg px-3.5 text-sm transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
    active
      ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
      : "font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
  );

/** Desktop and mobile-sheet navigation. Home and Customers stay visible; other groups fold. */
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
  const routeGroup = openGroupForRoute(current?.sectionId ?? null);
  const [openGroup, setOpenGroup] = useState<ShellSectionId | null>(routeGroup);
  const [syncedPath, setSyncedPath] = useState(pathname);

  if (syncedPath !== pathname) {
    setSyncedPath(pathname);
    setOpenGroup(routeGroup);
  }

  const toggle = (id: ShellSectionId) => {
    setOpenGroup((prev) => nextOpenGroup(prev, id));
  };

  return (
    <nav aria-label="Primary" className="flex flex-col gap-1 px-3 py-1">
      {sections.map((section) => {
        const direct = !isCollapsibleShellSection(section.id) || section.items.length === 1;
        if (direct) {
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
              <span className="min-w-0 truncate leading-snug">{item.label}</span>
            </Link>
          );
        }

        const expanded = openGroup === section.id;
        const sectionActive = current?.sectionId === section.id;
        return (
          <div key={section.id}>
            <button
              type="button"
              onClick={() => toggle(section.id)}
              aria-expanded={expanded}
              aria-controls={groupPanelId(section.id)}
              aria-current={sectionActive && !expanded ? "location" : undefined}
              className={cn(
                "flex min-h-11 w-full items-center gap-3 rounded-lg border-l-4 px-3.5 text-sm font-semibold",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                sectionActive
                  ? "border-sidebar-primary bg-sidebar-accent/70 text-sidebar-foreground"
                  : "border-transparent text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              )}
            >
              <span className="min-w-0 flex-1 truncate text-left">{section.label}</span>
              <ChevronDown
                className={cn(
                  "size-4 shrink-0 transition-transform duration-200",
                  expanded ? "" : "-rotate-90",
                )}
                aria-hidden
              />
            </button>
            <div
              id={groupPanelId(section.id)}
              role="group"
              aria-label={section.label}
              hidden={!expanded}
              className="mb-1 flex flex-col gap-0.5"
            >
              {section.items.map((item) => {
                const active =
                  current?.sectionId === section.id && current.href === item.href;
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
                    <span className="min-w-0 truncate leading-snug">{item.label}</span>
                  </Link>
                );
              })}
            </div>
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

/** Role-chosen bottom tabs plus More. More opens the full menu. */
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
