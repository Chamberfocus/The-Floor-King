import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { getSchedulingSettings } from "@/lib/data/scheduling";
import { saveSchedulingSettings } from "./actions";

export const metadata: Metadata = { title: "Scheduling" };

const DAYS = [
  { v: "0", label: "Sun" },
  { v: "1", label: "Mon" },
  { v: "2", label: "Tue" },
  { v: "3", label: "Wed" },
  { v: "4", label: "Thu" },
  { v: "5", label: "Fri" },
  { v: "6", label: "Sat" },
];

export default async function SchedulingSettingsPage() {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/");
  const s = await getSchedulingSettings();
  const active = new Set(s.work_days.split(","));

  const caps: { name: string; label: string; value: number; unit: string }[] = [
    { name: "cap_carpet_yd", label: "Carpet (incl. takeup + furniture)", value: s.cap_carpet_yd, unit: "sq yd / day" },
    { name: "cap_lvt_sf", label: "Luxury vinyl (LVT/LVP)", value: s.cap_lvt_sf, unit: "sq ft / day" },
    { name: "cap_laminate_sf", label: "Laminate", value: s.cap_laminate_sf, unit: "sq ft / day" },
    { name: "cap_hardwood_sf", label: "Hardwood", value: s.cap_hardwood_sf, unit: "sq ft / day" },
    { name: "cap_tile_teardown_sf", label: "Ceramic tear-out", value: s.cap_tile_teardown_sf, unit: "sq ft / day" },
    { name: "cap_subfloor_sheets", label: "Subfloor", value: s.cap_subfloor_sheets, unit: "sheets / day" },
    { name: "cap_selflevel_sf", label: "Self-leveling", value: s.cap_selflevel_sf, unit: "sq ft / day" },
  ];

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Scheduling"
        description="The parameters the smart scheduler uses to book estimates and installs."
      />
      <form action={saveSchedulingSettings} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Working hours</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Work days</Label>
              <div className="flex flex-wrap gap-3">
                {DAYS.map((d) => (
                  <label key={d.v} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      name="work_days"
                      value={d.v}
                      defaultChecked={active.has(d.v)}
                      className="size-4 rounded border-input"
                    />
                    {d.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="day_start">Day start</Label>
                <Input id="day_start" name="day_start" type="time" defaultValue={s.day_start} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="day_end">Day end</Label>
                <Input id="day_end" name="day_end" type="time" defaultValue={s.day_end} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Estimate appointments</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="estimate_duration_min">Appointment length (min)</Label>
              <Input
                id="estimate_duration_min"
                name="estimate_duration_min"
                type="number"
                defaultValue={s.estimate_duration_min}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="travel_buffer_min">Travel buffer (min)</Label>
              <Input
                id="travel_buffer_min"
                name="travel_buffer_min"
                type="number"
                defaultValue={s.travel_buffer_min}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Installer daily capacity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {caps.map((c) => (
              <div key={c.name} className="flex items-center gap-3">
                <Label htmlFor={c.name} className="flex-1">
                  {c.label}
                </Label>
                <Input
                  id={c.name}
                  name={c.name}
                  type="number"
                  step="0.01"
                  defaultValue={c.value}
                  className="w-28"
                />
                <span className="w-24 text-xs text-muted-foreground">{c.unit}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit">Save settings</Button>
        </div>
      </form>
    </div>
  );
}
