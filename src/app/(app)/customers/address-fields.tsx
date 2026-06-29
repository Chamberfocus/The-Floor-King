"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  addressSuggestions,
  addressDetails,
  type AddressSuggestion,
} from "./property-actions";

/**
 * Address fields with Google Places autocomplete on the street line — pick a
 * suggestion and city / state / ZIP fill in. Falls back to plain typing if no
 * Google key is configured. The inputs keep their `name`s so the form submits
 * normally.
 */
export function AddressFields({
  defaults,
}: {
  defaults?: {
    street?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  };
}) {
  const [street, setStreet] = useState(defaults?.street ?? "");
  const [city, setCity] = useState(defaults?.city ?? "");
  const [state, setState] = useState(defaults?.state ?? "OH");
  const [zip, setZip] = useState(defaults?.zip ?? "");
  const [sugs, setSugs] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [touched, setTouched] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const reqRef = useRef(0);
  const skipRef = useRef(false);

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
      return;
    }
    const id = ++reqRef.current;
    const t = setTimeout(async () => {
      const res = await addressSuggestions(q);
      if (id !== reqRef.current) return;
      setSugs(res);
      setOpen(res.length > 0);
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
    setOpen(false);
    skipRef.current = true;
    setStreet(s.description.split(",")[0]);
    const d = await addressDetails(s.placeId);
    if (d) {
      skipRef.current = true;
      setStreet(d.street || s.description.split(",")[0]);
      if (d.city) setCity(d.city);
      if (d.state) setState(d.state);
      if (d.zip) setZip(d.zip);
    }
  };

  return (
    <>
      <div ref={boxRef} className="relative space-y-2 sm:col-span-2">
        <Label htmlFor="street">Job address</Label>
        <Input
          id="street"
          name="street"
          value={street}
          autoComplete="off"
          placeholder="Start typing the address…"
          onChange={(e) => {
            setTouched(true);
            setStreet(e.target.value);
          }}
          onFocus={() => {
            setTouched(true);
            if (sugs.length) setOpen(true);
          }}
        />
        {open ? (
          <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-md border bg-popover shadow-lg">
            {sugs.map((s) => (
              <button
                key={s.placeId}
                type="button"
                onClick={() => pick(s)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{s.description}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="city">City</Label>
        <Input id="city" name="city" value={city} onChange={(e) => setCity(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="state">State</Label>
          <Input
            id="state"
            name="state"
            value={state}
            onChange={(e) => setState(e.target.value)}
            maxLength={2}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="zip">ZIP</Label>
          <Input id="zip" name="zip" value={zip} onChange={(e) => setZip(e.target.value)} />
        </div>
      </div>
    </>
  );
}
