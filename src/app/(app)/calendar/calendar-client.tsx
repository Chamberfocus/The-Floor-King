"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { CalendarBoard } from "./calendar-board";

// Render the calendar only in the browser — it's fully interactive and has no
// SEO value, and this avoids any server-render edge cases.
const Board = dynamic(
  () => import("./calendar-board").then((m) => m.CalendarBoard),
  {
    ssr: false,
    loading: () => (
      <div className="p-6 text-sm text-muted-foreground">Loading calendar…</div>
    ),
  },
);

export function CalendarClient(props: ComponentProps<typeof CalendarBoard>) {
  return <Board {...props} />;
}
