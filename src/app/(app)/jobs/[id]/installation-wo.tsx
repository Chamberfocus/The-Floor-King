import { PrintLetterhead, PrintBillTo } from "@/components/print-letterhead";
import { lineTotal } from "@/lib/estimate-calc";
import { formatDate, formatMoney, to12 } from "@/lib/format";
import {
  JOB_STATUS_LABELS,
  JOB_DELIVERY_LABELS,
  type EstimateLineItem,
  type OrgSettings,
} from "@/lib/types";
import { buildJobScope, lineSpec, PAD_ROLL_SQYD, type ScopeRoom } from "@/lib/job-scope";
import type { JobDetail } from "@/lib/data/jobs";

/** One scope line, rendered the same in every section of the work order. */
function ScopeLine({ l, showPrices }: { l: EstimateLineItem; showPrices: boolean }) {
  const spec = lineSpec(l);
  return (
    <tr className="border-b align-top">
      <td className="py-1 pr-2">
        <span>{l.description || "Line item"}</span>
        {l.manufacturer || l.style || l.color || l.item_no ? (
          <span className="text-gray-500">
            {"  "}
            {[l.manufacturer, l.style, l.color, l.item_no ? `#${l.item_no}` : null]
              .filter(Boolean)
              .join(" · ")}
          </span>
        ) : null}
        {l.from_stock ? <span className="text-gray-500"> · from stock</span> : null}
        {spec.cut ? <span className="font-semibold text-gray-700">{"  "}✂ Cut {spec.cut}</span> : null}
        {spec.rolls ? (
          <span className="text-gray-600">
            {"  "}· {spec.rolls} roll{spec.rolls > 1 ? "s" : ""} @ {PAD_ROLL_SQYD} sq yd
          </span>
        ) : null}
      </td>
      <td className="whitespace-nowrap py-1 pl-2 text-right tabular-nums text-gray-600">{spec.qty}</td>
      {showPrices ? (
        <td className="whitespace-nowrap py-1 pl-2 text-right tabular-nums text-gray-600">
          {formatMoney(lineTotal(l))}
        </td>
      ) : null}
    </tr>
  );
}

function SectionTable({
  label,
  lines,
  showPrices,
}: {
  label: string;
  lines: EstimateLineItem[];
  showPrices: boolean;
}) {
  if (!lines.length) return null;
  return (
    <div className="mt-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      <table className="w-full border-collapse text-sm">
        <tbody>
          {lines.map((l) => (
            <ScopeLine key={l.id} l={l} showPrices={showPrices} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RoomBlock({ room, showPrices }: { room: ScopeRoom; showPrices: boolean }) {
  return (
    <div className="mt-4 break-inside-avoid">
      <div className="flex items-baseline justify-between border-b-2 border-gray-800 pb-0.5">
        <div className="text-sm font-bold">{room.name}</div>
        {room.sqft ? (
          <div className="text-xs tabular-nums text-gray-600">{Math.round(room.sqft)} sq ft</div>
        ) : null}
      </div>
      {room.prep.length ? (
        <div className="mt-1 text-xs">
          <span className="font-semibold text-gray-700">Prep: </span>
          <span className="text-gray-700">{room.prep.join(" · ")}</span>
        </div>
      ) : null}
      <SectionTable label="Product going in" lines={room.products} showPrices={showPrices} />
      <SectionTable label="Prep & labor" lines={room.labor} showPrices={showPrices} />
    </div>
  );
}

/**
 * The print-only INSTALLATION WORK ORDER — everything the installer needs to do
 * the job on site: who/where/when, then the scope grouped by room (product +
 * per-room prep + labor), whole-job labor, job-wide conditions and notes. No
 * pricing unless the office turns it on, and no signature lines (sign-off,
 * photos and payment are captured in the app, not on paper).
 */
export function InstallationWorkOrderDoc({
  org,
  job,
  assignedName,
  collectOnSite = null,
  expectedDays = null,
  showPrices = false,
}: {
  org: OrgSettings;
  job: JobDetail;
  assignedName: string | null;
  /** Balance the installer collects on site (when enabled), else null. */
  collectOnSite?: number | null;
  /** Expected install duration in days. */
  expectedDays?: number | null;
  /** Show prices on the work order — staff only; installers never see them. */
  showPrices?: boolean;
}) {
  const scope = buildJobScope(job.line_items, job.notes);
  const totalSqft = scope.rooms.reduce((s, r) => s + (r.sqft ?? 0), 0);

  const site = [
    job.site_street,
    [job.site_city, job.site_state].filter(Boolean).join(", "),
    job.site_zip,
  ]
    .filter(Boolean)
    .join(" · ");

  const dates = [
    job.scheduled_date ? formatDate(job.scheduled_date) : null,
    job.scheduled_end && job.scheduled_end !== job.scheduled_date
      ? formatDate(job.scheduled_end)
      : null,
  ].filter(Boolean);
  const windowLabel = job.arrival_window
    ? job.arrival_window.split("-").map((t) => to12(t)).join("–")
    : null;

  const facts: [string, string | null][] = [
    ["Installer / crew", assignedName ?? null],
    ["Arrival", windowLabel],
    ["Expected", expectedDays ? `${expectedDays} day${expectedDays === 1 ? "" : "s"}` : null],
    ["Rooms", scope.rooms.length ? String(scope.rooms.length) : null],
    ["Total area", totalSqft ? `${Math.round(totalSqft)} sq ft` : null],
    ["Delivery", job.delivery_type ? JOB_DELIVERY_LABELS[job.delivery_type] : null],
    ["Staged at", job.staging_location ?? null],
  ];

  const hasScope = scope.rooms.length > 0 || scope.wholeJob.products.length > 0 || scope.wholeJob.labor.length > 0;

  return (
    <div className="hidden text-black print:block">
      <PrintLetterhead
        org={org}
        docTitle="INSTALLATION WORK ORDER"
        meta={
          <>
            {job.title ? <div className="text-sm font-medium">{job.title}</div> : null}
            <div className="text-xs">
              {dates.length ? `Scheduled ${dates.join(" – ")}` : "Not yet scheduled"}
              {windowLabel ? ` · arrives ${windowLabel}` : ""}
            </div>
            <div className="text-xs">Status: {JOB_STATUS_LABELS[job.status]}</div>
          </>
        }
      />

      <div className="flex flex-wrap justify-between gap-6">
        {job.customer ? (
          <PrintBillTo
            label="Customer"
            name={job.customer.full_name}
            street={job.customer.street}
            city={job.customer.city}
            state={job.customer.state}
            zip={job.customer.zip}
            phone={job.customer.phone}
            email={job.customer.email}
          />
        ) : null}
        {site ? (
          <div className="py-4 text-sm">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Job site
            </div>
            <div className="text-xs text-gray-700">{site}</div>
          </div>
        ) : null}
      </div>

      {/* Key logistics */}
      <div className="flex flex-wrap gap-x-10 gap-y-1 border-y py-2 text-sm">
        {facts
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                {k}:{" "}
              </span>
              <span>{v}</span>
            </div>
          ))}
      </div>

      {/* Payment the installer collects on site */}
      {collectOnSite && collectOnSite > 0 ? (
        <div className="mt-3 break-inside-avoid rounded border-2 border-black p-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide">
            Collect on site
          </div>
          <div className="text-lg font-bold">
            {formatMoney(collectOnSite)} balance due
          </div>
          <div className="text-xs text-gray-600">
            Collect from the customer before you leave — cash, check, or request an
            online payment in the app. Mark it paid on your My&nbsp;Work screen.
          </div>
        </div>
      ) : null}

      {/* Job-wide conditions & prep — applies to all areas */}
      {scope.conditions.length ? (
        <div className="mt-4 break-inside-avoid rounded border border-gray-300 p-2 text-sm">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Conditions &amp; prep — all areas
          </div>
          <ul className="mt-0.5 list-disc pl-5">
            {scope.conditions.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Scope of work — by room */}
      <div className="mt-2">
        <div className="mt-4 text-sm font-semibold">Scope of work</div>
        {hasScope ? (
          <>
            {scope.rooms.map((r) => (
              <RoomBlock key={r.name} room={r} showPrices={showPrices} />
            ))}
            {scope.wholeJob.products.length || scope.wholeJob.labor.length ? (
              <div className="mt-4 break-inside-avoid">
                <div className="border-b-2 border-gray-800 pb-0.5 text-sm font-bold">
                  Whole job
                </div>
                <SectionTable label="Materials" lines={scope.wholeJob.products} showPrices={showPrices} />
                <SectionTable label="Labor & prep" lines={scope.wholeJob.labor} showPrices={showPrices} />
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-gray-600">
            No line items on file — see the estimate / notes.
          </p>
        )}
      </div>

      {scope.freeText ? (
        <div className="mt-4 break-inside-avoid text-sm">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Special instructions
          </div>
          <p className="whitespace-pre-wrap">{scope.freeText}</p>
        </div>
      ) : null}

      <div className="mt-10 text-center text-xs text-gray-500">{org.company_name}</div>
    </div>
  );
}
