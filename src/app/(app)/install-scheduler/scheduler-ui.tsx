"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, MapPin, CalendarDays, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Install-scheduler shell: the "To schedule" list is the default view; the
 * calendar lives behind its own tab and only mounts when opened. Both subtrees
 * are passed in already-rendered so switching is instant.
 */
export function SchedulerTabs({
  list,
  calendar,
  needsCount,
}: {
  list: ReactNode;
  calendar: ReactNode;
  needsCount: number;
}) {
  const [tab, setTab] = useState<"list" | "calendar">("list");
  return (
    <>
      <div className="mb-5 inline-flex rounded-lg border p-0.5">
        <button
          type="button"
          onClick={() => setTab("list")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            tab === "list" ? "bg-primary text-primary-foreground" : "hover:bg-muted",
          )}
        >
          <ListChecks className="size-4" /> To schedule
          {needsCount > 0 ? (
            <span
              className={cn(
                "rounded-full px-1.5 text-xs font-semibold",
                tab === "list"
                  ? "bg-primary-foreground/20"
                  : "bg-primary/10 text-primary",
              )}
            >
              {needsCount}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => setTab("calendar")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            tab === "calendar" ? "bg-primary text-primary-foreground" : "hover:bg-muted",
          )}
        >
          <CalendarDays className="size-4" /> Calendar
        </button>
      </div>

      {tab === "calendar" ? calendar : list}
    </>
  );
}

/**
 * A client row in the "To schedule" list — collapsed to just the name + city by
 * default; the full scheduler opens only when you click it.
 */
export function ClientScheduleRow({
  name,
  city,
  customerId,
  children,
}: {
  name: string;
  city: string | null;
  customerId: string | null;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
          <span className="truncate font-semibold">{name}</span>
          {city ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="size-3" /> {city}
            </span>
          ) : null}
        </button>
        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 rounded-md bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/20"
          >
            Schedule
          </button>
        ) : customerId ? (
          <Link
            href={`/customers/${customerId}`}
            className="shrink-0 text-xs text-muted-foreground hover:underline"
          >
            Open file
          </Link>
        ) : null}
      </div>
      {open ? <div className="p-1 pt-0">{children}</div> : null}
    </div>
  );
}
