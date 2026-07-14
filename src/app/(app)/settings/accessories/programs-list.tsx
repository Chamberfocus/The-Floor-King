"use client";

import { useMemo, useState, useTransition } from "react";
import { ChevronDown, ChevronRight, Plus, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedField } from "@/components/ui/segmented-field";
import { SubmitButton } from "@/components/ui/submit-button";
import { DEFAULT_PIECE_LENGTH_IN } from "@/lib/accessories";
import type { AccessoryType } from "@/lib/types";
import type { ProgramSummary } from "@/lib/data/accessories";
import { generateProgram, regenerateAll, saveProgram, saveProgramType } from "./actions";

const SHOW = 25;

/**
 * The programs. Each binds a set of priced types to a real flooring line, so its
 * colors come from the floors we actually carry — add a color to the catalog and
 * it shows up here as pending, with no second list to maintain.
 */
export function ProgramsList({
  summaries,
  types,
}: {
  summaries: ProgramSummary[];
  types: AccessoryType[];
}) {
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(SHOW);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const rows = term
      ? summaries.filter((s) =>
          [s.program.name, s.program.manufacturer, s.program.style]
            .filter(Boolean)
            .some((v) => v!.toLowerCase().includes(term)),
        )
      : summaries;
    // Programs with new colors waiting float to the top — that's the work.
    return [...rows].sort(
      (a, b) => b.missing - a.missing || b.itemCount - a.itemCount,
    );
  }, [summaries, q]);

  const pendingNew = summaries.reduce((n, s) => n + s.missing, 0);

  const regenAll = () =>
    start(async () => {
      const r = await regenerateAll();
      if (r.error) toast.error(r.error);
      else
        toast.success(
          `${r.created} created · ${r.updated} updated · ${r.unchanged} unchanged` +
            (r.retired ? ` · ${r.retired} retired` : ""),
        );
    });

  return (
    <Card className="mb-6">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Programs</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              One per flooring line. Colors are read live from that line&apos;s
              products — you never keep a second color list.
            </p>
          </div>
          <div className="flex gap-2">
            {pendingNew > 0 && (
              <Button size="sm" onClick={regenAll} disabled={pending}>
                <RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} />
                Generate {pendingNew.toLocaleString()} new
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus className="size-4" /> New program
            </Button>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setLimit(SHOW);
            }}
            placeholder="Search by manufacturer or line…"
            className="pl-8"
          />
        </div>
      </CardHeader>

      <CardContent>
        {adding && <ProgramForm onDone={() => setAdding(false)} />}

        {!filtered.length && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {summaries.length
              ? "No programs match that search."
              : "No programs yet. Adopt your imported trim above, or add one."}
          </p>
        )}

        <div className="divide-y">
          {filtered.slice(0, limit).map((s) => (
            <ProgramRow
              key={s.program.id}
              summary={s}
              types={types}
              open={open === s.program.id}
              onToggle={() =>
                setOpen(open === s.program.id ? null : s.program.id)
              }
            />
          ))}
        </div>

        {filtered.length > limit && (
          <div className="pt-4 text-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLimit((n) => n + 50)}
            >
              Show more ({(filtered.length - limit).toLocaleString()} more)
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProgramRow({
  summary,
  types,
  open,
  onToggle,
}: {
  summary: ProgramSummary;
  types: AccessoryType[];
  open: boolean;
  onToggle: () => void;
}) {
  const [pending, start] = useTransition();
  const { program, colors, itemCount, missing, adopted } = summary;

  const generate = () =>
    start(async () => {
      const r = await generateProgram(program.id);
      if (r.error) toast.error(r.error);
      else
        toast.success(
          `${r.created} created · ${r.updated} updated · ${r.unchanged} unchanged` +
            (r.kept ? ` · ${r.kept} vendor items kept as-is` : "") +
            (r.retired ? ` · ${r.retired} retired` : ""),
        );
    });

  const byId = new Map(summary.types.map((pt) => [pt.type_id, pt]));

  return (
    <div className="py-2">
      <div className="flex items-center gap-2">
        <button
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {open ? (
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{program.name}</div>
            <div className="text-xs text-muted-foreground">
              {colors.length} colors · {summary.types.length} types ·{" "}
              {itemCount.toLocaleString()} items
              {adopted > 0 && ` (${adopted.toLocaleString()} from your vendor list)`}
            </div>
          </div>
        </button>
        {missing > 0 && (
          <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {missing} new
          </Badge>
        )}
        <Button size="sm" variant="outline" onClick={generate} disabled={pending}>
          <RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} />
          {missing > 0 ? "Generate" : "Regenerate"}
        </Button>
      </div>

      {open && (
        <div className="mt-3 space-y-4 rounded-lg border bg-muted/30 p-4">
          <div>
            <div className="mb-1.5 text-sm font-medium">
              Colors from this line ({colors.length})
            </div>
            {colors.length ? (
              <div className="flex flex-wrap gap-1">
                {colors.slice(0, 40).map((c) => (
                  <Badge key={c.key} variant="secondary" className="font-normal">
                    {c.display}
                  </Badge>
                ))}
                {colors.length > 40 && (
                  <span className="self-center text-xs text-muted-foreground">
                    +{colors.length - 40} more
                  </span>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No flooring products carry a color on this line yet. Add colors to
                the flooring products and they&apos;ll appear here automatically.
              </p>
            )}
          </div>

          <div>
            <div className="mb-1.5 text-sm font-medium">Types &amp; prices</div>
            <p className="mb-2 text-xs text-muted-foreground">
              One price per type — every color on this line inherits it. A single
              color can still be overridden on its own catalog item.
            </p>
            <div className="space-y-1.5">
              {types.map((t) => (
                <ProgramTypeRow
                  key={t.id}
                  programId={program.id}
                  type={t}
                  current={byId.get(t.id)}
                  colorCount={colors.length}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProgramTypeRow({
  programId,
  type,
  current,
  colorCount,
}: {
  programId: string;
  type: AccessoryType;
  current?: { price: number; unit: string | null; piece_length_in: number | null };
  colorCount: number;
}) {
  const on = !!current;
  const unit = current?.unit ?? type.unit;
  const items =
    type.axis === "color"
      ? colorCount
      : type.axis === "size"
        ? Math.max(type.sizes.length, 1)
        : 1;

  async function save(formData: FormData) {
    const r = await saveProgramType(formData);
    if (r.error) toast.error(r.error);
  }

  return (
    <form
      action={save}
      className="flex flex-wrap items-center gap-2 rounded-md border bg-background p-2"
    >
      <input type="hidden" name="program_id" value={programId} />
      <input type="hidden" name="type_id" value={type.id} />
      <input type="hidden" name="unit" value={unit} />
      <input
        type="hidden"
        name="piece_length_in"
        value={current?.piece_length_in ?? type.piece_length_in ?? DEFAULT_PIECE_LENGTH_IN}
      />
      <label className="flex flex-1 items-center gap-2">
        <input
          type="checkbox"
          name="on"
          defaultChecked={on}
          className="size-4 rounded border-input"
        />
        <span className="text-sm font-medium">{type.name}</span>
      </label>
      <span className="text-xs text-muted-foreground">
        {items} item{items === 1 ? "" : "s"}
      </span>
      <div className="flex items-center gap-1">
        <span className="text-sm text-muted-foreground">$</span>
        <Input
          name="price"
          inputMode="decimal"
          defaultValue={current?.price ?? type.default_price ?? ""}
          placeholder="0.00"
          className="h-8 w-24"
        />
        <span className="w-20 text-xs text-muted-foreground">
          / {unit === "lnft" ? "ln ft" : "piece"}
        </span>
      </div>
      <SubmitButton size="sm" variant="outline" pendingText="…" confirm={null}>
        Set
      </SubmitButton>
    </form>
  );
}

function ProgramForm({ onDone }: { onDone: () => void }) {
  const [source, setSource] = useState("line");

  async function save(formData: FormData) {
    const r = await saveProgram(formData);
    if (r.error) toast.error(r.error);
    else onDone();
  }

  return (
    <form action={save} className="mb-4 space-y-4 rounded-lg border bg-muted/30 p-4">
      <input type="hidden" name="active" value="1" />
      <div className="space-y-1.5">
        <Label>Where do the colors come from?</Label>
        <SegmentedField
          name="color_source"
          value={source}
          onChange={setSource}
          options={[
            { value: "line", label: "A product line" },
            { value: "manufacturer", label: "A whole brand" },
            { value: "manual", label: "A typed list" },
          ]}
        />
      </div>

      {source !== "manual" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="prog-mfr">Manufacturer</Label>
            <Input id="prog-mfr" name="manufacturer" placeholder="Mannington" required />
          </div>
          {source === "line" && (
            <div className="space-y-1.5">
              <Label htmlFor="prog-style">Product line (style)</Label>
              <Input id="prog-style" name="style" placeholder="Adura Max" />
              <p className="text-xs text-muted-foreground">
                Must match the style on the flooring products exactly.
              </p>
            </div>
          )}
        </div>
      )}

      {source === "manual" && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="prog-name">Program name</Label>
            <Input id="prog-name" name="name" placeholder="Versatrim — stock colors" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prog-colors">Colors</Label>
            <Input
              id="prog-colors"
              name="manual_colors"
              placeholder="Gunstock Oak, Gray Ash, Driftwood"
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated. Use this only for generic stock that isn&apos;t tied
              to one flooring line.
            </p>
          </div>
        </>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton pendingText="Saving…" confirm="Program added">
          Add program
        </SubmitButton>
      </div>
    </form>
  );
}
