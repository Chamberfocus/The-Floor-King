"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export interface SegOption {
  value: string;
  label: string;
}

/**
 * Tap-to-select control — replaces a dropdown for short, fixed choice sets.
 * Works in native forms (set `name`, it writes a hidden input) and as a
 * controlled input (pass `value` + `onChange`).
 */
export function SegmentedField({
  name,
  options,
  value,
  defaultValue,
  onChange,
  className,
  size = "md",
}: {
  name?: string;
  options: SegOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  const controlled = value !== undefined;
  const [internal, setInternal] = useState(
    defaultValue ?? options[0]?.value ?? "",
  );
  const current = controlled ? value! : internal;

  const pick = (v: string) => {
    if (!controlled) setInternal(v);
    onChange?.(v);
  };

  return (
    <div className={cn("inline-flex flex-wrap gap-1", className)}>
      {name ? <input type="hidden" name={name} value={current} /> : null}
      {options.map((o) => {
        const active = o.value === current;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => pick(o.value)}
            className={cn(
              "rounded-md border font-medium transition-colors",
              size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-transparent text-foreground hover:bg-muted",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
