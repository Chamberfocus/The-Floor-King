"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  archiveRecord,
  deleteForever,
  previewDeleteForever,
  restoreRecord,
} from "@/app/(app)/lifecycle/actions";
import type { DeleteImpact } from "@/lib/record-lifecycle";
import type { LifecycleRecordType } from "@/lib/record-lifecycle";

export function ArchivedBadge({ archivedAt }: { archivedAt: string | null | undefined }) {
  if (!archivedAt) return null;
  const date = new Date(archivedAt);
  const label = Number.isNaN(date.getTime())
    ? "Archived"
    : `Archived ${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  return (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
      {label}
    </span>
  );
}

export function LifecycleFilter({
  value,
  makeHref,
  ready,
}: {
  value: "active" | "archived" | "all";
  makeHref: (next: "active" | "archived" | "all") => string;
  ready: boolean;
}) {
  if (!ready) return null;
  const items = [
    ["active", "Active"],
    ["archived", "Archived"],
    ["all", "All"],
  ] as const;
  return (
    <div className="mb-3 inline-flex rounded-lg border p-0.5" aria-label="Record lifecycle">
      {items.map(([key, label]) => (
        <a
          key={key}
          href={makeHref(key)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${
            value === key ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"
          }`}
        >
          {label}
        </a>
      ))}
    </div>
  );
}

export function RecordLifecycleMenu({
  recordType,
  recordId,
  archivedAt,
  allowArchive,
  allowDelete,
}: {
  recordType: LifecycleRecordType;
  recordId: string;
  archivedAt?: string | null;
  allowArchive: boolean;
  allowDelete: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [impact, setImpact] = useState<DeleteImpact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const archived = Boolean(archivedAt);

  async function run(action: (form: FormData) => Promise<{ ok: boolean; error?: string }>, archive: boolean) {
    setError(null);
    setPending(true);
    const form = new FormData();
    form.set("record_type", recordType);
    form.set("record_id", recordId);
    const result = await action(form);
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "That change could not be saved.");
      return;
    }
    void archive;
    router.refresh();
  }

  async function openDelete() {
    setError(null);
    setConfirm("");
    setImpact(null);
    setOpen(true);
    setPending(true);
    const result = await previewDeleteForever(recordType, recordId);
    setPending(false);
    if (!result.ok || !result.impact) {
      setError(result.error ?? "The delete impact could not be calculated.");
      return;
    }
    setImpact(result.impact);
  }

  async function commitDelete() {
    if (!impact) return;
    setPending(true);
    setError(null);
    const form = new FormData();
    form.set("record_type", recordType);
    form.set("record_id", recordId);
    form.set("confirm", confirm);
    const result = await deleteForever(form);
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Nothing was deleted.");
      if (result.impact) setImpact(result.impact);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ArchivedBadge archivedAt={archivedAt} />
      {allowArchive && !archived ? (
        <Button type="button" variant="outline" disabled={pending} onClick={() => run(archiveRecord, true)}>
          <Archive className="size-4" /> Archive
        </Button>
      ) : null}
      {allowArchive && archived ? (
        <Button type="button" variant="outline" disabled={pending} onClick={() => run(restoreRecord, false)}>
          <ArchiveRestore className="size-4" /> Restore
        </Button>
      ) : null}
      {allowDelete ? (
        <Button type="button" variant="outline" className="text-destructive" onClick={openDelete}>
          <Trash2 className="size-4" /> Delete forever
        </Button>
      ) : null}
      {error && !open ? <p className="text-sm text-destructive">{error}</p> : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Delete forever</DialogTitle>
            <DialogDescription>
              This checks the record again when you confirm. A new invoice, payment, or other
              protected record stops the delete.
            </DialogDescription>
          </DialogHeader>
          {pending && !impact ? <p className="text-sm text-muted-foreground">Checking related records…</p> : null}
          {impact ? (
            <div className="space-y-3 text-sm">
              {impact.willDelete.length ? (
                <div>
                  <p className="font-medium">This will permanently delete:</p>
                  <ul className="mt-1 list-disc pl-5">
                    {impact.willDelete.map((item) => (
                      <li key={item.key}>
                        {item.count} {item.label}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {impact.willPreserve.length ? (
                <div>
                  <p className="font-medium">This will not delete:</p>
                  <ul className="mt-1 list-disc pl-5">
                    {impact.willPreserve.map((item) => (
                      <li key={item.key}>
                        {item.count} {item.label}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {!impact.canDeleteForever ? (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">
                  Deletion is blocked because protected records exist.
                </p>
              ) : (
                <p className="font-medium">This action cannot be undone.</p>
              )}
              {impact.canDeleteForever ? (
                <label className="block space-y-1.5">
                  <span>
                    Type <span className="font-mono text-destructive">{impact.confirmPhrase}</span>
                  </span>
                  <Input value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="off" />
                </label>
              ) : null}
            </div>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Keep record
            </Button>
            {impact?.canDeleteForever ? (
              <Button
                type="button"
                disabled={pending || confirm.trim().toUpperCase() !== impact.confirmPhrase.toUpperCase()}
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={commitDelete}
              >
                {pending ? "Deleting…" : "Delete forever"}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
