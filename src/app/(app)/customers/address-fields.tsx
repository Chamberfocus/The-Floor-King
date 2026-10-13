"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fillStreet, type AddressSuggestion } from "@/lib/address-suggest";
import { addressDetails, addressSuggestions } from "./property-actions";

/**
 * Street, city, state, and ZIP. Typing the street shows matches you can tap.
 * A unit already typed on the street line is kept. The inputs keep their
 * names so the form still submits when the address is entered by hand.
 */
export function AddressFields({
  defaults,
  idPrefix = "",
}: {
  defaults?: {
    street?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  };
  idPrefix?: string;
}) {
  const fieldId = (name: string) => (idPrefix ? `${idPrefix}-${name}` : name);
  const [street, setStreet] = useState(defaults?.street ?? "");
  const [city, setCity] = useState(defaults?.city ?? "");
  const [state, setState] = useState(defaults?.state ?? "OH");
  const [zip, setZip] = useState(defaults?.zip ?? "");
  const [sugs, setSugs] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const reqRef = useRef(0);
  const skipRef = useRef(false);
  const streetRef = useRef(street);
  const lastPick = useRef(0);
  streetRef.current = street;

  useEffect(() => {
    if (!touched) return;
    if (skipRef.current) {
      skipRef.current = false;
      return;
    }
    const q = street.trim();
    if (q.length < 3) {
      setSugs([]);
      setOpen(false);
      setError(null);
      setNotice(null);
      return;
    }
    const id = ++reqRef.current;
    const t = setTimeout(async () => {
      try {
        const res = await addressSuggestions(q);
        if (id !== reqRef.current) return;
        setSugs(res.suggestions);
        setOpen(res.suggestions.length > 0);
        setError(res.error);
        setNotice(res.notice);
      } catch {
        if (id !== reqRef.current) return;
        setSugs([]);
        setOpen(false);
        setError("Address suggestions could not be reached. You can still type the address.");
        setNotice(null);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [street, touched]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const pick = async (s: AddressSuggestion) => {
    const typed = streetRef.current;
    setOpen(false);
    skipRef.current = true;
    const nextStreet = fillStreet(s.street, null, typed);
    setStreet(nextStreet);
    if (s.city) setCity(s.city);
    if (s.state) setState(s.state);
    if (s.zip) setZip(s.zip);
    setNotice(s.hint);
    setError(null);
    try {
      const details = await addressDetails(s.placeId, typed);
      if (!details) {
        setError("That suggestion could not be confirmed. Review the street, city, state, and ZIP before saving.");
        return;
      }
      skipRef.current = true;
      setStreet(fillStreet(details.street, details.subpremise, typed));
      if (details.city) setCity(details.city);
      if (details.state) setState(details.state);
      if (details.zip) setZip(details.zip);
      setNotice(details.deliveryNote);
      setError(null);
    } catch {
      setError("That suggestion could not be confirmed. Review the street, city, state, and ZIP before saving.");
    }
  };

  const choose = (s: AddressSuggestion) => {
    const now = Date.now();
    if (now - lastPick.current < 500) return;
    lastPick.current = now;
    void pick(s);
  };

  return (
    <>
      <div ref={boxRef} className="space-y-2 sm:col-span-2">
        <Label htmlFor={fieldId("street")}>Job address</Label>
        <Input
          id={fieldId("street")}
          name="street"
          value={street}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Start typing the street address…"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? fieldId("street-suggestions") : undefined}
          onChange={(e) => {
            setTouched(true);
            setStreet(e.target.value);
          }}
          onFocus={() => {
            setTouched(true);
            if (sugs.length) setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && open && sugs[0]) {
              e.preventDefault();
              choose(sugs[0]);
            }
            if (e.key === "Escape") setOpen(false);
          }}
        />
        {open && sugs.length > 0 ? (
          <ul
            id={fieldId("street-suggestions")}
            role="listbox"
            aria-label="Address suggestions"
            className="overflow-hidden rounded-md border bg-popover shadow-lg"
          >
            {sugs.map((s) => (
              <li key={s.placeId} role="presentation">
                <button
                  type="button"
                  role="option"
                  onPointerDown={(e) => {
                    if (e.pointerType === "mouse" || e.pointerType === "touch" || e.pointerType === "pen") {
                      e.preventDefault();
                      choose(s);
                    }
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(s)}
                  className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{s.description}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : notice ? (
          <p className="text-sm text-muted-foreground" role="status">
            {notice}
          </p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor={fieldId("city")}>City</Label>
        <Input
          id={fieldId("city")}
          name="city"
          value={city}
          autoComplete="off"
          onChange={(e) => setCity(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor={fieldId("state")}>State</Label>
          <Input
            id={fieldId("state")}
            name="state"
            value={state}
            autoComplete="off"
            onChange={(e) => setState(e.target.value)}
            maxLength={2}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={fieldId("zip")}>ZIP</Label>
          <Input
            id={fieldId("zip")}
            name="zip"
            value={zip}
            autoComplete="off"
          onChange={(e) => setZip(e.target.value)}
          />
        </div>
      </div>
    </>
  );
}
