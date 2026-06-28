"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Instant push sync for a specific table. Subscribes to Postgres changes (via
 * Supabase Realtime) and soft-refreshes the page the moment a matching row is
 * inserted/updated/deleted — so chat messages, board moves, etc. appear with no
 * delay. Falls back gracefully: if Realtime isn't enabled on the table, the
 * app's focus + interval LiveSync still keeps things current.
 *
 * `filter` is a PostgREST filter string, e.g. `customer_id=eq.<id>`.
 */
export function RealtimeRefresh({
  table,
  filter,
}: {
  table: string;
  filter?: string;
}) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`rt:${table}:${filter ?? "all"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table, ...(filter ? { filter } : {}) },
        () => router.refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, filter, router]);

  return null;
}
