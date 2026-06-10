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
import {
  getSchedulingSettings,
  listInstallerSettings,
} from "@/lib/data/scheduling";
import { saveSchedulingSettings, saveInstallerSettings } from "./actions";

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
  const installers = await listInstallerSettings();

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
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="default_origin">
                Default starting address (shop)
              </Label>
              <Input
                id="default_origin"
                name="default_origin"
                defaultValue={s.default_origin ?? ""}
                placeholder="3580 West 140th Street, Cleveland, OH 44111"
              />
              <p className="text-xs text-muted-foreground">
                Where routing starts when a rep has no home base of their own.
              </p>
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

      {installers.length ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Per-installer capacity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-xs text-muted-foreground">
              Override any number for a specific installer. Leave a box blank to
              use the shop default shown as the placeholder. These drive how the
              job scheduler sizes each crew&apos;s days.
            </p>
            {installers.map((inst) => {
              const ov = inst.settings;
              const ovDays = ov?.work_days
                ? new Set(ov.work_days.split(","))
                : active;
              const fields: { name: string; label: string; def: number }[] = [
                { name: "cap_carpet_yd", label: "Carpet yd", def: s.cap_carpet_yd },
                { name: "cap_lvt_sf", label: "LVT ft", def: s.cap_lvt_sf },
                { name: "cap_laminate_sf", label: "Laminate ft", def: s.cap_laminate_sf },
                { name: "cap_hardwood_sf", label: "Hardwood ft", def: s.cap_hardwood_sf },
                { name: "cap_tile_teardown_sf", label: "Tear-out ft", def: s.cap_tile_teardown_sf },
                { name: "cap_subfloor_sheets", label: "Subfloor sheets", def: s.cap_subfloor_sheets },
                { name: "cap_selflevel_sf", label: "Self-level ft", def: s.cap_selflevel_sf },
              ];
              const ovVal = (ov ?? {}) as unknown as Record<
                string,
                number | null | undefined
              >;
              return (
                <form
                  key={inst.id}
                  action={saveInstallerSettings}
                  className="space-y-2 rounded-md border p-3"
                >
                  <input type="hidden" name="installer_id" value={inst.id} />
                  <div className="text-sm font-medium">{inst.name}</div>
                  <div className="flex flex-wrap gap-2">
                    {DAYS.map((d) => (
                      <label key={d.v} className="flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          name="work_days"
                          value={d.v}
                          defaultChecked={ovDays.has(d.v)}
                          className="size-3.5 rounded border-input"
                        />
                        {d.label}
                      </label>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {fields.map((f) => (
                      <div key={f.name}>
                        <label className="mb-0.5 block text-[11px] text-muted-foreground">
                          {f.label}
                        </label>
                        <Input
                          name={f.name}
                          type="number"
                          step="0.01"
                          defaultValue={
                            ovVal[f.name] != null ? String(ovVal[f.name]) : ""
                          }
                          placeholder={String(f.def)}
                          className="h-8"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" variant="outline" size="sm">
                      Save {inst.name.split(" ")[0]}
                    </Button>
                  </div>
                </form>
              );
            })}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
