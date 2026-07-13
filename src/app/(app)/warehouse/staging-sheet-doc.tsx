import { PrintLetterhead } from "@/components/print-letterhead";
import { formatDate } from "@/lib/format";
import { JOB_DELIVERY_LABELS, isRollGoodCategory, type OrgSettings } from "@/lib/types";
import { ftIn } from "@/lib/job-scope";
import type { WarehouseJob } from "@/lib/data/jobs";

/**
 * Print-only WAREHOUSE STAGING SHEET — a pick list the warehouse carries while
 * pulling & staging material for a job: who/where/when, delivery method, the
 * materials with a tick box to check each off as pulled, staging notes, and a
 * "staged by" sign-off.
 */
export function StagingSheetDoc({
  org,
  job,
}: {
  org: OrgSettings;
  job: WarehouseJob;
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
        {job.materials.length ? (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] text-gray-500">
                <th className="w-8 py-1 pr-2 font-medium">Done</th>
                <th className="py-1 px-2 font-medium">Room / material</th>
                <th className="py-1 px-2 font-medium">Cut size (W × L)</th>
                <th className="py-1 pl-2 text-right font-medium">Quantity</th>
              </tr>
            </thead>
            <tbody>
              {job.materials.map((m, i) => {
                const qty =
                  m.quantity && m.quantity > 0
                    ? `${Math.round(m.quantity * 100) / 100} ${m.unit || ""}`.trim()
                    : m.sqft
                      ? `${m.sqft} sq ft`
                      : "";
                // Cut to size applies to roll goods (carpet / sheet vinyl).
                const cut =
                  isRollGoodCategory(m.category) && m.length_in && m.width_in
                    ? `${ftIn(m.width_in)} × ${ftIn(m.length_in)}`
                    : "";
                const idTags = [m.manufacturer, m.color].filter(Boolean).join(" · ");
                return (
                  <tr key={i} className="border-b align-top">
                    <td className="py-1.5 pr-2">
                      <span className="inline-block size-4 border border-gray-500" />
                    </td>
                    <td className="py-1.5 px-2">
                      {m.room ? `${m.room} — ` : ""}
                      {m.description || "Material"}
                      {idTags ? (
                        <span className="block text-[11px] text-gray-500">{idTags}</span>
                      ) : null}
                    </td>
                    <td className="py-1.5 px-2 whitespace-nowrap font-semibold tabular-nums">
                      {cut ? `✂ ${cut}` : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="py-1.5 pl-2 text-right tabular-nums text-gray-600">
                      {qty}
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
