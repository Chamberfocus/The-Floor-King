"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Plus,
  ChevronUp,
  ChevronDown,
  Pencil,
  Trash2,
  X,
  EyeOff,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SegmentedField } from "@/components/ui/segmented-field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ConfirmButton } from "@/components/ui/confirm-button";
import type { LeadSourceRow, LeadSourceSpendRow, LeadSourceDetailMode } from "@/lib/types";
import {
  addSource,
  updateSource,
  deleteSource,
  setSourceActive,
  moveSource,
  addDetail,
  deleteDetail,
  saveSpendValue,
  type SourceActionState,
} from "./actions";

const MODE_OPTIONS: { value: LeadSourceDetailMode; label: string }[] = [
  { value: "none", label: "No follow-up" },
  { value: "options", label: "Pick from a list" },
  { value: "referrer", label: "Who referred them" },
];
const MODE_HELP: Record<LeadSourceDetailMode, string> = {
  none: "Just the source — no extra question.",
  options: "Adds a second question answered from a list you manage (e.g. which campaign).",
  referrer: "Adds a “Referred by” question that can link to an existing customer.",
};
const initial: SourceActionState = { error: null };

const monthNow = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const monthLabel = (p: string) => {
  const [y, m] = p.split("-").map(Number);
  if (!y || !m) return p;
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
};

export function LeadSourceManager({
  sources,
  spend,
}: {
  sources: LeadSourceRow[];
  spend: LeadSourceSpendRow[];
}) {
  return (
    <div className="space-y-8">
      <section>
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-base">Add a source</CardTitle>
          </CardHeader>
          <CardContent>
            <AddSourceForm />
          </CardContent>
        </Card>

        <div className="space-y-2">
          {sources.map((s, i) => (
            <SourceCard
              key={s.id}
              source={s}
              isFirst={i === 0}
              isLast={i === sources.length - 1}
            />
          ))}
        </div>
      </section>

      {sources.length ? <SpendSection sources={sources} spend={spend} /> : null}
    </div>
  );
}

// ---- Add source ------------------------------------------------------------

function AddSourceForm() {
  const [state, formAction, pending] = useActionState(addSource, initial);
  const [mode, setMode] = useState<LeadSourceDetailMode>("none");
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) {
      toast.success("Source added");
      ref.current?.reset();
      setMode("none");
    }
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form ref={ref} action={formAction} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input name="label" placeholder="Source name (e.g. TikTok)" className="w-56" required />
        <Button type="submit" disabled={pending}>
          <Plus className="size-4" /> Add
        </Button>
      </div>
      <div className="space-y-1">
        <div className="text-xs font-medium text-muted-foreground">Follow-up question</div>
        <SegmentedField name="detail_mode" size="sm" value={mode} onChange={(v) => setMode(v as LeadSourceDetailMode)} options={MODE_OPTIONS} />
        <p className="text-xs text-muted-foreground">{MODE_HELP[mode]}</p>
      </div>
      {mode !== "none" ? (
        <div className="flex flex-wrap items-center gap-3">
          <Input
            name="detail_label"
            placeholder={mode === "referrer" ? "Label (e.g. Referred by)" : "Label (e.g. Which campaign?)"}
            className="w-56"
          />
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" name="detail_required" className="size-4" /> Required
          </label>
        </div>
      ) : null}
    </form>
  );
}

// ---- One source ------------------------------------------------------------

function SourceCard({
  source,
  isFirst,
  isLast,
}: {
  source: LeadSourceRow;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const details = (source.details ?? []).filter((d) => d.active);

  return (
    <div className={`rounded-lg border p-3 ${source.active ? "" : "opacity-60"}`}>
      <div className="flex items-center gap-2">
        <div className="flex flex-col">
          <button
            type="button"
            disabled={isFirst || pending}
            onClick={() => start(() => moveSource(source.id, -1))}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
            aria-label="Move up"
          >
            <ChevronUp className="size-4" />
          </button>
          <button
            type="button"
            disabled={isLast || pending}
            onClick={() => start(() => moveSource(source.id, 1))}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
            aria-label="Move down"
          >
            <ChevronDown className="size-4" />
          </button>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{source.label}</span>
            {source.detail_mode === "options" ? (
              <Badge>List{source.detail_required ? " · required" : ""}</Badge>
            ) : null}
            {source.detail_mode === "referrer" ? (
              <Badge>Referrer{source.detail_required ? " · required" : ""}</Badge>
            ) : null}
            {!source.active ? <Badge tone="muted">Hidden</Badge> : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => start(() => setSourceActive(source.id, !source.active))}
          className="text-muted-foreground hover:text-foreground"
          aria-label={source.active ? "Hide" : "Show"}
          title={source.active ? "Hide from the picker" : "Show in the picker"}
        >
          {source.active ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Edit"
        >
          <Pencil className="size-4" />
        </button>
        <ConfirmButton
          variant="ghost"
          size="icon"
          destructive
          title={`Delete “${source.label}”?`}
          description="If any customer already uses this source it will be hidden instead of deleted, so nothing is lost."
          confirmLabel="Delete"
          onConfirm={() =>
            deleteSource(source.id).then((r) => {
              if (r.error) toast.error(r.error);
            })
          }
        >
          <Trash2 className="size-4" />
        </ConfirmButton>
      </div>

      {source.detail_mode === "options" ? (
        <div className="mt-3 space-y-2 border-t pt-3 pl-6">
          <div className="text-xs font-medium text-muted-foreground">
            {source.detail_label || "Options"}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {details.length === 0 ? (
              <span className="text-xs text-muted-foreground">No options yet — add the first below.</span>
            ) : (
              details.map((d) => (
                <span
                  key={d.id}
                  className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-xs"
                >
                  {d.label}
                  <button
                    type="button"
                    onClick={() => start(() => deleteDetail(d.id))}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${d.label}`}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))
            )}
          </div>
          <AddDetailForm sourceId={source.id} />
        </div>
      ) : null}

      {editing ? (
        <EditSourceDialog source={source} onClose={() => setEditing(false)} />
      ) : null}
    </div>
  );
}

function Badge({ children, tone = "brand" }: { children: React.ReactNode; tone?: "brand" | "muted" }) {
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
        tone === "muted"
          ? "bg-muted text-muted-foreground"
          : "bg-primary/10 text-primary"
      }`}
    >
      {children}
    </span>
  );
}

function AddDetailForm({ sourceId }: { sourceId: string }) {
  const [state, formAction, pending] = useActionState(addDetail, initial);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
    if (state.error) toast.error(state.error);
  }, [state]);
  return (
    <form ref={ref} action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="source_id" value={sourceId} />
      <Input name="label" placeholder="Add an option (e.g. Spring sale campaign)" className="w-64" />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        <Plus className="size-4" /> Add
      </Button>
    </form>
  );
}

function EditSourceDialog({ source, onClose }: { source: LeadSourceRow; onClose: () => void }) {
  const [state, formAction, pending] = useActionState(updateSource, initial);
  const [mode, setMode] = useState<LeadSourceDetailMode>(source.detail_mode);
  useEffect(() => {
    if (state.ok) {
      toast.success("Saved");
      onClose();
    }
    if (state.error) toast.error(state.error);
  }, [state, onClose]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit source</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="id" value={source.id} />
          <div className="space-y-1">
            <label className="text-sm font-medium">Name</label>
            <Input name="label" defaultValue={source.label} required />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Follow-up question</label>
            <SegmentedField name="detail_mode" size="sm" value={mode} onChange={(v) => setMode(v as LeadSourceDetailMode)} options={MODE_OPTIONS} />
            <p className="text-xs text-muted-foreground">{MODE_HELP[mode]}</p>
          </div>
          {mode !== "none" ? (
            <div className="flex flex-wrap items-center gap-3">
              <Input
                name="detail_label"
                defaultValue={source.detail_label ?? ""}
                placeholder={mode === "referrer" ? "Referred by" : "Which campaign?"}
                className="w-56"
              />
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  name="detail_required"
                  defaultChecked={source.detail_required}
                  className="size-4"
                />{" "}
                Required
              </label>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---- Ad spend --------------------------------------------------------------

function SpendSection({
  sources,
  spend,
}: {
  sources: LeadSourceRow[];
  spend: LeadSourceSpendRow[];
}) {
  const [period, setPeriod] = useState(monthNow());
  const active = sources.filter((s) => s.active);
  const findSpend = (sid: string, did: string | null) =>
    spend.find((s) => s.source_id === sid && (s.detail_id ?? null) === did && s.period === period)?.amount ?? 0;

  return (
    <section>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ad spend</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm text-muted-foreground">Month</label>
            <input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="rounded-md border bg-transparent px-2 py-1 text-sm"
            />
            <span className="text-sm text-muted-foreground">{monthLabel(period)}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Enter what you spent on each source this month. Leave blank if you didn&apos;t spend
            there. The report turns this into cost per lead, cost per job, and return on ad spend.
          </p>
          <div className="divide-y">
            {active.map((s) => {
              const opts = s.detail_mode === "options" ? (s.details ?? []).filter((d) => d.active) : [];
              return (
                <div key={s.id} className="py-2">
                  <SpendRow
                    label={s.label}
                    period={period}
                    sourceId={s.id}
                    detailId={null}
                    initial={findSpend(s.id, null)}
                    bold
                  />
                  {opts.map((d) => (
                    <SpendRow
                      key={d.id}
                      label={d.label}
                      period={period}
                      sourceId={s.id}
                      detailId={d.id}
                      initial={findSpend(s.id, d.id)}
                      indent
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function SpendRow({
  label,
  period,
  sourceId,
  detailId,
  initial,
  bold,
  indent,
}: {
  label: string;
  period: string;
  sourceId: string;
  detailId: string | null;
  initial: number;
  bold?: boolean;
  indent?: boolean;
}) {
  const [pending, start] = useTransition();
  const save = (raw: string) => {
    const amount = parseFloat(raw) || 0;
    if (amount === initial) return;
    start(() =>
      saveSpendValue(sourceId, detailId, period, amount).then((r) => {
        if (r.error) toast.error(r.error);
      }),
    );
  };
  return (
    <div className={`flex items-center justify-between gap-2 py-1 ${indent ? "pl-4" : ""}`}>
      <span className={`text-sm ${bold ? "font-medium" : "text-muted-foreground"}`}>{label}</span>
      <div className="flex items-center gap-1">
        <span className="text-sm text-muted-foreground">$</span>
        <Input
          type="number"
          min="0"
          step="1"
          inputMode="decimal"
          defaultValue={initial || ""}
          placeholder="0"
          className="w-24 text-right"
          disabled={pending}
          onBlur={(e) => save(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          key={`${period}-${initial}`}
        />
      </div>
    </div>
  );
}
