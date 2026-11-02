"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  commitMeasureAreaInput,
  formatMeasureArea,
  formatMeasureAreaLabel,
  measureAreaUnitLabel,
  type MeasureAreaUnit,
} from "@/lib/measure-area-unit";

const STORAGE_KEY = "fk-measure-area-unit";
const EVENT_NAME = "fk-measure-area-unit";

function readStoredUnit(): MeasureAreaUnit | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "sqyd" || v === "sqft" ? v : null;
  } catch {
    return null;
  }
}

/** Shared sq ft / sq yd choice. Every measurement surface reads the same value. */
export function useMeasureAreaUnit() {
  const [unit, setUnitState] = useState<MeasureAreaUnit>("sqft");

  useEffect(() => {
    const stored = readStoredUnit();
    if (stored) setUnitState(stored);
    const onEvent = (e: Event) => {
      const next = (e as CustomEvent<string>).detail;
      if (next === "sqft" || next === "sqyd") setUnitState(next);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      if (e.newValue === "sqft" || e.newValue === "sqyd") setUnitState(e.newValue);
    };
    window.addEventListener(EVENT_NAME, onEvent);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT_NAME, onEvent);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setUnit = (next: MeasureAreaUnit) => {
    setUnitState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode — this tab still switches */
    }
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }));
  };

  return { unit, setUnit };
}

export function MeasureAreaUnitToggle({ className }: { className?: string }) {
  const { unit, setUnit } = useMeasureAreaUnit();
  return (
    <div
      role="group"
      aria-label="Work in square feet or square yards"
      title="Switch square feet and square yards anytime. Dimensions stay in feet and inches, and the area converts."
      className={cn("inline-flex shrink-0 rounded-md border p-0.5 text-xs", className)}
    >
      {(
        [
          ["sqft", "Sq ft"],
          ["sqyd", "Sq yd"],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={unit === value}
          onClick={() => setUnit(value)}
          className={cn(
            "rounded px-2.5 py-1 font-medium",
            unit === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Read-only measured area in the salesperson's working unit. */
export function MeasureAreaReadout({
  sqft,
  className,
}: {
  sqft: number;
  className?: string;
}) {
  const { unit } = useMeasureAreaUnit();
  if (!(sqft > 0)) return null;
  return <span className={className}>{formatMeasureAreaLabel(sqft, unit)}</span>;
}

/**
 * Area total the salesperson types. `sqft` is always stored square feet.
 * The field shows and accepts the working unit, and flipping the unit
 * converts a half-typed value instead of dropping it.
 */
export function useAreaAmountDraft(sqft: string, onSqft: (sqft: string) => void) {
  const { unit } = useMeasureAreaUnit();
  const [draft, setDraft] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const unitRef = useRef(unit);
  const onSqftRef = useRef(onSqft);
  onSqftRef.current = onSqft;

  useEffect(() => {
    if (unitRef.current === unit) return;
    const prev = unitRef.current;
    unitRef.current = unit;
    const pending = draftRef.current;
    if (pending != null) {
      const committed = commitMeasureAreaInput(pending, prev);
      if (committed != null) onSqftRef.current(committed);
      draftRef.current = null;
      setDraft(null);
    }
  }, [unit]);

  const trimmed = sqft.trim();
  const parsed = Number(trimmed);
  const shown =
    draft ??
    (trimmed === "" || !Number.isFinite(parsed) ? "" : formatMeasureArea(parsed, unit));

  return {
    unit,
    shown,
    placeholder: measureAreaUnitLabel(unit),
    onChange: (text: string) => {
      draftRef.current = text;
      setDraft(text);
      const committed = commitMeasureAreaInput(text, unit);
      if (committed != null) onSqft(committed);
    },
    onBlur: () => {
      draftRef.current = null;
      setDraft(null);
    },
  };
}

export function AreaAmountField({
  sqft,
  onSqft,
  label,
  placeholder,
  className,
  disabled,
}: {
  /** Stored square feet. */
  sqft: string;
  onSqft: (sqft: string) => void;
  /** Words in front of the unit. A label that already names sq ft or sq yd is shown as-is. */
  label?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const draft = useAreaAmountDraft(sqft, onSqft);
  const unitWord = measureAreaUnitLabel(draft.unit);
  const caption = !label
    ? undefined
    : /sq (ft|yd)/.test(label)
      ? label
      : `${label} (${unitWord})`;
  return (
    <div>
      {caption ? <label className="mb-1 block text-xs text-muted-foreground">{caption}</label> : null}
      <Input
        value={draft.shown}
        onChange={(e) => draft.onChange(e.target.value)}
        onBlur={draft.onBlur}
        inputMode="decimal"
        placeholder={placeholder ?? draft.placeholder}
        disabled={disabled}
        aria-label={caption ?? `Area in ${unitWord}`}
        className={className}
      />
    </div>
  );
}

/** Builder number field. Same storage rule as AreaAmountField, matching the line-row input. */
export function MeasureAreaNumber({
  sqft,
  onSqft,
  label,
  caption,
  width = "w-28",
}: {
  sqft: string;
  onSqft: (sqft: string) => void;
  /** Words in front of the unit, e.g. "Measured". Ignored when `caption` is set. */
  label?: string;
  /** Full label, already naming the unit. */
  caption?: string;
  width?: string;
}) {
  const draft = useAreaAmountDraft(sqft, onSqft);
  const captionText = caption ?? `${label ?? "Area"} (${measureAreaUnitLabel(draft.unit)})`;
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{captionText}</label>
      <input
        value={draft.shown}
        onChange={(e) => draft.onChange(e.target.value)}
        onBlur={draft.onBlur}
        inputMode="decimal"
        placeholder={draft.placeholder}
        aria-label={captionText}
        className={cn(
          "h-11 rounded-md border border-input bg-transparent px-2 text-base shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:text-sm",
          width,
        )}
      />
    </div>
  );
}

const ftPart = (totalIn: number | null) => (totalIn ? String(Math.floor(totalIn / 12)) : "");
const inPart = (totalIn: number | null) => (totalIn ? String(Math.round(totalIn % 12)) : "");

/** Customer area row: width, then length, then a total in the working unit. */
export function CustomerAreaMeasureFields({
  lengthIn,
  widthIn,
  sqft,
}: {
  lengthIn: number | null;
  widthIn: number | null;
  sqft: number | null;
}) {
  const [stored, setStored] = useState(sqft != null && sqft > 0 ? String(sqft) : "");
  const cell = "h-9 w-14 rounded-md border border-input bg-transparent px-1.5 text-sm";
  return (
    <>
      <div className="flex items-center gap-1">
        <span className="text-[10px] font-medium text-muted-foreground">W</span>
        <input
          name="wid_ft"
          defaultValue={ftPart(widthIn)}
          placeholder="ft"
          aria-label="Width feet"
          inputMode="decimal"
          className={cell}
        />
        <input
          name="wid_in"
          defaultValue={inPart(widthIn)}
          placeholder="in"
          aria-label="Width inches"
          inputMode="decimal"
          className={cell}
        />
        <span className="text-xs text-muted-foreground">×</span>
        <span className="text-[10px] font-medium text-muted-foreground">L</span>
        <input
          name="len_ft"
          defaultValue={ftPart(lengthIn)}
          placeholder="ft"
          aria-label="Length feet"
          inputMode="decimal"
          className={cell}
        />
        <input
          name="len_in"
          defaultValue={inPart(lengthIn)}
          placeholder="in"
          aria-label="Length inches"
          inputMode="decimal"
          className={cell}
        />
      </div>
      <AreaAmountField sqft={stored} onSqft={setStored} label="or total" className="h-9 w-24" />
      <input type="hidden" name="sqft" value={stored} />
    </>
  );
}
