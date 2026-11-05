"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, Home, MessageSquare, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/portal", label: "Project", icon: Home },
  { href: "/portal/estimates", label: "Estimate", icon: FileText },
  { href: "/portal/invoices", label: "Invoice", icon: Receipt },
  { href: "/portal/messages", label: "Messages", icon: MessageSquare },
] as const;

function isCurrent(pathname: string, href: string): boolean {
  if (href === "/portal") return pathname === "/portal";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PortalNav({ replyWaiting = false }: { replyWaiting?: boolean }) {
  const pathname = usePathname();
  const item = (href: string, label: string, Icon: typeof Home, compact: boolean) => {
    const current = isCurrent(pathname, href);
    const showDot = replyWaiting && href === "/portal/messages";
    return (
      <Link
        key={href}
        href={href}
        aria-current={current ? "page" : undefined}
        className={cn(
          "relative inline-flex items-center justify-center gap-1.5 rounded-md font-medium",
          compact ? "min-h-14 flex-col gap-0.5 px-1 text-xs" : "h-9 px-3 text-sm",
          current
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <Icon className={compact ? "size-5" : "size-4"} />
        {label}
        {showDot ? (
          <span className="absolute right-2 top-2 size-2 rounded-full bg-sky-500" aria-label="New message" />
        ) : null}
      </Link>
    );
  };

  return (
    <>
      <nav aria-label="Your project" className="hidden items-center gap-1 md:flex">
        {LINKS.map((link) => item(link.href, link.label, link.icon, false))}
      </nav>
      <nav
        aria-label="Your project"
        className="fixed inset-x-0 bottom-0 z-30 border-t bg-background md:hidden"
      >
        <div className="grid grid-cols-4 px-1 pb-[env(safe-area-inset-bottom)]">
          {LINKS.map((link) => item(link.href, link.label, link.icon, true))}
        </div>
      </nav>
    </>
  );
}
