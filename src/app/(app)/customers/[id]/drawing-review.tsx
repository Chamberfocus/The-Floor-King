"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MeasureAreaReadout } from "@/components/measure-area-unit";
import { pdfToText, spreadsheetToText } from "@/lib/pdf-client";
import {
  parseDrawing,
  reviewDrawing,
  type DrawingFloor,
  type DrawingRoom,
} from "@/lib/drawing-takeoff";
import { readDrawingImage, saveDrawingRooms } from "./drawing-actions";

const FLOORS: { value: DrawingFloor; label: string }[] = [
  { value: "", label: "Flooring not written" },
  { value: "carpet", label: "Carpet" },
  { value: "lvp", label: "LVP" },
  { value: "hardwood", label: "Hardwood" },
  { value: "laminate", label: "Laminate" },
  { value: "tile", label: "Tile" },
  { value: "vinyl", label: "Vinyl" },
];

type DraftRoom = DrawingRoom & { key: string };

function draftRooms(rooms: DrawingRoom[]): DraftRoom[] {
  return rooms.map((room) => ({ ...room, key: crypto.randomUUID() }));
}

function blankRoom(): DraftRoom {
  return {
    key: crypto.randomUUID(),
    name: "",
    widthFt: 0,
    widthIn: 0,
    lengthFt: 0,
    lengthIn: 0,
    writtenSqft: null,
    floor: "",
    stairs: null,
    note: "",
  };
}

function dimValue(n: number): string {
  return n > 0 ? String(n) : "";
}

function dimNumber(raw: string): number {
  if (!raw.trim()) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function DrawingTakeoff({ customerId }: { customerId: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [rooms, setRooms] = useState<DraftRoom[] | null>(null);
  const [reading, startReading] = useTransition();
  const [saving, startSaving] = useTransition();

  const review = useMemo(() => (rooms ? reviewDrawing(rooms) : null), [rooms]);

  const applyRooms = (next: DrawingRoom[], source?: string) => {
    if (!next.length) {
      toast.error("No rooms in that drawing. Include each room with its width and length.");
      return;
    }
    if (source != null) setText(source);
    setRooms(draftRooms(next));
  };

  const readText = () => applyRooms(parseDrawing(text));

  const readFile = (picked: File | null) => {
    if (!picked) return;
    setFile(picked);
    startReading(async () => {
      const name = picked.name.toLowerCase();
      const image = picked.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(name);
      try {
        if (!image && (name.endsWith(".pdf") || picked.type === "application/pdf")) {
          try {
            const body = (await pdfToText(picked)).text;
            const parsed = parseDrawing(body);
            if (parsed.length) {
              applyRooms(parsed, body);
              return;
            }
          } catch {
            /* A scanned sheet has no text layer, so the photo reader takes it. */
          }
        } else if (!image && (name.endsWith(".csv") || name.endsWith(".xlsx") || name.endsWith(".xls"))) {
          const body = await spreadsheetToText(picked);
          applyRooms(parseDrawing(body), body);
          return;
        } else if (!image && (picked.type.startsWith("text/") || name.endsWith(".txt"))) {
          const body = await picked.text();
          applyRooms(parseDrawing(body), body);
          return;
        }
        const fd = new FormData();
        fd.set("file", picked);
        const res = await readDrawingImage(fd);
        if (res.error || !res.rooms?.length) {
          toast.error(res.error || "Couldn't read rooms on that drawing. Paste the writing instead.");
          return;
        }
        applyRooms(res.rooms);
      } catch {
        toast.error("Couldn't read that file. Paste the writing from the drawing.");
      }
    });
  };

  const updateRoom = (key: string, patch: Partial<DrawingRoom>) => {
    setRooms((current) => current?.map((room) => (room.key === key ? { ...room, ...patch } : room)) ?? current);
  };

  const save = () => {
    if (!rooms?.length) return;
    startSaving(async () => {
      const fd = new FormData();
      fd.set("customer_id", customerId);
      fd.set(
        "rooms",
        JSON.stringify(
          rooms.map((room) => ({
            name: room.name,
            widthFt: room.widthFt,
            widthIn: room.widthIn,
            lengthFt: room.lengthFt,
            lengthIn: room.lengthIn,
            writtenSqft: room.writtenSqft,
            floor: room.floor,
            stairs: room.stairs,
            note: room.note,
          })),
        ),
      );
      if (file) fd.set("file", file);
      const res = await saveDrawingRooms(fd);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(`Saved ${res.saved ?? rooms.length} rooms on this customer.`);
      if (res.fileError) toast.error(res.fileError);
      setRooms(null);
      setText("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    });
  };

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div>
        <p className="text-sm font-medium">Read the drawing</p>
        <p className="text-xs text-muted-foreground">
          Upload the sheet the salesperson drew, or paste the writing. Square footage is width times length.
          Check every room before it is saved. Carpet shows a 12 ft cut and a 15 ft cut.
        </p>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder={"Living room 12'6\" x 18'4\" carpet\nKitchen 12 x 14 LVP\nStairs 13"}
        className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={readText} disabled={reading || !text.trim()}>
          Read the writing
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={reading}
          onClick={() => fileRef.current?.click()}
        >
          <FileUp className="size-3.5" /> {reading ? "Reading…" : "Upload drawing"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.pdf,.txt,.csv,.xlsx,.xls,application/pdf"
          className="hidden"
          onChange={(e) => {
            const picked = e.target.files?.[0] ?? null;
            e.target.value = "";
            readFile(picked);
          }}
        />
        {file ? <span className="text-xs text-muted-foreground">{file.name}</span> : null}
      </div>

      {review && rooms ? (
        <div className="space-y-3">
          <div className="rounded-md bg-primary/10 px-3 py-2 text-sm">
            <p className="font-medium">
              {review.totalSqft > 0 ? <MeasureAreaReadout sqft={review.totalSqft} /> : "0 sq ft"} measured
              {review.carpetMeasuredSqft > 0 && review.carpetMeasuredSqft !== review.totalSqft ? (
                <>
                  {" "}
                  · carpet rooms <MeasureAreaReadout sqft={review.carpetMeasuredSqft} />
                </>
              ) : null}
            </p>
            {review.suggestedRoll && review.roll12Sqyd != null && review.roll15Sqyd != null ? (
              <p>
                One carpet width for the carpet rooms: {review.suggestedRoll} ft goods,{" "}
                {review.suggestedRoll === 12 ? review.roll12Sqyd : review.roll15Sqyd} sq yd. 12 ft is{" "}
                {review.roll12Sqyd} sq yd. 15 ft is {review.roll15Sqyd} sq yd.
              </p>
            ) : null}
          </div>

          {review.checks.length ? (
            <ul className="space-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
              {review.checks.map((check, index) => (
                <li key={`${index}-${check}`}>{check}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">The written sizes match width times length.</p>
          )}

          {rooms.map((room, index) => {
            const check = review.rooms[index];
            return (
              <div key={room.key} className="space-y-2 rounded-md border p-2">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[8rem] flex-1 space-y-1">
                    <Label>Room</Label>
                    <Input
                      value={room.name}
                      onChange={(e) => updateRoom(room.key, { name: e.target.value })}
                      placeholder="Room name"
                    />
                  </div>
                  <div className="min-w-[9rem] space-y-1">
                    <Label>Flooring</Label>
                    <select
                      value={room.floor}
                      onChange={(e) => updateRoom(room.key, { floor: e.target.value as DrawingFloor })}
                      className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
                    >
                      {FLOORS.map((floor) => (
                        <option key={floor.label} value={floor.value}>
                          {floor.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${room.name || "room"}`}
                    onClick={() => setRooms((current) => current?.filter((item) => item.key !== room.key) ?? current)}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <DimFields
                    label="Width"
                    feet={room.widthFt}
                    inches={room.widthIn}
                    onFeet={(value) => updateRoom(room.key, { widthFt: dimNumber(value) })}
                    onInches={(value) => updateRoom(room.key, { widthIn: dimNumber(value) })}
                  />
                  <DimFields
                    label="Length"
                    feet={room.lengthFt}
                    inches={room.lengthIn}
                    onFeet={(value) => updateRoom(room.key, { lengthFt: dimNumber(value) })}
                    onInches={(value) => updateRoom(room.key, { lengthIn: dimNumber(value) })}
                  />
                  <div className="space-y-1">
                    <Label>Stairs</Label>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      className="h-9 w-20"
                      value={room.stairs ?? ""}
                      onChange={(e) =>
                        updateRoom(room.key, {
                          stairs: e.target.value.trim() ? dimNumber(e.target.value) : null,
                        })
                      }
                    />
                  </div>
                  <p className="pb-2 text-sm font-medium">
                    {check && check.measuredSqft > 0 ? <MeasureAreaReadout sqft={check.measuredSqft} /> : "Add both sides"}
                  </p>
                </div>
                <Input
                  value={room.note}
                  onChange={(e) => updateRoom(room.key, { note: e.target.value })}
                  placeholder="Note from the drawing"
                />
                {check?.carpet12 && check.carpet15 ? (
                  <div className="space-y-1 text-sm">
                    <CarpetLine plan={check.carpet12} suggested={check.suggestedRoll === 12} />
                    <CarpetLine plan={check.carpet15} suggested={check.suggestedRoll === 15} />
                  </div>
                ) : null}
              </div>
            );
          })}

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setRooms((current) => [...(current ?? []), blankRoom()])}>
              <Plus className="size-3.5" /> Add a room
            </Button>
            <Button type="button" size="sm" onClick={save} disabled={saving || rooms.length === 0}>
              {saving ? "Saving…" : "Save checked rooms"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setRooms(null);
                setFile(null);
              }}
            >
              Clear
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DimFields({
  label,
  feet,
  inches,
  onFeet,
  onInches,
}: {
  label: string;
  feet: number;
  inches: number;
  onFeet: (value: string) => void;
  onInches: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          aria-label={`${label} feet`}
          className="h-9 w-16"
          value={dimValue(feet)}
          onChange={(e) => onFeet(e.target.value)}
        />
        <span className="text-xs text-muted-foreground">ft</span>
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          aria-label={`${label} inches`}
          className="h-9 w-16"
          value={dimValue(inches)}
          onChange={(e) => onInches(e.target.value)}
        />
        <span className="text-xs text-muted-foreground">in</span>
      </div>
    </div>
  );
}

function CarpetLine({
  plan,
  suggested,
}: {
  plan: { rollFt: 12 | 15; label: string; orderedSqyd: number; orderedSqft: number };
  suggested: boolean;
}) {
  return (
    <p className={suggested ? "rounded-md bg-primary/10 px-2 py-1" : "px-2 py-1 text-muted-foreground"}>
      {plan.rollFt} ft: {plan.label}. {plan.orderedSqyd} sq yd ({plan.orderedSqft} sq ft).
      {suggested ? " Less carpet for this room." : ""}
    </p>
  );
}
