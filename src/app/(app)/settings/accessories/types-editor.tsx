"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, X } from "lucide-react";
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
import { deleteAccessoryType, saveAccessoryType } from "./actions";

const AXIS_HINT: Record<string, string> = {
  color: "One item per coordinating floor color.",
  size: "One item per size — for primed millwork that doesn't come in floor colors.",
  none: "Exactly one item. No variants.",
};

/**
 * The type list. A type carries the UNIT and the AXIS (what it varies by); the
 * PRICE lives on the program, because the same type costs different money on
 * different vendor lines.
 */
export function TypesEditor({ types }: { types: AccessoryType[] }) {
  const [editing, setEditing] = useState<AccessoryType | "new" | null>(null);
  const [pending, start] = useTransition();

  const remove = (t: AccessoryType) =>
    start(async () => {
      const r = await deleteAccessoryType(t.id);
      if (r.error) toast.error(r.error);
      else toast.success(`Removed “${t.name}” and retired its generated items.`);
    });

  const active = types.filter((t) => t.active);

  return (
    <Card className="mb-6">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Accessory types</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            What each type varies by and how it&apos;s sold. Prices are set
            per-program below.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
          <Plus className="size-4" /> Add type
        </Button>
      </CardHeader>
      <CardContent>
        {editing && (
          <TypeForm
            type={editing === "new" ? null : editing}
            onDone={() => setEditing(null)}
          />
        )}

        {!active.length && !editing && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No types yet. Adopt your imported trim above, or add one by hand.
          </p>
        )}

        <div className="divide-y">
          {active.map((t) => (
            <div key={t.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t.name}</span>
                  <Badge variant="secondary">
                    {t.axis === "color"
                      ? "by color"
                      : t.axis === "size"
                        ? "by size"
                        : "single item"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    per {t.unit === "lnft" ? "linear ft" : "piece"}
                    {t.unit === "each" &&
                      ` · ${t.piece_length_in ?? DEFAULT_PIECE_LENGTH_IN}" sticks`}
                  </span>
                </div>
                {t.axis === "size" && (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Sizes: {t.sizes.length ? t.sizes.join(", ") : "none set yet"}
                  </div>
                )}
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setEditing(t)}
                aria-label={`Edit ${t.name}`}
              >
                <Pencil className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                disabled={pending}
                onClick={() => remove(t)}
                aria-label={`Remove ${t.name}`}
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TypeForm({
  type,
  onDone,
}: {
  type: AccessoryType | null;
  onDone: () => void;
}) {
  const [unit, setUnit] = useState(type?.unit ?? "each");
  const [axis, setAxis] = useState(type?.axis ?? "color");

  async function save(formData: FormData) {
    const r = await saveAccessoryType(formData);
    if (r.error) toast.error(r.error);
    else onDone();
  }

  return (
    <form action={save} className="mb-4 space-y-4 rounded-lg border bg-muted/30 p-4">
      {type && <input type="hidden" name="id" value={type.id} />}
      <input type="hidden" name="active" value="1" />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="acc-name">Name</Label>
          <Input
            id="acc-name"
            name="name"
            defaultValue={type?.name ?? ""}
            placeholder="T-Mold"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label>Sold by</Label>
          <SegmentedField
            name="unit"
            value={unit}
            onChange={(v) => setUnit(v as "each" | "lnft")}
            options={[
              { value: "each", label: "The piece" },
              { value: "lnft", label: "Linear foot" },
            ]}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Varies by</Label>
        <SegmentedField
          name="axis"
          value={axis}
          onChange={(v) => setAxis(v as "color" | "size" | "none")}
          options={[
            { value: "color", label: "Color" },
            { value: "size", label: "Size" },
            { value: "none", label: "Nothing" },
          ]}
        />
        <p className="text-xs text-muted-foreground">{AXIS_HINT[axis]}</p>
      </div>

      {axis === "size" && (
        <div className="space-y-1.5">
          <Label htmlFor="acc-sizes">Sizes</Label>
          <Input
            id="acc-sizes"
            name="sizes"
            defaultValue={type?.sizes.join(", ") ?? ""}
            placeholder={`3¼", 4¼", 5¼"`}
          />
          <p className="text-xs text-muted-foreground">
            Comma-separated. One catalog item is created per size.
          </p>
        </div>
      )}

      {unit === "each" && (
        <div className="space-y-1.5">
          <Label htmlFor="acc-piece">Stick length (inches)</Label>
          <Input
            id="acc-piece"
            name="piece_length_in"
            inputMode="decimal"
            className="w-28"
            defaultValue={type?.piece_length_in ?? DEFAULT_PIECE_LENGTH_IN}
          />
          <p className="text-xs text-muted-foreground">
            On an estimate you enter linear feet; this converts it to whole pieces
            to buy — always rounding up, since you can&apos;t order part of a stick.
          </p>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton pendingText="Saving…" confirm="Saved">
          {type ? "Save type" : "Add type"}
        </SubmitButton>
      </div>
    </form>
  );
}
