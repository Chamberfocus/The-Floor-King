"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedField } from "@/components/ui/segmented-field";
import { cn } from "@/lib/utils";
import {
  APPOINTMENT_COLORS,
  APPOINTMENT_COLOR_CLASSES,
  type AppointmentType,
  type AppointmentColor,
} from "@/lib/types";
import { createApptType, updateApptType, deleteApptType } from "./actions";

function ColorPicker({
  name,
  value,
  onChange,
}: {
  name: string;
  value: AppointmentColor;
  onChange: (c: AppointmentColor) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <input type="hidden" name={name} value={value} />
      {APPOINTMENT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={c}
          className={cn(
            "size-6 rounded-full ring-offset-2",
            APPOINTMENT_COLOR_CLASSES[c].dot,
            value === c && "ring-2 ring-foreground",
          )}
        />
      ))}
    </div>
  );
}

function TypeRow({ t }: { t: AppointmentType }) {
  const [color, setColor] = useState<AppointmentColor>(t.color);
  return (
    <form
      action={updateApptType}
      className="flex flex-wrap items-end gap-3 rounded-lg border p-3"
    >
      <input type="hidden" name="id" value={t.id} />
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Name</label>
        <Input name="name" defaultValue={t.name} className="w-44" />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Minutes</label>
        <Input
          name="duration_min"
          inputMode="numeric"
          defaultValue={String(t.duration_min)}
          className="w-20"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Color</label>
        <ColorPicker name="color" value={color} onChange={setColor} />
      </div>
      <label className="flex items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          name="requires_rep"
          defaultChecked={t.requires_rep}
          className="size-4"
        />
        Needs a rep
      </label>
      <label className="flex items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          name="active"
          defaultChecked={t.active}
          className="size-4"
        />
        Active
      </label>
      <div className="ml-auto flex items-center gap-2">
        <Button type="submit" size="sm" variant="outline">
          Save
        </Button>
      </div>
      <DeleteButton id={t.id} />
    </form>
  );
}

function DeleteButton({ id }: { id: string }) {
  return (
    <form action={deleteApptType}>
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="ghost" className="text-destructive">
        <Trash2 className="size-4" />
      </Button>
    </form>
  );
}

export function AppointmentTypesManager({
  types,
}: {
  types: AppointmentType[];
}) {
  const [newColor, setNewColor] = useState<AppointmentColor>("violet");
  return (
    <div className="space-y-3">
      {types.map((t) => (
        <TypeRow key={t.id} t={t} />
      ))}

      <form
        action={createApptType}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed p-3"
      >
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">New type</label>
          <Input name="name" placeholder="e.g. Design consult" className="w-44" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Minutes</label>
          <Input
            name="duration_min"
            inputMode="numeric"
            defaultValue="45"
            className="w-20"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Color</label>
          <ColorPicker name="color" value={newColor} onChange={setNewColor} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Kind</label>
          <SegmentedField
            name="kind"
            size="sm"
            defaultValue="showroom"
            options={[
              { value: "showroom", label: "Showroom" },
              { value: "in_home", label: "In-home" },
              { value: "measure", label: "Measure" },
              { value: "pickup", label: "Pickup" },
              { value: "other", label: "Other" },
            ]}
          />
        </div>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" name="requires_rep" className="size-4" />
          Needs a rep
        </label>
        <Button type="submit" size="sm" className="ml-auto">
          <Plus className="size-4" /> Add type
        </Button>
      </form>
    </div>
  );
}
