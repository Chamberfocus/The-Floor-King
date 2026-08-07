"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { MessageSquarePlus, Siren, Package, Briefcase, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { addWorkNote, type WorkNote } from "@/app/(app)/jobs/[id]/note-actions";

const TEXTAREA =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function NoteLine({ n }: { n: WorkNote }) {
  const where = n.job_id
    ? { href: `/jobs/${n.job_id}`, label: "Job", Icon: Briefcase }
    : n.po_id
      ? { href: `/purchase-orders/${n.po_id}`, label: "Order", Icon: Truck }
      : null;

  return (
    <li
      className={
        n.urgent
          ? "rounded-md border border-amber-400 bg-amber-50 p-2 dark:border-amber-700 dark:bg-amber-950/40"
          : "rounded-md border p-2"
      }
    >
      <p className="text-sm whitespace-pre-wrap">{n.body}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          {n.authorName} · {formatDate(n.created_at)}
        </span>
        {n.urgent ? (
          <Badge className="gap-1 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            <Siren className="size-3" /> Urgent
          </Badge>
        ) : null}
        {where ? (
          <Link href={where.href} className="inline-flex items-center gap-1 hover:underline">
            <where.Icon className="size-3" /> {where.label}
          </Link>
        ) : (
          <Badge variant="outline" className="gap-1">
            <Package className="size-3" /> Shop-wide
          </Badge>
        )}
      </div>
    </li>
  );
}

/**
 * Everything aimed at the warehouse, in one place — notes about a job, about an
 * incoming order, and shop-wide ones tied to nothing.
 *
 * The warehouse used to read `jobs.notes`, which is the STRUCTURED scope field
 * the questionnaire writes. That was never a message channel; it just happened
 * to be visible. This is the channel.
 */
export function WarehouseNotes({
  notes,
  canPost,
}: {
  notes: WorkNote[];
  canPost: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [busy, start] = useTransition();

  const post = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("body", body);
      fd.set("for_warehouse", "on");
      if (urgent) fd.set("urgent", "on");
      const res = await addWorkNote(fd);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setBody("");
      setUrgent(false);
      toast.success("Posted to the shop");
      router.refresh();
    });

  const urgentOnes = notes.filter((n) => n.urgent);

  return (
    <div className="space-y-2">
      {urgentOnes.length ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-sm dark:border-amber-700 dark:bg-amber-950/40">
          <Siren className="size-4 text-amber-600" />
          <span>
            <strong>{urgentOnes.length}</strong> urgent{" "}
            {urgentOnes.length === 1 ? "note" : "notes"} — read{" "}
            {urgentOnes.length === 1 ? "it" : "them"} before staging anything.
          </span>
        </div>
      ) : null}

      {canPost ? (
        <div className="rounded-lg border bg-muted/30 p-3">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            placeholder="Something the shop needs to know — short on ¼&quot; subfloor, truck down Thursday…"
            className={TEXTAREA}
            aria-label="New shop note"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={post} disabled={busy || !body.trim()}>
              <MessageSquarePlus className="size-4" />
              {busy ? "Posting…" : "Post to the shop"}
            </Button>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={urgent}
                onChange={(e) => setUrgent(e.target.checked)}
                className="size-4"
              />
              Urgent — text everyone
            </label>
          </div>
        </div>
      ) : null}

      {notes.length ? (
        <ul className="space-y-2">
          {notes.map((n) => (
            <NoteLine key={n.id} n={n} />
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          Nothing for the warehouse right now. Notes flagged for the shop — on a
          job, an incoming order, or posted here — land in this list.
        </p>
      )}
    </div>
  );
}
