import { PrintLetterhead, PrintBillTo } from "@/components/print-letterhead";
import { lineTotal } from "@/lib/estimate-calc";
import { formatDate, formatMoney, to12 } from "@/lib/format";
import {
  JOB_STATUS_LABELS,
  JOB_DELIVERY_LABELS,
  isHardSurfaceCategory,
  type EstimateLineItem,
  type OrgSettings,
} from "@/lib/types";
import {
  buildJobScope,
  jobMaterialType,
  lineSpec,
  MATERIAL_TYPE_LABEL,
  PAD_ROLL_SQYD,
  type ScopeRoom,
} from "@/lib/job-scope";
import { CarpetCutList } from "@/components/carpet-cut-list";
import type { JobDetail } from "@/lib/data/jobs";

/** One scope line, rendered the same in every section of the work order. */
function ScopeLine({ l, showPrices }: { l: EstimateLineItem; showPrices: boolean }) {
  const spec = lineSpec(l);
  // Hard surface installs by the carton — show the box count so the crew knows
  // how many to open, with the sq-ft basis.
  const spb = Number(l.sqft_per_box) || 0;
  const sf = Number(l.quantity) || Number(l.sqft) || 0;
  const cartons =
    isHardSurfaceCategory(l.category) && spb > 0 && sf > 0 ? Math.ceil(sf / spb) : 0;
  return (
    <tr className="border-b border-gray-200 align-top">
      <td className="py-0.5 pr-2">
        <span className="font-medium">{l.description || "Line item"}</span>
        {l.manufacturer || l.style || l.color || l.item_no ? (
          <span className="text-gray-500">
            {"  "}
            {[l.manufacturer, l.style, l.color, l.item_no ? `#${l.item_no}` : null]
              .filter(Boolean)
              .join(" · ")}
          </span>
        ) : null}
        {l.from_stock ? <span className="text-gray-500"> · from stock</span> : null}
        {spec.isFill ? (
          <span className="ml-1 rounded-sm border border-gray-500 px-1 text-[9px] font-bold uppercase text-gray-700">
            Fill
          </span>
        ) : null}
        {spec.cut ? <span className="font-semibold text-gray-700">{"  "}✂ {spec.cut}</span> : null}
        {spec.rolls ? (
          <span className="text-gray-600">
            {"  "}· {spec.rolls} roll{spec.rolls > 1 ? "s" : ""} @ {PAD_ROLL_SQYD} sq yd
          </span>
        ) : null}
        {cartons ? (
          <span className="font-semibold text-gray-700">
            {"  "}📦 {cartons} carton{cartons === 1 ? "" : "s"}
            <span className="font-normal text-gray-500"> ({spb} SF/box)</span>
          </span>
        ) : null}
      </td>
      <td className="whitespace-nowrap py-0.5 pl-2 text-right tabular-nums text-gray-600">{spec.qty}</td>
      {showPrices ? (
        <td className="whitespace-nowrap py-0.5 pl-2 text-right tabular-nums text-gray-600">
          {formatMoney(lineTotal(l))}
        </td>
      ) : null}
    </tr>
  );
}

/** A room's lines under a small, quiet tag (Product / Labor). */
function LineGroup({
  tag,
  lines,
  showPrices,
}: {
  tag: string;
  lines: EstimateLineItem[];
  showPrices: boolean;
}) {
  if (!lines.length) return null;
  return (
    <div className="mt-0.5">
      <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-400">{tag}</div>
      <table className="w-full border-collapse text-[13px]">
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
    <div className="mt-2 break-inside-avoid">
      <div className="flex items-baseline justify-between border-b border-gray-800 pb-0.5">
        <div className="text-sm font-bold">{room.name}</div>
        {room.sqft ? (
          <div className="text-[11px] tabular-nums text-gray-600">{Math.round(room.sqft)} sq ft</div>
        ) : null}
      </div>
      {room.prep.length ? (
        <div className="mt-0.5 text-[11px] text-gray-700">
          <span className="font-semibold">Prep:</span> {room.prep.join(" · ")}
        </div>
      ) : null}
      <LineGroup tag="Product" lines={room.products} showPrices={showPrices} />
      <LineGroup tag="Labor" lines={room.labor} showPrices={showPrices} />
    </div>
  );
}

/**
 * The print-only INSTALLATION WORK ORDER — everything the installer needs to do
 * the job on site: who/where/when, then the scope grouped by room (product +
 * per-room prep + labor), whole-job labor, job-wide conditions and notes. No
 * pricing unless the office turns it on. Tuned for density + scannability so a
 * typical job fits one page: room names lead, everything else stays quiet.
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
  const matType = jobMaterialType(job.line_items);
  const hasRoll = matType === "carpet" || matType === "both";
  const hasHard = matType === "hard" || matType === "both";
  const hasHardwood = job.line_items.some((l) => l.category === "hardwood");

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
    ["Job type", matType ? MATERIAL_TYPE_LABEL[matType] : null],
    ["Installer / crew", assignedName ?? null],
    ["Arrival", windowLabel],
    ["Expected", expectedDays ? `${expectedDays} day${expectedDays === 1 ? "" : "s"}` : null],
    ["Rooms", scope.rooms.length ? String(scope.rooms.length) : null],
    ["Total area", totalSqft ? `${Math.round(totalSqft)} sq ft` : null],
    ["Delivery", job.delivery_type ? JOB_DELIVERY_LABELS[job.delivery_type] : null],
    ["Staged at", job.staging_location ?? null],
  ];

  const hasScope =
    scope.rooms.length > 0 || scope.wholeJob.products.length > 0 || scope.wholeJob.labor.length > 0;

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

      {/* Who / where — tight two-up. */}
      <div className="flex flex-wrap justify-between gap-6 py-1">
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
          <div className="text-sm">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Job site</div>
            <div className="text-xs text-gray-700">{site}</div>
          </div>
        ) : null}
      </div>

      {/* Logistics strip — one line, quiet. */}
      <div className="flex flex-wrap gap-x-6 gap-y-0.5 border-y border-gray-300 py-1 text-xs">
        {facts
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <span className="text-[9px] font-semibold uppercase tracking-wide text-gray-500">{k}: </span>
              <span className="font-medium">{v}</span>
            </div>
          ))}
      </div>

      {/* Payment the installer collects on site — kept prominent (it's an action). */}
      {collectOnSite && collectOnSite > 0 ? (
        <div className="mt-2 flex items-baseline justify-between break-inside-avoid rounded border-2 border-black px-2 py-1">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wide">Collect on site: </span>
            <span className="text-base font-bold">{formatMoney(collectOnSite)}</span>
          </div>
          <div className="text-[10px] text-gray-600">
            Cash / check / online — mark paid on My&nbsp;Work.
          </div>
        </div>
      ) : null}

      {/* Job-wide conditions — applies to all areas. */}
      {scope.conditions.length ? (
        <div className="mt-2 break-inside-avoid text-xs">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-gray-500">
            Conditions — all areas:{" "}
          </span>
          <span className="text-gray-700">{scope.conditions.join("  ·  ")}</span>
        </div>
      ) : null}

      {/* Scope of work — by room. The crew scans by room, so this leads. */}
      <div className="mt-3">
        <div className="text-sm font-bold uppercase tracking-wide">Scope of work</div>
        {hasScope ? (
          <>
            {scope.rooms.map((r) => (
              <RoomBlock key={r.name} room={r} showPrices={showPrices} />
            ))}
            {scope.wholeJob.products.length || scope.wholeJob.labor.length ? (
              <div className="mt-2 break-inside-avoid">
                <div className="border-b border-gray-800 pb-0.5 text-sm font-bold">Whole job</div>
                <LineGroup tag="Material" lines={scope.wholeJob.products} showPrices={showPrices} />
                <LineGroup tag="Labor" lines={scope.wholeJob.labor} showPrices={showPrices} />
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-gray-600">No line items on file — see the estimate / notes.</p>
        )}
      </div>

      {/* Carpet cut list — every piece to cut off the roll, incl. fill pieces. */}
      <CarpetCutList
        items={job.line_items}
        note="Match these cut sizes on the roll; keep pile direction consistent and save usable remnants."
      />

      {scope.freeText ? (
        <div className="mt-2 break-inside-avoid text-sm">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-gray-500">
            Special instructions:{" "}
          </span>
          <span className="whitespace-pre-wrap">{scope.freeText}</span>
        </div>
      ) : null}

      {/* Crew reminders — the same every job, so kept small & quiet at the foot
          (all of it retained; it just no longer competes with the scope). */}
      {hasRoll || hasHard ? (
        <div className="mt-3 break-inside-avoid border-t border-gray-300 pt-1 text-[10px] leading-tight text-gray-600">
          <span className="font-semibold uppercase tracking-wide text-gray-500">Reminders  </span>
          {hasRoll ? (
            <span>
              <span className="font-semibold">Carpet:</span> plan seams &amp; keep pile direction consistent;
              tackless secured (concrete vs wood), pad seams offset; match cut sizes, save remnants.{" "}
            </span>
          ) : null}
          {hasHard ? (
            <span>
              <span className="font-semibold">Hard surface:</span> confirm subfloor prep &amp; moisture per room;
              dry-fit / rack from multiple cartons, same lot / dye lot;
              {hasHardwood ? " hardwood acclimation complete;" : ""} set transitions &amp; molding per area.
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 text-center text-[10px] text-gray-500">{org.company_name}</div>
    </div>
  );
}
