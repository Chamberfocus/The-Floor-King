"use client";

import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { LayoutGrid, Printer, Plus, Trash2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { saveMeasurementDiagram } from "@/app/(app)/customers/[id]/document-actions";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  planCarpet,
  ftToFtIn,
  ROLL_WIDTHS,
  type CarpetPlan,
  type RunChoice,
} from "@/lib/carpet-layout";

const num = (v: string) => {
  const x = parseFloat(v);
  return Number.isFinite(x) && x > 0 ? x : 0;
};
const feet = (ft: string, inch: string) => num(ft) + num(inch) / 12;

interface Area {
  id: string;
  name: string;
  lf: string;
  li: string;
  wf: string;
  wi: string;
}

let aid = 0;
const splitFt = (v?: number) => {
  if (!v || v <= 0) return { f: "", i: "" };
  const f = Math.floor(v);
  const i = Math.round((v - f) * 12);
  return { f: String(f), i: i ? String(i) : "" };
};
const newArea = (name = "", lenFt?: number, widFt?: number): Area => {
  const l = splitFt(lenFt);
  const w = splitFt(widFt);
  return { id: `a${aid++}`, name, lf: l.f, li: l.i, wf: w.f, wi: w.i };
};

/**
 * Carpet seam/cut planner + installer diagram. Enter each rectangular area of
 * the room (an L-shape is two rectangles). It works out how much carpet to buy
 * off a 12'/13'6"/15' roll — running drops one direction so the nap matches,
 * rounding to the pattern repeat — and draws a to-scale diagram per area.
 *
 * Each area is planned on its own, which NEVER under-orders. For one continuous
 * L-shaped space the installer can run drops across both parts and reuse offcuts
 * to trim the waste below this safe figure.
 */
export function CarpetPlanner({
  triggerLabel = "Carpet plan & diagram",
  triggerVariant = "outline",
  triggerSize = "sm",
  triggerClassName,
  roomName,
  initialLengthFt,
  initialWidthFt,
  initialAreas,
  customerId,
  onApply,
}: {
  triggerLabel?: string;
  triggerVariant?: "outline" | "ghost" | "default";
  triggerSize?: "sm" | "default" | "lg";
  triggerClassName?: string;
  roomName?: string;
  initialLengthFt?: number;
  initialWidthFt?: number;
  initialAreas?: { name: string; lengthFt: number; widthFt: number }[];
  customerId?: string;
  onApply?: (purchasedSqft: number, perimeterFt: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [areas, setAreas] = useState<Area[]>(
    initialAreas && initialAreas.length
      ? initialAreas.map((a) => newArea(a.name, a.lengthFt, a.widthFt))
      : [newArea(roomName ?? "Main area", initialLengthFt, initialWidthFt)],
  );
  const [roll, setRoll] = useState(12);
  const [repeat, setRepeat] = useState("");
  const [run, setRun] = useState<RunChoice>("auto");
  const [saving, setSaving] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const set = (id: string, patch: Partial<Area>) =>
    setAreas((as) => as.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  const planned = areas.map((a) => {
    const L = feet(a.lf, a.li);
    const W = feet(a.wf, a.wi);
    return {
      area: a,
      L,
      W,
      plan: planCarpet({
        roomLengthFt: L,
        roomWidthFt: W,
        rollWidthFt: roll,
        patternRepeatIn: num(repeat),
        seamAllowanceIn: 3,
        run,
      }),
    };
  });

  const valid = planned.filter((p) => p.plan);
  const totals = valid.reduce(
    (t, p) => {
      const pl = p.plan!;
      return {
        linearFt: t.linearFt + pl.linearFt,
        purchasedSqft: t.purchasedSqft + pl.purchasedSqft,
        roomSqft: t.roomSqft + pl.roomSqft,
        seams: t.seams + pl.seams.length,
        perimeter: t.perimeter + 2 * (p.L + p.W),
      };
    },
    { linearFt: 0, purchasedSqft: 0, roomSqft: 0, seams: 0, perimeter: 0 },
  );
  const totalSqyd = Math.round((totals.purchasedSqft / 9) * 100) / 100;
  const roomSqyd = Math.round((totals.roomSqft / 9) * 100) / 100;
  const wastePct =
    totals.roomSqft > 0
      ? Math.round(((totals.purchasedSqft - totals.roomSqft) / totals.roomSqft) * 1000) / 10
      : 0;

  const print = () => {
    const svgs = printRef.current?.querySelectorAll("svg");
    if (!svgs || !svgs.length) return;
    const w = window.open("", "_blank", "width=900,height=800");
    if (!w) return;
    const blocks = Array.from(svgs)
      .map((s, i) => {
        const p = valid[i]?.plan;
        const nm = valid[i]?.area.name || `Area ${i + 1}`;
        return (
          `<div style="page-break-inside:avoid;margin-bottom:20px">` +
          `<h2 style="font-size:15px;margin:0 0 2px">${nm}</h2>` +
          (p
            ? `<p style="color:#555;font-size:12px;margin:0 0 6px">` +
              `Roll ${ftToFtIn(p.rollWidthFt)} · run the ${p.runDirection} · ` +
              `${p.drops.length} drop${p.drops.length === 1 ? "" : "s"}, ${p.seams.length} seam${p.seams.length === 1 ? "" : "s"} · ` +
              `${p.linearFt} lin ft = ${p.purchasedSqyd} sq yd</p>`
            : "") +
          s.outerHTML +
          `</div>`
        );
      })
      .join("");
    w.document.write(
      `<html><head><title>Carpet diagram — ${roomName || "job"}</title>` +
        `<style>body{font-family:system-ui,sans-serif;margin:24px;color:#111}` +
        `h1{font-size:18px;margin:0 0 4px}svg{max-width:100%;height:auto}</style></head><body>` +
        `<h1>Carpet install diagram — ${roomName || "Job"}</h1>` +
        `<p style="color:#555;font-size:13px">Total carpet to buy: <b>${totalSqyd} sq yd</b> (${totals.linearFt} linear ft, ${wastePct}% waste)` +
        (num(repeat) > 0 ? ` · ${num(repeat)}" pattern repeat` : "") +
        `</p>` +
        blocks +
        `</body></html>`,
    );
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  // Save each area's diagram (as an SVG file) to the job as a measurement
  // document, so installers see it next to the salesperson's sketch.
  const saveToJob = async () => {
    if (!customerId) return;
    const svgs = printRef.current?.querySelectorAll("svg");
    if (!svgs || !svgs.length) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("customer_id", customerId);
      const base = (roomName || "carpet").replace(/[^a-z0-9]+/gi, "-");
      Array.from(svgs).forEach((svg, i) => {
        const nm = (valid[i]?.area.name || `area-${i + 1}`).replace(
          /[^a-z0-9]+/gi,
          "-",
        );
        const xml = new XMLSerializer().serializeToString(svg);
        const file = new File(
          [`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`],
          `carpet-diagram-${base}-${nm}.svg`,
          { type: "image/svg+xml" },
        );
        fd.append("file", file);
      });
      const res = await saveMeasurementDiagram(fd);
      if (res?.error) toast.error(res.error);
      else toast.success("Diagram saved to the job for installers");
    } catch {
      toast.error("Couldn't save the diagram.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant={triggerVariant}
        size={triggerSize}
        className={triggerClassName}
        onClick={() => setOpen(true)}
      >
        <LayoutGrid className="size-3.5" /> {triggerLabel}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Carpet calculator &amp; diagram</DialogTitle>
            <DialogDescription>
              Type each room&apos;s length and width. We add up the total area and
              tell you exactly how much carpet to order, then draw the cut plan.
              (An L-shaped room is just two rectangles — add a row for each.)
            </DialogDescription>
          </DialogHeader>

          {/* Advanced options — hidden by default so a non-flooring person can
              just enter room sizes. Sensible defaults: 12' roll, plain, auto. */}
          <div className="rounded-lg border">
            <button
              type="button"
              onClick={() => setShowOptions((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-xs text-muted-foreground"
            >
              <span>
                Carpet options — roll {ftToFtIn(roll)}
                {num(repeat) > 0 ? ` · ${num(repeat)}" pattern` : " · plain"} ·{" "}
                {run === "auto" ? "least-waste direction" : `run the ${run}`}
              </span>
              <span className="font-medium text-foreground">
                {showOptions ? "Hide" : "Change"}
              </span>
            </button>
            {showOptions ? (
              <div className="grid gap-3 border-t p-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    How wide is the carpet roll?
                  </label>
                  <div className="flex gap-1.5">
                    {ROLL_WIDTHS.map((rw) => (
                      <button
                        key={rw}
                        type="button"
                        onClick={() => setRoll(rw)}
                        className={cn(
                          "rounded-md border px-2.5 py-1.5 text-sm",
                          roll === rw
                            ? "border-primary bg-primary text-primary-foreground"
                            : "hover:bg-muted",
                        )}
                      >
                        {ftToFtIn(rw)}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Patterned carpet? Repeat size (inches)
                  </label>
                  <Input
                    value={repeat}
                    onChange={(e) => setRepeat(e.target.value)}
                    inputMode="decimal"
                    placeholder="0 = no pattern"
                    className="h-9 w-32"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Direction to run it
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        ["auto", "Auto (least waste)"],
                        ["length", "Length"],
                        ["width", "Width"],
                      ] as [RunChoice, string][]
                    ).map(([val, label]) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setRun(val)}
                        className={cn(
                          "rounded-md border px-2.5 py-1.5 text-sm",
                          run === val
                            ? "border-primary bg-primary text-primary-foreground"
                            : "hover:bg-muted",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {/* Areas */}
          <div ref={printRef} className="space-y-4">
            {planned.map((p, idx) => (
              <div key={p.area.id} className="rounded-lg border p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Input
                    value={p.area.name}
                    onChange={(e) => set(p.area.id, { name: e.target.value })}
                    placeholder={`Area ${idx + 1}`}
                    className="h-9 max-w-[12rem]"
                  />
                  <DimRow
                    a={p.area}
                    onChange={(patch) => set(p.area.id, patch)}
                  />
                  {p.L > 0 && p.W > 0 ? (
                    <span className="text-xs font-medium tabular-nums text-foreground">
                      = {Math.round(p.L * p.W * 10) / 10} sq ft
                    </span>
                  ) : null}
                  {areas.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove area"
                      onClick={() =>
                        setAreas((as) => as.filter((x) => x.id !== p.area.id))
                      }
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  ) : null}
                </div>

                {p.plan ? (
                  <>
                    <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        <b className="text-primary">{p.plan.purchasedSqyd} sq yd</b>{" "}
                        to buy
                      </span>
                      <span>{p.plan.linearFt} lin ft</span>
                      <span>
                        {p.plan.drops.length} drop
                        {p.plan.drops.length === 1 ? "" : "s"},{" "}
                        {p.plan.seams.length} seam
                        {p.plan.seams.length === 1 ? "" : "s"}
                      </span>
                      <span>run the {p.plan.runDirection}</span>
                      <span>{p.plan.wastePct}% waste</span>
                    </div>
                    <div className="overflow-x-auto rounded border bg-white p-1">
                      <CarpetDiagram plan={p.plan} roomName={p.area.name} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Cut:{" "}
                      {p.plan.drops
                        .map(
                          (d) =>
                            `#${d.index} ${ftToFtIn(d.widthFt)}×${ftToFtIn(d.cutLengthFt)}${d.isFill ? " (fill)" : ""}`,
                        )
                        .join(" · ")}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Enter length &amp; width for this area.
                  </p>
                )}
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAreas((as) => [...as, newArea()])}
            >
              <Plus className="size-3.5" /> Add area (L-shape / extra room)
            </Button>
          </div>

          {/* Totals — plain language */}
          {valid.length > 0 ? (
            <div className="space-y-2 rounded-lg border-2 border-primary/30 bg-primary/5 p-3">
              <div className="text-sm">
                <span className="text-muted-foreground">
                  Total floor area ({areas.filter((a) => feet(a.lf, a.li) > 0 && feet(a.wf, a.wi) > 0).length} room
                  {valid.length === 1 ? "" : "s"}):{" "}
                </span>
                <span className="font-semibold tabular-nums">
                  {Math.round(totals.roomSqft * 10) / 10} sq ft
                </span>{" "}
                <span className="text-muted-foreground">({roomSqyd} sq yd)</span>
              </div>
              <div className="text-base">
                <span className="text-muted-foreground">Carpet to order: </span>
                <span className="text-2xl font-bold tabular-nums text-primary">
                  {totalSqyd} sq&nbsp;yd
                </span>{" "}
                <span className="text-sm text-muted-foreground">
                  ({Math.round(totals.linearFt * 10) / 10} linear ft off a{" "}
                  {ftToFtIn(roll)} roll · {totals.seams} seam
                  {totals.seams === 1 ? "" : "s"} · {wastePct}% waste)
                </span>
              </div>
              {areas.length > 1 ? (
                <p className="text-xs text-muted-foreground">
                  Each room is figured on its own, so this order is never short.
                  For one continuous L-shaped space the installer can run carpet
                  across both parts and reuse offcuts to trim the waste.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="rounded-lg border bg-muted/30 p-3 text-center text-sm text-muted-foreground">
              Enter a room&apos;s length and width above to see the total and the
              carpet you need.
            </p>
          )}

          <DialogFooter className="gap-2">
            {valid.length > 0 ? (
              <Button type="button" variant="outline" onClick={print}>
                <Printer className="size-4" /> Print diagram
              </Button>
            ) : null}
            {customerId && valid.length > 0 ? (
              <Button
                type="button"
                variant="outline"
                onClick={saveToJob}
                disabled={saving}
              >
                <Save className="size-4" /> {saving ? "Saving…" : "Save to job"}
              </Button>
            ) : null}
            <div className="flex-1" />
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
            {onApply && valid.length > 0 ? (
              <Button
                type="button"
                onClick={() => {
                  onApply(
                    Math.round(totals.purchasedSqft * 100) / 100,
                    totals.perimeter,
                  );
                  setOpen(false);
                }}
              >
                Use {totalSqyd} sq yd
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DimRow({
  a,
  onChange,
}: {
  a: Area;
  onChange: (patch: Partial<Area>) => void;
}) {
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <Input value={a.lf} onChange={(e) => onChange({ lf: e.target.value })} inputMode="decimal" placeholder="ft" className="h-9 w-14" />
      <span>'</span>
      <Input value={a.li} onChange={(e) => onChange({ li: e.target.value })} inputMode="decimal" placeholder="in" className="h-9 w-12" />
      <span className="px-1">×</span>
      <Input value={a.wf} onChange={(e) => onChange({ wf: e.target.value })} inputMode="decimal" placeholder="ft" className="h-9 w-14" />
      <span>'</span>
      <Input value={a.wi} onChange={(e) => onChange({ wi: e.target.value })} inputMode="decimal" placeholder="in" className="h-9 w-12" />
    </div>
  );
}

/** To-scale top-down diagram: drops, seam(s), run/nap arrow, dimensions. */
function CarpetDiagram({
  plan,
  roomName,
}: {
  plan: CarpetPlan;
  roomName?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const runLen = plan.drops[0]?.coverLengthFt ?? 0;
  const across = plan.drops.reduce((a, d) => a + d.widthFt, 0);
  const roomWidthFt = plan.runDirection === "length" ? across : runLen;
  const roomLengthFt = plan.runDirection === "length" ? runLen : across;

  const M = 46;
  const BOX = 360;
  const scale = BOX / Math.max(roomWidthFt, roomLengthFt, 1);
  const rw = roomWidthFt * scale;
  const rh = roomLengthFt * scale;
  const W = rw + M * 2;
  const H = rh + M * 2;
  const fills = ["#e0f2fe", "#ede9fe", "#dcfce7", "#fef9c3", "#ffe4e6"];

  const rects = plan.drops.map((d, idx) =>
    plan.runDirection === "length"
      ? {
          d,
          x: M + d.acrossStartFt * scale,
          y: M,
          w: d.widthFt * scale,
          h: rh,
          fill: fills[idx % fills.length],
        }
      : {
          d,
          x: M,
          y: M + d.acrossStartFt * scale,
          w: rw,
          h: d.widthFt * scale,
          fill: fills[idx % fills.length],
        },
  );

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      style={{ maxWidth: "100%", height: "auto" }}
    >
      <rect x={0} y={0} width={W} height={H} fill="white" />
      {rects.map((r, i) => {
        // Label runs along the drop's LONG axis; font is clamped to its short
        // axis so it never overflows a narrow fill strip.
        const vertical = plan.runDirection === "length"; // tall strips
        const shortPx = vertical ? r.w : r.h;
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        const fs = Math.max(8, Math.min(13, shortPx * 0.42));
        const label = `Drop ${r.d.index}${r.d.isFill ? " (fill)" : ""} · ${ftToFtIn(r.d.widthFt)}×${ftToFtIn(r.d.cutLengthFt)}`;
        return (
          <g key={i}>
            <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} stroke="#94a3b8" strokeWidth={1} />
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={fs}
              fontWeight="600"
              fill="#0f172a"
              transform={vertical ? `rotate(-90 ${cx} ${cy})` : undefined}
            >
              {label}
            </text>
          </g>
        );
      })}

      {plan.seams.map((s, i) =>
        plan.runDirection === "length" ? (
          <line key={i} x1={M + s * scale} y1={M} x2={M + s * scale} y2={M + rh} stroke="#dc2626" strokeWidth={2} strokeDasharray="6 4" />
        ) : (
          <line key={i} x1={M} y1={M + s * scale} x2={M + rw} y2={M + s * scale} stroke="#dc2626" strokeWidth={2} strokeDasharray="6 4" />
        ),
      )}

      <rect x={M} y={M} width={rw} height={rh} fill="none" stroke="#0f172a" strokeWidth={2} />

      <NapArrow markerId={`nap-${uid}`} dir={plan.runDirection} cx={M + rw / 2} cy={M + rh / 2} rw={rw} rh={rh} />

      <text x={M + rw / 2} y={M - 16} textAnchor="middle" fontSize={13} fontWeight="600" fill="#0f172a">
        {ftToFtIn(roomWidthFt)} wide
      </text>
      <text x={16} y={M + rh / 2} textAnchor="middle" fontSize={13} fontWeight="600" fill="#0f172a" transform={`rotate(-90 16 ${M + rh / 2})`}>
        {ftToFtIn(roomLengthFt)} long
      </text>

      {plan.seams.length > 0 ? (
        <text x={M} y={H - 10} fontSize={11} fill="#dc2626">— — seam ({plan.seams.length})</text>
      ) : (
        <text x={M} y={H - 10} fontSize={11} fill="#16a34a">No seam — fits the roll</text>
      )}
      <text x={W - 8} y={H - 10} textAnchor="end" fontSize={11} fill="#64748b">
        {roomName ? `${roomName} · ` : ""}roll {ftToFtIn(plan.rollWidthFt)}
      </text>
    </svg>
  );
}

function NapArrow({
  markerId,
  dir,
  cx,
  cy,
  rw,
  rh,
}: {
  markerId: string;
  dir: "length" | "width";
  cx: number;
  cy: number;
  rw: number;
  rh: number;
}) {
  const len = (dir === "length" ? rh : rw) * 0.4;
  const a =
    dir === "length"
      ? { x1: cx, y1: cy + len / 2, x2: cx, y2: cy - len / 2 }
      : { x1: cx - len / 2, y1: cy, x2: cx + len / 2, y2: cy };
  return (
    <g opacity={0.7}>
      <defs>
        <marker id={markerId} markerWidth="10" markerHeight="10" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#2563eb" />
        </marker>
      </defs>
      <line {...a} stroke="#2563eb" strokeWidth={3} markerEnd={`url(#${markerId})`} />
      <text
        x={dir === "length" ? cx + 10 : cx}
        y={dir === "length" ? cy : cy - 10}
        fontSize={11}
        fontWeight="700"
        fill="#2563eb"
        textAnchor={dir === "length" ? "start" : "middle"}
      >
        NAP / RUN
      </text>
    </g>
  );
}
