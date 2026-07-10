"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";

/** Format up to 10 US digits as ###-###-#### as you type. Non-digits (incl.
 *  pasted formatting) are stripped first, so paste and backspace stay clean.
 *  Extra digits beyond 10 are dropped rather than mangling the format. */
export function formatPhone(raw: string): string {
  let digits = (raw || "").replace(/\D/g, "");
  // Drop a leading US country code so a pasted 1-216-555-1234 formats cleanly.
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  const d = digits.slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

type Props = Omit<React.ComponentProps<typeof Input>, "type" | "onChange"> & {
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
};

/**
 * The phone field used everywhere — hyphens appear automatically while typing
 * (216-555-1234). Works as a drop-in for `<Input>`: pass `name` + `defaultValue`
 * (native forms) or `value` + `onChange` (controlled). Callers receive the
 * formatted value, so it stores/displays consistently.
 */
export function PhoneInput({ value, defaultValue, onChange, ...props }: Props) {
  const isControlled = value !== undefined;
  const [inner, setInner] = React.useState(() => formatPhone(String(defaultValue ?? "")));
  const display = isControlled ? formatPhone(String(value ?? "")) : inner;

  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhone(e.target.value);
    if (!isControlled) setInner(formatted);
    // Hand the formatted value back so controlled callers store the pretty form.
    e.target.value = formatted;
    onChange?.(e);
  };

  return (
    <Input
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      value={display}
      onChange={handle}
      {...props}
    />
  );
}
