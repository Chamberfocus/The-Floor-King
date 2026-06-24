"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, LogOut, MoreHorizontal } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { APP_NAME, COMPANY_NAME, navItemsForRole } from "@/lib/nav";
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

function NavLinks({ role, onNavigate }: { role: Profile["role"]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const items = navItemsForRole(role);

  return (
    <nav className="flex flex-col gap-1 px-3">
      {items.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
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
    "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium min-w-0";
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
        <header className="flex items-center gap-3 border-b bg-background px-4 py-3 print:hidden">
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
        <main className="flex-1 overflow-y-auto p-4 pb-24 md:p-8 md:pb-8">
          {children}
        </main>
      </div>

      <MobileBottomNav role={profile.role} onMore={() => setMobileOpen(true)} />
      {profile.role !== "customer" ? <FieldAssistant /> : null}
    </div>
  );
}
