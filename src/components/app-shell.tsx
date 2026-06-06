"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { GlobalSearch } from "@/components/global-search";
import { cn } from "@/lib/utils";
import { APP_NAME, COMPANY_NAME, navItemsForRole } from "@/lib/nav";
import { ROLE_LABELS, type Profile } from "@/lib/types";
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

function Brand() {
  return (
    <div className="flex items-center gap-3 px-5 py-4">
      <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">
        FK
      </div>
      <div className="leading-tight">
        <div className="text-sm font-semibold">{APP_NAME}</div>
        <div className="text-xs text-muted-foreground">{COMPANY_NAME}</div>
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

export function AppShell({
  profile,
  children,
}: {
  profile: Profile;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-svh flex-1">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <Brand />
        <div className="flex-1 overflow-y-auto py-2">
          <NavLinks role={profile.role} />
        </div>
        <UserCard profile={profile} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar: mobile menu (mobile only) + global search (always) */}
        <header className="flex items-center gap-3 border-b bg-background px-4 py-3">
          <div className="md:hidden">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger
                render={
                  <Button variant="outline" size="icon" aria-label="Open menu" />
                }
              >
                <Menu className="size-5" />
              </SheetTrigger>
              <SheetContent side="left" className="flex w-72 flex-col p-0">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <Brand />
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
          <GlobalSearch className="w-full max-w-xl" />
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
