"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Menu,
  Search,
  LogOut,
  MoreHorizontal,
  SlidersHorizontal,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  Home,
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
import { QuickCreate } from "@/components/quick-create";
import { UxMobileNav, UxShellNav } from "@/components/ux-shell-nav";
import { cn } from "@/lib/utils";
import {
  APP_NAME,
  COMPANY_NAME,
  UX_SHELL_COOKIE,
  homeHrefForRole,
  navItemsForRole,
  navGroupsForRole,
  pinnedItemsForRole,
  settingsItemForRole,
  type NavItem,
  type UxShellMode,
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

function Brand({ org, homeHref }: { org?: OrgSettings; homeHref?: string }) {
  const name = org?.company_name || COMPANY_NAME;
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  const inner = (
    <>
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
    </>
  );
  // The logo is the affordance people reach for first, so it goes home too —
  // the same place the Home button lands.
  return homeHref ? (
    <Link
      href={homeHref}
      className="flex items-center gap-3 px-5 py-4 transition-opacity hover:opacity-80"
    >
      {inner}
    </Link>
  ) : (
    <div className="flex items-center gap-3 px-5 py-4">{inner}</div>
  );
}

/** Phone search starts as a button so the field can use the full header when opened. */
function HeaderSearch({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-11 shrink-0 md:hidden"
        aria-label="Search"
        onClick={() => onOpenChange(true)}
      >
        <Search className="size-5" />
      </Button>
    );
  }
  return (
    <div className="absolute inset-0 z-10 flex items-center gap-2 bg-background px-3 md:hidden">
      <GlobalSearch className="min-w-0 flex-1" autoFocus inputId="crm-search-mobile" />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="min-h-11 shrink-0"
        onClick={() => onOpenChange(false)}
      >
        Close
      </Button>
    </div>
  );
}

function ShellSwitch({ shell }: { shell: UxShellMode }) {
  const router = useRouter();
  const next = shell === "new" ? "classic" : "new";
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="mt-1 w-full justify-start text-muted-foreground"
      onClick={() => {
        document.cookie = `${UX_SHELL_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
        router.refresh();
      }}
    >
      {shell === "new" ? "Use current navigation" : "Try new navigation"}
    </Button>
  );
}

function UserCard({ profile, shell }: { profile: Profile; shell: UxShellMode }) {
  return (
    <div className="mt-auto shrink-0 border-t border-sidebar-border p-3">
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
          nativeButton={false}
          variant="ghost"
          size="sm"
          className="mt-1 w-full justify-start text-muted-foreground"
        >
          <SlidersHorizontal className="size-4" />
          My page setup
        </Button>
      ) : null}
      <ShellSwitch shell={shell} />
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

/** Cookie the collapsed state lives in. A cookie rather than localStorage so the
 *  server renders the sidebar already in the right state — with localStorage the
 *  bar flashes open on every page load before the effect runs. */
export const SIDEBAR_COOKIE = "fk_sidebar";

export function AppShell({
  profile,
  org,
  defaultCollapsed = false,
  shell = "classic",
  children,
}: {
  profile: Profile;
  org?: OrgSettings;
  /** Read from the cookie on the server so there's no flash on first paint. */
  defaultCollapsed?: boolean;
  /** Phase A shell. Classic stays the default until the cookie or env opts in. */
  shell?: UxShellMode;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileSearch, setMobileSearch] = useState(false);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const homeHref = homeHrefForRole(profile.role);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mobileSearch) {
        setMobileSearch(false);
        return;
      }
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
        return;
      }
      const fields = ["crm-search", "crm-search-mobile"]
        .map((id) => document.getElementById(id))
        .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
      const visible = fields.find((el) => el.offsetParent !== null);
      if (visible) {
        e.preventDefault();
        visible.focus();
        return;
      }
      e.preventDefault();
      setMobileSearch(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileSearch]);

  const toggleSidebar = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "open"}; path=/; max-age=31536000; samesite=lax`;
  };

  return (
    <div className="flex min-h-svh flex-1">
      {/* Desktop sidebar — collapses fully to the left, giving the page the
          whole width back (wide tables: customers, the estimate builder). */}
      <aside
        className={cn(
          "hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground print:!hidden",
          shell === "new" ? "sticky top-0 h-svh max-h-svh w-72 overflow-hidden" : "w-64",
          collapsed ? "md:hidden" : "md:flex",
        )}
      >
        <Brand org={org} homeHref={homeHref} />
        <div className="min-h-0 flex-1 overflow-y-auto py-2">
          {shell === "new" ? (
            <div className="px-3 pb-3">
              <QuickCreate role={profile.role} fullWidth />
            </div>
          ) : null}
          {shell === "new" ? (
            <UxShellNav role={profile.role} />
          ) : (
            <NavLinks role={profile.role} />
          )}
        </div>
        <UserCard profile={profile} shell={shell} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar: mobile menu (mobile only) + global search (always) */}
        <header className="relative flex items-center gap-3 border-b bg-background px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] print:hidden">
          <div className="md:hidden">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger
                render={
                  <Button variant="outline" size="icon" aria-label="Open menu" />
                }
              >
                <Menu className="size-5" />
              </SheetTrigger>
              <SheetContent side="left" className="flex h-dvh w-72 max-h-dvh flex-col overflow-hidden bg-sidebar p-0 text-sidebar-foreground">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <Brand org={org} homeHref={homeHref} />
                <div className="min-h-0 flex-1 overflow-y-auto py-2">
                  {shell === "new" ? (
                    <UxShellNav
                      role={profile.role}
                      onNavigate={() => setMobileOpen(false)}
                    />
                  ) : (
                    <NavLinks
                      role={profile.role}
                      onNavigate={() => setMobileOpen(false)}
                    />
                  )}
                </div>
                <UserCard profile={profile} shell={shell} />
              </SheetContent>
            </Sheet>
          </div>
          {/* Desktop only — phones already have the menu button beside this. */}
          <Button
            variant="outline"
            size="icon"
            onClick={toggleSidebar}
            aria-label={collapsed ? "Show the menu" : "Hide the menu"}
            aria-expanded={!collapsed}
            title={collapsed ? "Show the menu" : "Hide the menu"}
            className="hidden shrink-0 md:inline-flex"
          >
            {collapsed ? (
              <PanelLeftOpen className="size-5" />
            ) : (
              <PanelLeftClose className="size-5" />
            )}
          </Button>
          <Button
            variant="outline"
            size="icon"
            render={<Link href={homeHref} />}
            nativeButton={false}
            aria-label="Home"
            title="Home"
            className="shrink-0"
          >
            <Home className="size-5" />
          </Button>
          <div className="hidden min-w-0 flex-1 items-center gap-3 md:flex">
            <GlobalSearch className="w-full max-w-xl" />
          </div>
          <HeaderSearch open={mobileSearch} onOpenChange={setMobileSearch} />
          {shell === "new" ? (
            <QuickCreate
              role={profile.role}
              className={cn("shrink-0", collapsed ? "" : "md:hidden")}
            />
          ) : null}
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

      {shell === "new" ? (
        <UxMobileNav role={profile.role} onMore={() => setMobileOpen(true)} />
      ) : (
        <MobileBottomNav role={profile.role} onMore={() => setMobileOpen(true)} />
      )}
      {profile.role !== "customer" ? <FieldAssistant /> : null}
      {profile.role !== "customer" ? <OnMyWayFab /> : null}
    </div>
  );
}
