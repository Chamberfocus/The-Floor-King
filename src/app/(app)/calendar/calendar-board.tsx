"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Clock,
  X,
  CalendarDays,
  Check,
  Ban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SearchPicker } from "@/components/ui/search-picker";
import { SegmentedField } from "@/components/ui/segmented-field";
import { cn } from "@/lib/utils";
import { parseHm, hmFromMinutes } from "@/lib/booking";
import {
  APPOINTMENT_COLOR_CLASSES,
  type AppointmentType,
} from "@/lib/types";
import type { CalendarAppointment, BookingStaff } from "@/lib/data/booking";
import { CustomerSearch } from "./customer-search";
import { OnTheWayButton } from "@/app/(app)/customers/[id]/on-the-way-button";
import {
  createAppointment,
  rescheduleAppointment,
  setAppointmentStatus,
  confirmRequest,
  deleteAppointment,
} from "./actions";

const ROW_H = 44; // px per interval row

type Settings = {
  dayStart: string;
  dayEnd: string;
  interval: number;
  capacity: number;
  openDays: string;
};

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function minutesOf(iso: string): number {
  const d = new Date(iso);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
function dayOf(iso: string): string {
  return iso.slice(0, 10);
}
function prettyDay(ymd: string): { wd: string; md: string } {
  const d = new Date(`${ymd}T12:00:00Z`);
  return {
    wd: WD[d.getUTCDay()],
    md: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`,
  };
}
function to12(hm: string): string {
  const m = parseHm(hm);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const ap = h >= 12 ? "p" : "a";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return mm === 0 ? `${h12}${ap}` : `${h12}:${String(mm).padStart(2, "0")}${ap}`;
}

export function CalendarBoard({
  view,
  anchor,
  today,
  days,
  repFilter,
  appointments,
  types,
  staff,
  pending,
  settings,
}: {
  view: "week" | "day" | "month";
  anchor: string;
  today: string;
  days: string[];
  repFilter: string;
  appointments: CalendarAppointment[];
  types: AppointmentType[];
  staff: BookingStaff[];
  pending: CalendarAppointment[];
  settings: Settings;
}) {
  const router = useRouter();
  const [newSlot, setNewSlot] = useState<{ date: string; time: string } | null>(
    null,
  );
  const [detail, setDetail] = useState<CalendarAppointment | null>(null);

  const startMin = parseHm(settings.dayStart);
  const endMin = parseHm(settings.dayEnd);
  const interval = Math.max(15, settings.interval);
  const rows = Math.max(1, Math.ceil((endMin - startMin) / interval));
  const openDays = settings.openDays
    .split(",")
    .map((s) => parseInt(s.trim(), 10));

  const visible = useMemo(
    () =>
      appointments.filter(
        (a) => !repFilter || a.salespersonId === repFilter,
      ),
    [appointments, repFilter],
  );

  const go = (params: Record<string, string>) => {
    const q = new URLSearchParams({ view, date: anchor, ...params });
    if (repFilter && !("rep" in params)) q.set("rep", repFilter);
    router.push(`/calendar?${q.toString()}`);
  };
  const shift = (n: number) => {
    const d = new Date(`${anchor}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    go({ date: d.toISOString().slice(0, 10) });
  };
  const shiftMonth = (n: number) => {
    const d = new Date(`${anchor}T12:00:00Z`);
    // Land on the 1st of the target month so day overflow can't skip a month.
    const nd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1, 12));
    go({ date: nd.toISOString().slice(0, 10) });
  };
  const monthLabel = new Date(`${anchor}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const anchorMonth = Number(anchor.slice(5, 7)); // 1–12, for dimming other-month days

  const rowTimes = Array.from({ length: rows }, (_, i) =>
    hmFromMinutes(startMin + i * interval),
  );

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() =>
              view === "month" ? shiftMonth(-1) : shift(view === "day" ? -1 : -7)
            }
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => go({ date: today })}>
            Today
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() =>
              view === "month" ? shiftMonth(1) : shift(view === "day" ? 1 : 7)
            }
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <span className="text-sm font-medium">
          {view === "day"
            ? `${prettyDay(anchor).wd} ${prettyDay(anchor).md}`
            : view === "month"
              ? monthLabel
              : `${prettyDay(days[0]).md} – ${prettyDay(days[6]).md}`}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SegmentedField
            size="sm"
            value={view}
            onChange={(v) => go({ view: v })}
            options={[
              { value: "month", label: "Month" },
              { value: "week", label: "Week" },
              { value: "day", label: "Day" },
            ]}
          />
          <div className="w-44">
            <SearchPicker
              value={repFilter}
              onChange={(v) => go({ rep: v })}
              allowClear
              placeholder="All staff"
              options={[
                { value: "", label: "All staff" },
                ...staff.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          </div>
          <Button
            onClick={() =>
              setNewSlot({ date: view === "day" ? anchor : today, time: settings.dayStart })
            }
          >
            <Plus className="size-4" /> New appointment
          </Button>
        </div>
      </div>

      {/* Pending requests banner */}
      {pending.length > 0 ? (
        <div className="rounded-lg border border-amber-400/50 bg-amber-50 p-3">
          <p className="mb-2 text-sm font-medium text-amber-800">
            {pending.length} appointment request
            {pending.length === 1 ? "" : "s"} awaiting your confirmation
          </p>
          <div className="flex flex-wrap gap-2">
            {pending.map((p) => (
              <button
                key={p.id}
                onClick={() => setDetail(p)}
                className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-left text-sm hover:bg-amber-100"
              >
                <span className="font-medium">
                  {p.customerName ?? p.contactName ?? "New client"}
                </span>{" "}
                <span className="text-muted-foreground">
                  · {p.typeName} · {dayOf(p.startsAt)} {to12(hmFromMinutes(minutesOf(p.startsAt)))}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Grid */}
      {view === "month" ? (
        <MonthGrid
          days={days}
          visible={visible}
          today={today}
          anchorMonth={anchorMonth}
          onNew={(d) => setNewSlot({ date: d, time: settings.dayStart })}
          onAppt={(a) => setDetail(a)}
          onDay={(d) => go({ view: "day", date: d })}
        />
      ) : (
      <div className="overflow-x-auto rounded-lg border">
        {/* Day view fits a phone (1 column); only the 7-day Week view needs width. */}
        <div className={cn("flex", view === "week" && "min-w-[640px]")}>
          {/* Time gutter */}
          <div className="w-14 shrink-0 border-r bg-muted/30">
            <div className="h-10 border-b" />
            {rowTimes.map((t) => (
              <div
                key={t}
                style={{ height: ROW_H }}
                className="relative border-b text-xs text-muted-foreground"
              >
                <span className="absolute -top-1.5 right-1">{to12(t)}</span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((d) => {
            const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
            const closed = !openDays.includes(dow);
            const dayAppts = visible.filter((a) => dayOf(a.startsAt) === d);
            const p = prettyDay(d);
            return (
              <div key={d} className="flex-1 border-r last:border-r-0">
                <div
                  className={cn(
                    "flex h-10 flex-col items-center justify-center border-b text-xs",
                    d === today && "bg-primary/5 font-semibold",
                  )}
                >
                  <span>{p.wd}</span>
                  <span className="text-muted-foreground">{p.md}</span>
                </div>
                <div
                  className={cn("relative", closed && "bg-muted/20")}
                  style={{ height: rows * ROW_H }}
                >
                  {/* clickable interval rows */}
                  {rowTimes.map((t, i) => (
                    <button
                      key={t}
                      onClick={() => setNewSlot({ date: d, time: t })}
                      style={{ top: i * ROW_H, height: ROW_H }}
                      className="absolute inset-x-0 border-b hover:bg-primary/5"
                      aria-label={`New at ${t}`}
                    />
                  ))}
                  {/* appointment blocks */}
                  {dayAppts.map((a) => {
                    const s = minutesOf(a.startsAt);
                    const e = a.endsAt ? minutesOf(a.endsAt) : s + interval;
                    const top = ((s - startMin) / interval) * ROW_H;
                    const h = Math.max(
                      22,
                      ((e - s) / interval) * ROW_H - 2,
                    );
                    const c = APPOINTMENT_COLOR_CLASSES[a.color];
                    const pendingStyle = a.status === "pending";
                    return (
                      <button
                        key={a.id}
                        onClick={() => setDetail(a)}
                        style={{ top: Math.max(0, top), height: h }}
                        className={cn(
                          "absolute inset-x-1 overflow-hidden rounded-md border px-1.5 py-1 text-left text-xs leading-tight shadow-sm",
                          c.block,
                          pendingStyle && "border-dashed opacity-90 ring-1 ring-amber-400",
                          a.isBlock && "bg-gray-100 text-gray-600",
                        )}
                      >
                        <div className="font-semibold">
                          {to12(hmFromMinutes(s))}{" "}
                          {a.isBlock
                            ? a.title ?? "Blocked"
                            : a.customerName ?? a.contactName ?? a.typeName}
                        </div>
                        {!a.isBlock ? (
                          <div className="truncate opacity-80">
                            {a.typeName}
                            {a.salespersonName ? ` · ${a.salespersonName}` : ""}
                          </div>
                        ) : null}
                        {pendingStyle ? (
                          <div className="font-medium text-amber-700">Pending</div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}

      {newSlot ? (
        <NewApptDialog
          slot={newSlot}
          types={types}
          staff={staff}
          onClose={() => setNewSlot(null)}
        />
      ) : null}
      {detail ? (
        <DetailDialog
          appt={detail}
          staff={staff}
          onClose={() => setDetail(null)}
        />
      ) : null}
    </div>
  );
}

// ---- Month grid ----
function MonthGrid({
  days,
  visible,
  today,
  anchorMonth,
  onNew,
  onAppt,
  onDay,
}: {
  days: string[];
  visible: CalendarAppointment[];
  today: string;
  anchorMonth: number;
  onNew: (day: string) => void;
  onAppt: (a: CalendarAppointment) => void;
  onDay: (day: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="grid grid-cols-7 border-b bg-muted/30 text-center text-xs font-medium text-muted-foreground">
        {WD.map((w) => (
          <div key={w} className="px-2 py-1.5">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const inMonth = Number(d.slice(5, 7)) === anchorMonth;
          const isToday = d === today;
          const dayAppts = visible
            .filter((a) => dayOf(a.startsAt) === d)
            .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
          const shown = dayAppts.slice(0, 3);
          const extra = dayAppts.length - shown.length;
          return (
            <div
              key={d}
              onClick={() => onNew(d)}
              className={cn(
                "min-h-[104px] cursor-pointer border-b border-r p-1 transition-colors hover:bg-primary/5",
                !inMonth && "bg-muted/20 text-muted-foreground",
              )}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDay(d);
                }}
                className={cn(
                  "mb-1 flex size-6 items-center justify-center rounded-full text-xs hover:bg-muted",
                  isToday &&
                    "bg-primary font-semibold text-primary-foreground hover:bg-primary",
                )}
              >
                {Number(d.slice(8, 10))}
              </button>
              <div className="space-y-0.5">
                {shown.map((a) => {
                  const c = APPOINTMENT_COLOR_CLASSES[a.color];
                  const s = minutesOf(a.startsAt);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAppt(a);
                      }}
                      className={cn(
                        "block w-full truncate rounded px-1 py-0.5 text-left text-xs leading-tight",
                        c.block,
                        a.status === "pending" &&
                          "border border-dashed opacity-90",
                        a.isBlock && "bg-gray-100 text-gray-600",
                      )}
                    >
                      <span className="font-semibold">
                        {to12(hmFromMinutes(s))}
                      </span>{" "}
                      {a.isBlock
                        ? a.title ?? "Blocked"
                        : a.customerName ?? a.contactName ?? a.typeName}
                    </button>
                  );
                })}
                {extra > 0 ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDay(d);
                    }}
                    className="block w-full px-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    +{extra} more
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- New appointment dialog ----
function NewApptDialog({
  slot,
  types,
  staff,
  onClose,
}: {
  slot: { date: string; time: string };
  types: AppointmentType[];
  staff: BookingStaff[];
  onClose: () => void;
}) {
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [customerId, setCustomerId] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [address, setAddress] = useState("");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New appointment</DialogTitle>
        </DialogHeader>
        <form action={createAppointment} className="space-y-4">
          <input type="hidden" name="customer_id" value={customerId} />
          <input type="hidden" name="contact_name" value={contactName} />
          <input type="hidden" name="contact_phone" value={contactPhone} />
          <input type="hidden" name="contact_email" value={contactEmail} />
          <input type="hidden" name="address" value={address} />

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Type</label>
            <SegmentedField
              name="type_id"
              value={typeId}
              onChange={setTypeId}
              options={types.map((t) => ({
                value: t.id,
                label: `${t.name} · ${t.duration_min}m`,
              }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Date</label>
              <Input type="date" name="date" defaultValue={slot.date} required />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Time</label>
              <Input type="time" name="time" defaultValue={slot.time} required />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Assign to (optional — leave blank for first available)
            </label>
            <SearchPicker
              name="salesperson_id"
              allowClear
              placeholder="Anyone available"
              options={[
                { value: "", label: "Anyone available" },
                ...staff.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Customer</label>
            <CustomerSearch
              onPick={(c) => {
                setCustomerId(c?.id ?? "");
                if (c) {
                  setContactName(c.name);
                  setContactPhone(c.phone ?? "");
                  setContactEmail(c.email ?? "");
                  setAddress(c.address ?? "");
                }
              }}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Or enter a new walk-in below — no customer record needed.
            </p>
          </div>

          {!customerId ? (
            <div className="grid grid-cols-2 gap-3">
              <Input
                placeholder="Name"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
              />
              <Input
                placeholder="Phone"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
              />
            </div>
          ) : null}

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Notes</label>
            <Input name="notes" placeholder="optional" />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" onClick={onClose}>
              Book it
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---- Appointment detail dialog ----
function DetailDialog({
  appt,
  staff,
  onClose,
}: {
  appt: CalendarAppointment;
  staff: BookingStaff[];
  onClose: () => void;
}) {
  const s = minutesOf(appt.startsAt);
  const when = `${dayOf(appt.startsAt)} at ${to12(hmFromMinutes(s))}`;
  const isPending = appt.status === "pending";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {appt.isBlock ? appt.title ?? "Blocked time" : appt.typeName}
            {isPending ? (
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600">
                Pending request
              </span>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-1 text-sm">
          <p className="flex items-center gap-2">
            <Clock className="size-4 text-muted-foreground" /> {when}
          </p>
          {!appt.isBlock ? (
            <>
              <p>
                <span className="text-muted-foreground">Client: </span>
                {appt.customerId ? (
                  <Link
                    href={`/customers/${appt.customerId}`}
                    className="font-medium hover:underline"
                  >
                    {appt.customerName ?? appt.contactName ?? "Customer"}
                  </Link>
                ) : (
                  <span className="font-medium">
                    {appt.contactName ?? "Walk-in"}
                  </span>
                )}
              </p>
              {appt.contactPhone ? (
                <p className="text-muted-foreground">{appt.contactPhone}</p>
              ) : null}
              <p className="text-muted-foreground">
                {appt.salespersonName
                  ? `With ${appt.salespersonName}`
                  : "Unassigned (first available)"}
              </p>
            </>
          ) : null}
          {appt.notes ? (
            <p className="rounded-md bg-muted/50 p-2 text-muted-foreground">
              {appt.notes}
            </p>
          ) : null}
        </div>

        {/* Tell this customer you're on the way (texts + emails them + ETA). */}
        {!appt.isBlock && appt.customerId ? (
          <div className="border-t pt-3">
            <OnTheWayButton customerId={appt.customerId} />
          </div>
        ) : null}

        {/* Confirm (pending) or Reschedule */}
        <form
          action={isPending ? confirmRequest : rescheduleAppointment}
          className="space-y-3 border-t pt-3"
        >
          <input type="hidden" name="id" value={appt.id} />
          <p className="text-xs font-medium text-muted-foreground">
            {isPending ? "Confirm — set time & assign" : "Reschedule"}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Input
              type="date"
              name="date"
              defaultValue={dayOf(appt.startsAt)}
              required={!isPending}
            />
            <Input
              type="time"
              name="time"
              defaultValue={hmFromMinutes(s)}
              required={!isPending}
            />
          </div>
          <SearchPicker
            name="salesperson_id"
            allowClear
            placeholder="Assign to…"
            defaultValue={appt.salespersonId ?? ""}
            options={[
              { value: "", label: "Anyone available" },
              ...staff.map((st) => ({ value: st.id, label: st.name })),
            ]}
          />
          <Button type="submit" onClick={onClose} className="w-full">
            <Check className="size-4" />
            {isPending ? "Confirm appointment" : "Save new time"}
          </Button>
        </form>

        {/* Status actions */}
        <div className="flex flex-wrap gap-2 border-t pt-3">
          {!isPending ? (
            <>
              <StatusButton id={appt.id} status="completed" label="Completed" onDone={onClose} />
              <StatusButton id={appt.id} status="no_show" label="No-show" onDone={onClose} />
            </>
          ) : null}
          <StatusButton
            id={appt.id}
            status="cancelled"
            label="Cancel"
            destructive
            onDone={onClose}
          />
          <form action={deleteAppointment} className="ml-auto">
            <input type="hidden" name="id" value={appt.id} />
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={onClose}
            >
              <X className="size-4" /> Delete
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatusButton({
  id,
  status,
  label,
  destructive,
  onDone,
}: {
  id: string;
  status: string;
  label: string;
  destructive?: boolean;
  onDone: () => void;
}) {
  return (
    <form action={setAppointmentStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <Button
        type="submit"
        variant="outline"
        size="sm"
        onClick={onDone}
        className={cn(destructive && "text-destructive")}
      >
        {status === "cancelled" ? <Ban className="size-4" /> : <CalendarDays className="size-4" />}
        {label}
      </Button>
    </form>
  );
}
