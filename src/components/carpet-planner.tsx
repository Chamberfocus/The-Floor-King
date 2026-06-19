"use client";

import { useRef, useState } from "react";
import { LayoutGrid, Printer } from "lucide-react";
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
import { cn } from "@/lib/utils";
import {
  planCarpet,
  ftToFtIn,
  ROLL_WIDTHS,
  type RunChoice,
} from "@/lib/carpet-layout";

const n = (v: string) => {
  const x = parseFloat(v);
  return Number.isFinite(x) && x > 0 ? x : 0;
};
const feet = (ft: string, inch: string) => n(ft) + n(inch) / 12;

/**
 * Carpet seam/cut planner + installer diagram. Enter the room size and it works
 * out how much carpet to buy off a 12'/13'6"/15' roll (running drops one way so
 * the nap matches, rounding to the pattern repeat), then draws a to-scale
 * diagram the installers can follow — run direction, seam, and each drop's size.
 */
export function CarpetPlanner({
  triggerLabel = "Carpet plan & diagram",
  triggerVariant = "outline",
  triggerSize = "sm",
  triggerClassName,
  roomName,
  initialLengthFt,
  initialWidthFt,
  onApply,
}: {
  triggerLabel?: string;
  triggerVariant?: "outline" | "ghost" | "default";
  triggerSize?: "sm" | "default" | "lg";
  triggerClassName?: string;
  roomName?: string;
  initialLengthFt?: number;
  initialWidthFt?: number;
  onApply?: (purchasedSqft: number, perimeterFt: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const splitFt = (v?: number) => {
    if (!v || v <= 0) return { f: "", i: "" };
    const f = Math.floor(v);
    const i = Math.round((v - f) * 12);
    return { f: String(f), i: i ? String(i) : "" };
  };
  const li0 = splitFt(initialLengthFt);
  const wi0 = splitFt(initialWidthFt);

  const [lf, setLf] = useState(li0.f);
  const [linch, setLinch] = useState(li0.i);
  const [wf, setWf] = useState(wi0.f);
  const [winch, setWinch] = useState(wi0.i);
  const [roll, setRoll] = useState(12);
  const [repeat, setRepeat] = useState("");
  const [run, setRun] = useState<RunChoice>("auto");
  const svgRef = useRef<HTMLDivElement>(null);

  const L = feet(lf, linch);
  const W = feet(wf, winch);
  const plan = planCarpet({
    roomLengthFt: L,
    roomWidthFt: W,
    rollWidthFt: roll,
    patternRepeatIn: n(repeat),
    seamAllowanceIn: 3,
    run,
  });

  const print = () => {
    const svg = svgRef.current?.querySelector("svg");
    if (!svg) return;
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    w.document.write(
      `<html><head><title>Carpet diagram — ${roomName || "room"}</title>` +
        `<style>body{font-family:system-ui,sans-serif;margin:24px;color:#111}` +
        `h1{font-size:18px;margin:0 0 4px}p{color:#555;margin:2px 0;font-size:13px}` +
        `svg{max-width:100%;height:auto;margin-top:12px}</style></head><body>` +
        `<h1>Carpet install diagram — ${roomName || "Room"}</h1>` +
        (plan
          ? `<p>Roll ${ftToFtIn(plan.rollWidthFt)} wide · run the ${plan.runDirection} · ` +
            `${plan.drops.length} drop${plan.drops.length === 1 ? "" : "s"}, ` +
            `${plan.seams.length} seam${plan.seams.length === 1 ? "" : "s"} · ` +
            `${plan.linearFt} linear ft = ${plan.purchasedSqyd} sq yd ` +
            `(${plan.wastePct}% waste)` +
            (plan.patternRepeatIn > 0
              ? ` · ${plan.patternRepeatIn}" pattern repeat`
              : "") +
            `</p>`
          : "") +
        svg.outerHTML +
        `</body></html>`,
    );
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
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
            <DialogTitle>Carpet plan &amp; install diagram</DialogTitle>
            <DialogDescription>
              How much carpet to buy and how to run it — accounting for the roll
              width, running the nap one direction, the seam, and the pattern
              repeat.
            </DialogDescription>
          </DialogHeader>

          {/* Inputs */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Dim label="Room length" f={lf} i={linch} setF={setLf} setI={setLinch} />
            <Dim label="Room width" f={wf} i={winch} setF={setWf} setI={setWinch} />
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Roll width
              </label>
              <div className="flex gap-1.5">
                {ROLL_WIDTHS.map((rw) => (
                  <button
                    key={rw}
                    type="button"
                    onClick={() => setRoll(rw)}
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-sm",
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
                Pattern repeat (inches, 0 = plain)
              </label>
              <Input
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                inputMode="decimal"
                placeholder="0"
                className="h-9 w-28"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-muted-foreground">
                Run direction
              </label>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["auto", "Auto (least waste)"],
                    ["length", "Run the length"],
                    ["width", "Run the width"],
                  ] as [RunChoice, string][]
                ).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setRun(val)}
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-sm",
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

          {plan ? (
            <>
              {/* Summary */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
                <Stat label="Carpet to buy" value={`${plan.purchasedSqyd} sq yd`} primary />
                <Stat label="Linear feet" value={`${plan.linearFt} ft`} />
                <Stat
                  label="Drops / seams"
                  value={`${plan.drops.length} / ${plan.seams.length}`}
                />
                <Stat label="Run" value={plan.runDirection} />
                <Stat label="Waste" value={`${plan.wastePct}%`} />
                <Stat label="Room" value={`${plan.roomSqyd} sq yd`} />
              </div>

              {/* Diagram */}
              <div ref={svgRef} className="overflow-x-auto rounded-lg border p-2">
                <CarpetDiagram plan={plan} roomName={roomName} />
              </div>
              <p className="text-xs text-muted-foreground">
                Cut list:{" "}
                {plan.drops
                  .map(
                    (d) =>
                      `#${d.index} ${ftToFtIn(d.widthFt)}×${ftToFtIn(
                        d.cutLengthFt,
                      )}${d.isFill ? " (fill)" : ""}`,
                  )
                  .join(" · ")}
              </p>
            </>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Enter the room length and width to plan the carpet.
            </p>
          )}

          <DialogFooter className="gap-2">
            {plan ? (
              <Button type="button" variant="outline" onClick={print}>
                <Printer className="size-4" /> Print diagram
              </Button>
            ) : null}
            <div className="flex-1" />
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
            {onApply && plan ? (
              <Button
                type="button"
                onClick={() => {
                  onApply(plan.purchasedSqft, 2 * (L + W));
                  setOpen(false);
                }}
              >
                Use {plan.purchasedSqyd} sq yd
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Dim({
  label,
  f,
  i,
  setF,
  setI,
}: {
  label: string;
  f: string;
  i: string;
  setF: (v: string) => void;
  setI: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      <div className="flex items-center gap-1">
        <Input value={f} onChange={(e) => setF(e.target.value)} inputMode="decimal" placeholder="ft" className="h-9 w-16" />
        <span className="text-xs text-muted-foreground">ft</span>
        <Input value={i} onChange={(e) => setI(e.target.value)} inputMode="decimal" placeholder="in" className="h-9 w-14" />
        <span className="text-xs text-muted-foreground">in</span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  primary,
}: {
  label: string;
  value: string;
  primary?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "font-semibold capitalize tabular-nums",
          primary ? "text-lg text-primary" : "text-sm",
        )}
      >
        {value}
      </div>
    </div>
  );
}

/** To-scale top-down diagram: drops, seam(s), run/nap arrow, dimensions. */
function CarpetDiagram({
  plan,
  roomName,
}: {
  plan: NonNullable<ReturnType<typeof planCarpet>>;
  roomName?: string;
}) {
  // Room dims back out from drops: across-axis total + run length.
  const runLen = plan.drops[0]?.coverLengthFt ?? 0;
  const across = plan.drops.reduce((a, d) => a + d.widthFt, 0);
  // Screen: X = room width, Y = room length.
  const roomWidthFt = plan.runDirection === "length" ? across : runLen;
  const roomLengthFt = plan.runDirection === "length" ? runLen : across;

  const M = 46; // margin for labels
  const BOX = 380;
  const scale = BOX / Math.max(roomWidthFt, roomLengthFt, 1);
  const rw = roomWidthFt * scale;
  const rh = roomLengthFt * scale;
  const W = rw + M * 2;
  const H = rh + M * 2;

  const fills = ["#e0f2fe", "#ede9fe", "#dcfce7", "#fef9c3", "#ffe4e6"];

  // Build drop rects in screen coords.
  const rects = plan.drops.map((d, idx) => {
    if (plan.runDirection === "length") {
      // vertical strips across X (width)
      return {
        d,
        x: M + d.acrossStartFt * scale,
        y: M,
        w: d.widthFt * scale,
        h: rh,
        fill: fills[idx % fills.length],
      };
    }
    // horizontal strips across Y (length)
    return {
      d,
      x: M,
      y: M + d.acrossStartFt * scale,
      w: rw,
      h: d.widthFt * scale,
      fill: fills[idx % fills.length],
    };
  });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      style={{ maxWidth: "100%", height: "auto" }}
    >
      <rect x={0} y={0} width={W} height={H} fill="white" />
      {rects.map((r, i) => (
        <g key={i}>
          <rect
            x={r.x}
            y={r.y}
            width={r.w}
            height={r.h}
            fill={r.fill}
            stroke="#94a3b8"
            strokeWidth={1}
          />
          <text
            x={r.x + r.w / 2}
            y={r.y + r.h / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={12}
            fill="#0f172a"
          >
            <tspan x={r.x + r.w / 2} dy="-0.6em" fontWeight="600">
              Drop {r.d.index}
              {r.d.isFill ? " (fill)" : ""}
            </tspan>
            <tspan x={r.x + r.w / 2} dy="1.2em">
              {ftToFtIn(r.d.widthFt)} × {ftToFtIn(r.d.cutLengthFt)}
            </tspan>
          </text>
        </g>
      ))}

      {/* Seams (dashed red along the run) */}
      {plan.seams.map((s, i) =>
        plan.runDirection === "length" ? (
          <line
            key={i}
            x1={M + s * scale}
            y1={M}
            x2={M + s * scale}
            y2={M + rh}
            stroke="#dc2626"
            strokeWidth={2}
            strokeDasharray="6 4"
          />
        ) : (
          <line
            key={i}
            x1={M}
            y1={M + s * scale}
            x2={M + rw}
            y2={M + s * scale}
            stroke="#dc2626"
            strokeWidth={2}
            strokeDasharray="6 4"
          />
        ),
      )}

      {/* Room outline */}
      <rect x={M} y={M} width={rw} height={rh} fill="none" stroke="#0f172a" strokeWidth={2} />

      {/* Run / nap arrow */}
      <NapArrow
        dir={plan.runDirection}
        cx={M + rw / 2}
        cy={M + rh / 2}
        rw={rw}
        rh={rh}
      />

      {/* Dimension labels */}
      <text x={M + rw / 2} y={M - 16} textAnchor="middle" fontSize={13} fontWeight="600" fill="#0f172a">
        {ftToFtIn(roomWidthFt)} wide
      </text>
      <text
        x={16}
        y={M + rh / 2}
        textAnchor="middle"
        fontSize={13}
        fontWeight="600"
        fill="#0f172a"
        transform={`rotate(-90 16 ${M + rh / 2})`}
      >
        {ftToFtIn(roomLengthFt)} long
      </text>

      {/* Seam legend */}
      {plan.seams.length > 0 ? (
        <text x={M} y={H - 10} fontSize={11} fill="#dc2626">
          — — seam ({plan.seams.length})
        </text>
      ) : (
        <text x={M} y={H - 10} fontSize={11} fill="#16a34a">
          No seam — fits the roll width
        </text>
      )}
      <text x={W - 8} y={H - 10} textAnchor="end" fontSize={11} fill="#64748b">
        {roomName ? `${roomName} · ` : ""}roll {ftToFtIn(plan.rollWidthFt)}
      </text>
    </svg>
  );
}

function NapArrow({
  dir,
  cx,
  cy,
  rw,
  rh,
}: {
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
        <marker id="nap" markerWidth="10" markerHeight="10" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#2563eb" />
        </marker>
      </defs>
      <line
        {...a}
        stroke="#2563eb"
        strokeWidth={3}
        markerEnd="url(#nap)"
      />
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
