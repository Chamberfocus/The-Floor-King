import { PrintLetterhead } from "@/components/print-letterhead";
import { formatDate } from "@/lib/format";
import {
  JOB_DELIVERY_LABELS,
  isRollGoodCategory,
  isHardSurfaceCategory,
  type OrgSettings,
} from "@/lib/types";
import { type CutSource } from "@/lib/job-scope";
import { CarpetCutList } from "@/components/carpet-cut-list";
import type { WarehouseJob } from "@/lib/data/jobs";
import type { JobMaterialLine } from "@/lib/data/job-materials";

/**
 * Print-only WAREHOUSE STAGING SHEET — the warehouse's job-prep doc. It has two
 * parts: (1) a PRODUCT SUMMARY — one line per product with its total quantity to
 * pull, combining the same product used across rooms (a what-to-get list, not a
 * room-by-room list); and (2) the CARPET CUT PLAN — the exact per-piece cuts the
 * warehouse must make off the roll (this stays piece-by-piece; it has to be
 * accurate to cut correctly). Plus staging notes and a "staged by" sign-off.
 * Everything comes from the SAME sourced list the on-screen warehouse queue uses
 * (getJobMaterials), so the printout can't disagree with the screen. The
 * installer-facing doc is the separate INSTALLATION WORK ORDER.
 */
export function StagingSheetDoc({
  org,
  job,
  lines,
}: {
  org: OrgSettings;
  job: WarehouseJob;
  lines: JobMaterialLine[];
}) {
  const site = [
    job.site_street,
    [job.site_city, job.site_state].filter(Boolean).join(", "),
    job.site_zip,
  ]
    .filter(Boolean)
    .join(" · ");

  const timeframe = job.scheduled_date
    ? job.scheduled_end && job.scheduled_end !== job.scheduled_date
      ? `${formatDate(job.scheduled_date)} – ${formatDate(job.scheduled_end)}`
      : formatDate(job.scheduled_date)
    : "Not scheduled";

  const facts: [string, string | null][] = [
    ["Installer / crew", job.crew_name],
    ["Delivery", JOB_DELIVERY_LABELS[job.delivery_type]],
    ["Warehouse", job.warehouse_assignee_name],
    ["Staged at", job.staging_location ?? null],
  ];

  // Product summary: combine the same product across rooms into ONE line with a
  // single total quantity (fill pieces roll into their product too). Distinct
  // source/status/supplier stay separate rows so "pull from stock" and
  // "order from vendor" for the same product don't get merged.
  interface ProductGroup {
    key: string;
    category: string | null;
    name: string;
    manufacturer: string | null;
    color: string | null;
    unit: string;
    sqftPerBox: number | null;
    rollWidthFt: number | null;
    resolvedSource: JobMaterialLine["resolvedSource"];
    status: JobMaterialLine["status"];
    supplier: string | null;
    qty: number;
  }
  const groups: ProductGroup[] = [];
  const byKey = new Map<string, ProductGroup>();
  for (const m of lines) {
    const name = m.productName || m.description || "Material";
    const key = [
      m.category ?? "",
      name.toLowerCase(),
      m.manufacturer ?? "",
      m.color ?? "",
      m.unit ?? "",
      m.sqftPerBox ?? "",
      m.rollWidthFt ?? "",
      m.resolvedSource,
      m.status,
      m.supplier ?? "",
    ].join("|");
    let g = byKey.get(key);
    if (!g) {
      g = {
        key,
        category: m.category,
        name,
        manufacturer: m.manufacturer,
        color: m.color,
        unit: m.unit,
        sqftPerBox: m.sqftPerBox,
        rollWidthFt: m.rollWidthFt,
        resolvedSource: m.resolvedSource,
        status: m.status,
        supplier: m.supplier,
        qty: 0,
      };
      byKey.set(key, g);
      groups.push(g);
    }
    g.qty += m.qty;
  }

  return (
    <div className="text-black">
      <PrintLetterhead
        org={org}
        docTitle="STAGING SHEET"
        meta={
          <>
            <div className="text-sm font-medium">
              {job.customer_name ?? "Customer"}
            </div>
            {job.title ? <div className="text-xs">{job.title}</div> : null}
            <div className="text-xs">Scheduled {timeframe}</div>
          </>
        }
      />

      {site ? (
        <div className="py-3 text-sm">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Job site:{" "}
          </span>
          <span>{site}</span>
        </div>
      ) : null}

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

      {/* Products needed — one line per product, tick each as it's pulled */}
      <div className="mt-4">
        <div className="mb-1 text-sm font-semibold">Products needed for this job</div>
        {groups.length ? (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] text-gray-500">
                <th className="w-8 py-1 pr-2 font-medium">Done</th>
                <th className="py-1 px-2 font-medium">Product</th>
                <th className="py-1 px-2 font-medium">Source</th>
                <th className="py-1 pl-2 text-right font-medium">Total quantity</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const isHard = isHardSurfaceCategory(g.category);
                const isRoll = isRollGoodCategory(g.category);
                // Hard surface pulls by the CARTON; show the sq-ft basis so the
                // count is verifiable. Roll goods show the total + broadloom width.
                const cartons =
                  isHard && g.sqftPerBox && g.sqftPerBox > 0
                    ? Math.ceil(g.qty / g.sqftPerBox)
                    : 0;
                const qtyMain = cartons
                  ? `${cartons} carton${cartons === 1 ? "" : "s"}`
                  : g.qty > 0
                    ? `${Math.round(g.qty * 100) / 100} ${g.unit || ""}`.trim()
                    : "";
                const qtySub = cartons
                  ? `${Math.round(g.qty * 100) / 100} sq ft ÷ ${g.sqftPerBox}/box`
                  : isHard
                    ? "⚠ set sq ft/box"
                    : isRoll && g.rollWidthFt
                      ? `${g.rollWidthFt} ft broadloom`
                      : "";
                const idTags = [g.manufacturer, g.color].filter(Boolean).join(" · ");
                const sourceLabel =
                  g.resolvedSource === "stock"
                    ? "Pull from stock"
                    : g.status === "arrived"
                      ? "Ordered ✓ arrived"
                      : `⏳ Order${g.supplier ? ` · ${g.supplier}` : ""} — not yet in`;
                return (
                  <tr key={g.key} className="border-b align-top">
                    <td className="py-1.5 pr-2">
                      <span className="inline-block size-4 border border-gray-500" />
                    </td>
                    <td className="py-1.5 px-2">
                      {g.name}
                      {idTags ? (
                        <span className="block text-[11px] text-gray-500">{idTags}</span>
                      ) : null}
                    </td>
                    <td className="py-1.5 px-2 text-xs text-gray-600">{sourceLabel}</td>
                    <td className="py-1.5 pl-2 text-right align-top tabular-nums text-gray-700">
                      <div className="font-semibold">{qtyMain}</div>
                      {qtySub ? (
                        <div className="text-[11px] font-normal text-gray-500">{qtySub}</div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-gray-600">
            No material list linked to this job — check the estimate / notes.
          </p>
        )}
      </div>

      {/* Carpet cut plan — the exact per-piece cuts to pull off the roll (incl.
          fill pieces). Stays piece-by-piece: the warehouse cuts from this, so it
          has to be accurate. */}
      <CarpetCutList
        items={lines.map(
          (m): CutSource => ({
            room: m.room,
            description: m.productName || m.description,
            category: m.category,
            length_in: m.lengthIn,
            width_in: m.widthIn,
            is_fill: m.isFill,
            roll_width_ft: m.rollWidthFt,
            manufacturer: m.manufacturer,
            color: m.color,
          }),
        )}
        title="Carpet cut plan"
        note="Cut each piece off the roll at the size shown; fill pieces come from the same roll."
      />

      {lines.some((m) => isHardSurfaceCategory(m.category)) ? (
        <div className="mt-3 break-inside-avoid rounded border-2 border-black p-2 text-sm">
          <span className="font-semibold">⚠ Lot / dye lot:</span> verify all cartons
          for each product are the <span className="font-semibold">same lot / dye lot</span>{" "}
          before staging. Do not mix lots.
        </div>
      ) : null}

      {job.notes ? (
        <div className="mt-4 break-inside-avoid text-sm">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Staging notes
          </div>
          <p className="whitespace-pre-wrap">{job.notes}</p>
        </div>
      ) : null}

      {/* Sign-off */}
      <div className="mt-10 flex justify-between gap-8 break-inside-avoid text-sm">
        <div className="flex-1">
          <div className="border-t border-gray-500 pt-1 text-xs text-gray-600">
            Staged &amp; checked by
          </div>
        </div>
        <div className="w-40">
          <div className="border-t border-gray-500 pt-1 text-xs text-gray-600">
            Date
          </div>
        </div>
      </div>

      <div className="mt-6 text-center text-xs text-gray-500">
        {org.company_name}
      </div>
    </div>
  );
}
