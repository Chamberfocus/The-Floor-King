"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Menu,
  LogOut,
  MoreHorizontal,
  SlidersHorizontal,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { GlobalSearch } from "@/components/global-search";
import { ImportJobsBanner } from "@/components/import-jobs-banner";
import { AreaCalculator } from "@/components/area-calculator";
import { FieldAssistant } from "@/components/field-assistant";
import { OnMyWayFab } from "@/components/on-my-way-fab";
import { TourRoot } from "@/components/tour/tour-root";
import { TourBoundary } from "@/components/tour/tour-boundary";
import { cn } from "@/lib/utils";
import {
  APP_NAME,
  COMPANY_NAME,
  navItemsForRole,
  navGroupsForRole,
  pinnedItemsForRole,
  settingsItemForRole,
  type NavItem,
} from "@/lib/nav";
import { ROLE_LABELS, type OrgSettings, type Profile } from "@/lib/types";
import { signout } from "@/app/(app)/actions";

function initials(profile: Profile) {
  const source = profile.full_name?.trim() || profile.email;
  return source
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
}

function isActiveHref(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** A single sidebar link. `nested` renders it slightly inset under a group. */
function NavLink({
  item,
  pathname,
  onNavigate,
  nested,
}: {
  item: NavItem;
  pathname: string;
  onNavigate?: () => void;
  nested?: boolean;
}) {
  const active = isActiveHref(pathname, item.href);
  const Icon = item.icon;

  // Subcategory (child) rows: no icon, so the label is the group's leftmost
  // content and the container's vertical rule sits 8px to its left. Text lands
  // 16px past the parent item's text (parent text starts at 46px; child at 62px,
  // via ml-[54px] on the container + 1px rule + pl-[7px] here). One step below
  // the parent's 14px (text-xs = 12px), weight 400, foreground at 80% (contrast
  // 9.3:1 light / 11.0:1 dark — well over 4.5:1, so 80% holds). Active: full
  // opacity, weight 500, and a 2px accent segment over the rule beside the row.
  if (nested) {
    return (
      <Link
        href={item.href}
        onClick={onNavigate}
        className={cn(
          "relative flex h-9 items-center rounded-md pl-[7px] pr-3.5 text-xs transition-colors",
          active
            ? "font-medium text-sidebar-foreground before:absolute before:inset-y-0 before:-left-px before:w-0.5 before:bg-sidebar-primary before:content-['']"
            : "font-normal text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
        )}
      >
        {item.label}
      </Link>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 rounded-lg py-2.5 text-sm transition-colors",
        "px-3.5",
        active
          ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground shadow-sm"
          : "font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
      )}
    >
      <Icon className="size-5 shrink-0" />
      {item.label}
    </Link>
  );
}

function NavLinks({ role, onNavigate }: { role: Profile["role"]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const pinned = pinnedItemsForRole(role);
  const groups = navGroupsForRole(role);
  const settings = settingsItemForRole(role);

  // The group holding the current page — expanded on load; the rest collapsed.
  const activeGroupId =
    groups.find((g) => g.items.some((i) => isActiveHref(pathname, i.href)))?.id ??
    null;
  const [open, setOpen] = useState<string | null>(activeGroupId);

  // When navigation lands in a different group, auto-open that group (the chosen
  // behavior: the active group is always the one showing).
  const prevActive = useRef(activeGroupId);
  useEffect(() => {
    if (activeGroupId && activeGroupId !== prevActive.current) {
      setOpen(activeGroupId);
    }
    prevActive.current = activeGroupId;
  }, [activeGroupId]);

  return (
    <nav className="flex flex-col gap-1 px-3">
      {pinned.map((item) => (
        <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
      ))}
      {pinned.length ? <div className="my-1 h-px bg-sidebar-border/60" /> : null}

      {groups.map((g) => {
        const Icon = g.icon;
        const expanded = open === g.id;
        const groupActive = g.id === activeGroupId;
        return (
          <div key={g.id}>
            <button
              type="button"
              onClick={() => setOpen(expanded ? null : g.id)}
              aria-expanded={expanded}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors",
                groupActive && !expanded
                  ? "text-sidebar-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              )}
            >
              <Icon className="size-5 shrink-0" />
              <span className="flex-1 text-left">{g.label}</span>
              <ChevronDown
                className={cn(
                  "size-4 shrink-0 transition-transform",
                  expanded ? "" : "-rotate-90",
                )}
              />
            </button>
            {expanded ? (
              // Subcategory group: 1px vertical rule (border color, full opacity)
              // 8px left of the child text; ml-[54px] puts the rule at 54px so
              // text lands at 62px (16px past parent text). 2px between rows
              // (gap-0.5); mb-2 (8px) + the nav's gap-1 (4px) = 12px to the next
              // parent item.
              <div className="mt-0.5 mb-2 ml-[54px] flex flex-col gap-0.5 border-l border-sidebar-border">
                {g.items.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    pathname={pathname}
                    onNavigate={onNavigate}
                    nested
                  />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}

      {settings ? (
        <>
          <div className="my-1 h-px bg-sidebar-border/60" />
          <NavLink item={settings} pathname={pathname} onNavigate={onNavigate} />
        </>
      ) : null}
    </nav>
  );
}

function Brand({ org }: { org?: OrgSettings }) {
  const name = org?.company_name || COMPANY_NAME;
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <div className="flex items-center gap-3 px-5 py-4">
      {org?.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={org.logo_url}
          alt={name}
          className="h-9 w-auto max-w-[140px] object-contain"
        />
      ) : (
        <div
          className="flex size-9 items-center justify-center rounded-lg text-sm font-bold text-white"
          style={{ backgroundColor: org?.primary_color || "var(--primary)" }}
        >
          {initials || "FK"}
        </div>
      )}
      <div className="leading-tight">
        <div className="text-sm font-semibold">{name}</div>
        <div className="text-xs text-muted-foreground">{APP_NAME}</div>
      </div>
    </div>
  );
}

function UserCard({ profile }: { profile: Profile }) {
  return (
    <div className="mt-auto border-t border-sidebar-border p-3">
      <div className="flex items-center gap-3 px-2 py-2">
        <Avatar className="size-8">
          <AvatarFallback className="text-xs">{initials(profile)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-medium">
            {profile.full_name || profile.email}
          </div>
          <div className="text-xs text-muted-foreground">
            {ROLE_LABELS[profile.role]}
          </div>
        </div>
      </div>
      {profile.role !== "customer" ? (
        <Button
          render={<Link href="/settings/preferences" />}
          variant="ghost"
          size="sm"
          className="mt-1 w-full justify-start text-muted-foreground"
        >
          <SlidersHorizontal className="size-4" />
          My page setup
        </Button>
      ) : null}
      <form action={signout}>
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          className="mt-1 w-full justify-start text-muted-foreground"
        >
          <LogOut className="size-4" />
          Sign out
        </Button>
      </form>
    </div>
  );
}

/**
 * Thumb-reachable bottom tab bar for phones. Shows the role's top destinations
 * plus a "More" button that opens the full menu — so the field crew and sales
 * team navigate with one hand. Hidden on desktop and when printing.
 */
function MobileBottomNav({
  role,
  onMore,
}: {
  role: Profile["role"];
  onMore: () => void;
}) {
  const pathname = usePathname();
  const items = navItemsForRole(role).slice(0, 4);
  if (!items.length) return null;

  const cell =
    "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium min-w-0";
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 pb-[env(safe-area-inset-bottom)] md:hidden print:hidden"
      aria-label="Primary"
    >
      {items.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(cell, active ? "text-primary" : "text-muted-foreground")}
          >
            <Icon className="size-5 shrink-0" />
            <span className="max-w-full truncate">{item.label}</span>
          </Link>
        );
      })}
      <button type="button" onClick={onMore} className={cn(cell, "text-muted-foreground")}>
        <MoreHorizontal className="size-5 shrink-0" />
        <span>More</span>
      </button>
    </nav>
  );
}

export function AppShell({
  profile,
  org,
  children,
}: {
  profile: Profile;
  org?: OrgSettings;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-svh flex-1">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex print:!hidden">
        <Brand org={org} />
        <div className="flex-1 overflow-y-auto py-2">
          <NavLinks role={profile.role} />
        </div>
        <UserCard profile={profile} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar: mobile menu (mobile only) + global search (always) */}
        <header className="flex items-center gap-3 border-b bg-background px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] print:hidden">
          <div className="md:hidden">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger
                render={
                  <Button variant="outline" size="icon" aria-label="Open menu" />
                }
              >
                <Menu className="size-5" />
              </SheetTrigger>
              <SheetContent side="left" className="flex w-72 flex-col bg-sidebar p-0 text-sidebar-foreground">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <Brand org={org} />
                <div className="flex-1 overflow-y-auto py-2">
                  <NavLinks
                    role={profile.role}
                    onNavigate={() => setMobileOpen(false)}
                  />
                </div>
                <UserCard profile={profile} />
              </SheetContent>
            </Sheet>
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <GlobalSearch className="w-full max-w-xl" />
          </div>
          {profile.role !== "customer" ? (
            <AreaCalculator
              triggerLabel="Calculator"
              triggerVariant="outline"
              triggerClassName="shrink-0"
            />
          ) : null}
        </header>

        {profile.role !== "customer" ? <ImportJobsBanner /> : null}

        {/* Extra bottom padding on phones so content clears the tab bar. */}
        <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 pb-24 md:p-8 md:pb-8">
          {children}
        </main>
      </div>

      <MobileBottomNav role={profile.role} onMore={() => setMobileOpen(true)} />
      {profile.role !== "customer" ? <FieldAssistant /> : null}
      {profile.role !== "customer" ? <OnMyWayFab /> : null}
      {profile.role !== "customer" ? (
        <TourBoundary>
          <TourRoot role={profile.role} userId={profile.id} />
        </TourBoundary>
      ) : null}
    </div>
  );
}
