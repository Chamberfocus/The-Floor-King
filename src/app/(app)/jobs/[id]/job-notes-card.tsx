"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MessageSquarePlus, Printer, EyeOff, Pencil, Trash2, Package, Siren } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import {
  addWorkNote,
  updateWorkNote,
  deleteWorkNote,
  type WorkNote,
} from "./note-actions";

const TEXTAREA =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function NoteRow({
  note,
  jobId,
  canEdit,
}: {
  note: WorkNote;
  jobId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(note.body);
  const [onWo, setOnWo] = useState(note.on_work_order);
  const [forWhEdit, setForWhEdit] = useState(note.for_warehouse);
  const [urgentEdit, setUrgentEdit] = useState(note.urgent);
  const [busy, start] = useTransition();

  const save = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("id", note.id);
      fd.set("job_id", jobId);
      fd.set("body", body);
      if (onWo) fd.set("on_work_order", "on");
      if (forWhEdit) fd.set("for_warehouse", "on");
      if (forWhEdit && urgentEdit) fd.set("urgent", "on");
      const res = await updateWorkNote(fd);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });

  const remove = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("id", note.id);
      fd.set("job_id", jobId);
      const res = await deleteWorkNote(fd);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });

  if (editing) {
    return (
      <li className="rounded-md border bg-muted/30 p-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          className={TEXTAREA}
          aria-label="Edit note"
        />
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onWo}
            onChange={(e) => setOnWo(e.target.checked)}
            className="size-4"
          />
          Print on the crew&apos;s work order
        </label>
        <label className="mt-1 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={forWhEdit}
            onChange={(e) => setForWhEdit(e.target.checked)}
            className="size-4"
          />
          Show the warehouse
        </label>
        {forWhEdit ? (
          <label className="mt-1 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
            <input
              type="checkbox"
              checked={urgentEdit}
              onChange={(e) => setUrgentEdit(e.target.checked)}
              className="size-4"
            />
            Urgent — text them too
          </label>
        ) : null}
        <div className="mt-2 flex items-center gap-2">
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setBody(note.body);
              setOnWo(note.on_work_order);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="rounded-md border p-3">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-sm whitespace-pre-wrap">{note.body}</p>
        {canEdit ? (
          <div className="flex shrink-0 gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Edit note"
              onClick={() => setEditing(true)}
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Delete note"
              onClick={remove}
              disabled={busy}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ) : null}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          {note.authorName} · {formatDate(note.created_at)}
        </span>
        {note.on_work_order ? (
          <Badge variant="outline" className="gap-1">
            <Printer className="size-3" /> On work order
          </Badge>
        ) : null}
        {note.for_warehouse ? (
          <Badge variant="outline" className="gap-1">
            <Package className="size-3" /> Warehouse
          </Badge>
        ) : null}
        {note.urgent ? (
          <Badge className="gap-1 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            <Siren className="size-3" /> Urgent
          </Badge>
        ) : null}
        {!note.on_work_order && !note.for_warehouse ? (
          <Badge variant="outline" className="gap-1">
            <EyeOff className="size-3" /> Office only
          </Badge>
        ) : null}
      </div>
    </li>
  );
}

/**
 * The running note log on a job.
 *
 * Separate from jobs.notes, which is structured (job conditions, per-room prep)
 * and written by the questionnaire. These are the day-to-day things — "customer
 * will move the furniture", "subfloor worse than we thought" — and each one says
 * whether the crew sees it.
 */
export function JobNotesCard({
  jobId,
  notes,
  canEdit,
  isCrew,
}: {
  jobId: string;
  notes: WorkNote[];
  canEdit: boolean;
  isCrew: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [body, setBody] = useState("");
  const [onWo, setOnWo] = useState(true);
  const [forWh, setForWh] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [busy, start] = useTransition();

  const add = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("job_id", jobId);
      fd.set("body", body);
      if (onWo) fd.set("on_work_order", "on");
      if (forWh) fd.set("for_warehouse", "on");
      if (forWh && urgent) fd.set("urgent", "on");
      const res = await addWorkNote(fd);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setBody("");
      setUrgent(false);
      formRef.current?.querySelector("textarea")?.focus();
      toast.success(forWh ? "Note added — the warehouse has been told" : "Note added");
      router.refresh();
    });

  const onWoCount = notes.filter((n) => n.on_work_order).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          Notes
          {notes.length ? (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {notes.length} · {onWoCount} on the work order
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form ref={formRef} className="space-y-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            placeholder={
              isCrew
                ? "What did you find on site?"
                : "Anything the crew or office should know…"
            }
            className={TEXTAREA}
            aria-label="New note"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={add} disabled={busy || !body.trim()}>
              <MessageSquarePlus className="size-4" />
              {busy ? "Adding…" : "Add note"}
            </Button>
            {isCrew ? (
              <span className="text-xs text-muted-foreground">
                Your notes always show on the work order.
              </span>
            ) : (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={onWo}
                    onChange={(e) => setOnWo(e.target.checked)}
                    className="size-4"
                  />
                  Print on the crew&apos;s work order
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={forWh}
                    onChange={(e) => setForWh(e.target.checked)}
                    className="size-4"
                  />
                  Show the warehouse
                </label>
                {forWh ? (
                  <label className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
                    <input
                      type="checkbox"
                      checked={urgent}
                      onChange={(e) => setUrgent(e.target.checked)}
                      className="size-4"
                    />
                    Urgent — text them too
                  </label>
                ) : null}
              </>
            )}
          </div>
        </form>

        {notes.length ? (
          <ul className="space-y-2">
            {notes.map((n) => (
              <NoteRow key={n.id} note={n} jobId={jobId} canEdit={canEdit} />
            ))}
          </ul>
        ) : (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            No notes yet. Anything added here is stamped with who wrote it and
            when.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
