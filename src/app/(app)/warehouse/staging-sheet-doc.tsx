import { PrintLetterhead } from "@/components/print-letterhead";
import { formatDate } from "@/lib/format";
import {
  JOB_DELIVERY_LABELS,
  isRollGoodCategory,
  isHardSurfaceCategory,
  type OrgSettings,
} from "@/lib/types";
import { ftIn, type CutSource } from "@/lib/job-scope";
import { CarpetCutList } from "@/components/carpet-cut-list";
import type { WarehouseJob } from "@/lib/data/jobs";
import type { JobMaterialLine } from "@/lib/data/job-materials";

/**
 * Print-only WAREHOUSE STAGING SHEET — a pick list the warehouse carries while
 * pulling & staging material for a job: who/where/when, delivery method, the
 * materials with a tick box to check each off as pulled, staging notes, and a
 * "staged by" sign-off. Materials come from the SAME sourced list the on-screen
 * warehouse queue uses (getJobMaterials), so the printout can't disagree with
 * the screen — pull-vs-order, cuts, and "arrived" all match.
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

      {/* Materials to pull — tick each as it's staged */}
      <div className="mt-4">
        <div className="mb-1 text-sm font-semibold">Materials to pull &amp; stage</div>
        {lines.length ? (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] text-gray-500">
                <th className="w-8 py-1 pr-2 font-medium">Done</th>
                <th className="py-1 px-2 font-medium">Room / material</th>
                <th className="py-1 px-2 font-medium">Source</th>
                <th className="py-1 px-2 font-medium">Cut size (W × L)</th>
                <th className="py-1 pl-2 text-right font-medium">Quantity</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((m) => {
                const isHard = isHardSurfaceCategory(m.category);
                const isRoll = isRollGoodCategory(m.category);
                // Hard surface pulls by the CARTON; show the sq-ft basis so the
                // count is verifiable. Roll goods pull by the sq yd (+ cut).
                const cartons =
                  isHard && m.sqftPerBox && m.sqftPerBox > 0
                    ? Math.ceil(m.qty / m.sqftPerBox)
                    : 0;
                const qtyMain = cartons
                  ? `${cartons} carton${cartons === 1 ? "" : "s"}`
                  : m.qty > 0
                    ? `${Math.round(m.qty * 100) / 100} ${m.unit || ""}`.trim()
                    : "";
                const qtySub = cartons
                  ? `${Math.round(m.qty * 100) / 100} sq ft ÷ ${m.sqftPerBox}/box`
                  : isHard
                    ? "⚠ set sq ft/box"
                    : "";
                const cut =
                  isRoll && m.lengthIn && m.widthIn
                    ? `${ftIn(m.widthIn)} × ${ftIn(m.lengthIn)}`
                    : "";
                const rollNote =
                  isRoll && m.orderAsRoll && m.rollWidthFt
                    ? `${m.rollWidthFt} ft roll`
                    : "";
                const idTags = [m.manufacturer, m.color].filter(Boolean).join(" · ");
                const sourceLabel =
                  m.resolvedSource === "stock"
                    ? "Pull from stock"
                    : m.status === "arrived"
                      ? "Ordered ✓ arrived"
                      : `⏳ Order${m.supplier ? ` · ${m.supplier}` : ""} — not yet in`;
                return (
                  <tr key={m.lineId} className="border-b align-top">
                    <td className="py-1.5 pr-2">
                      <span className="inline-block size-4 border border-gray-500" />
                    </td>
                    <td className="py-1.5 px-2">
                      {m.room ? `${m.room} — ` : ""}
                      {m.productName || m.description || "Material"}
                      {m.isFill ? (
                        <span className="ml-1 rounded-sm border border-gray-500 px-1 text-[9px] font-bold uppercase">
                          Fill
                        </span>
                      ) : null}
                      {idTags ? (
                        <span className="block text-[11px] text-gray-500">{idTags}</span>
                      ) : null}
                    </td>
                    <td className="py-1.5 px-2 text-xs text-gray-600">{sourceLabel}</td>
                    <td className="py-1.5 px-2 whitespace-nowrap tabular-nums">
                      {cut ? <span className="font-semibold">✂ {cut}</span> : null}
                      {cut && rollNote ? " · " : null}
                      {rollNote ? <span className="text-gray-600">{rollNote}</span> : null}
                      {!cut && !rollNote ? <span className="text-gray-300">—</span> : null}
                    </td>
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

      {/* Carpet cut plan — the exact cuts to pull off the roll, incl. fill pieces */}
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
