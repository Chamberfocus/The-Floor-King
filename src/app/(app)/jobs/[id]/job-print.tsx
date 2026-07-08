import { PrintLetterhead, PrintBillTo } from "@/components/print-letterhead";
import { lineQty, lineTotal } from "@/lib/estimate-calc";
import { formatDate, formatMoney } from "@/lib/format";
import {
  JOB_STATUS_LABELS,
  JOB_DELIVERY_LABELS,
  type EstimateLineItem,
  type OrgSettings,
} from "@/lib/types";
import type { JobDetail } from "@/lib/data/jobs";

function scopeQty(l: EstimateLineItem): string {
  if (l.line_type === "flat") return "";
  const unit =
    (l.unit && l.unit.trim()) ||
    (l.measure_unit === "sqyd" ? "sq yd" : "sq ft");
  return `${lineQty(l).toFixed(2)} ${unit}`;
}

function scopeLabel(l: EstimateLineItem): string {
  return [l.room, l.description || "Line item"].filter(Boolean).join(" — ");
}

/**
 * The print-only WORK ORDER — a clean, professional sheet for the crew &
 * warehouse: who/where, schedule, delivery & staging, and the scope of work
 * (materials + labor by room) with quantities but NO customer pricing. A
 * sign-off line closes it out on site.
 */
export function JobPrintDoc({
  org,
  job,
  assignedName,
}: {
  org: OrgSettings;
  job: JobDetail;
  assignedName: string | null;
}) {
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

  const facts: [string, string | null][] = [
    ["Installer / crew", assignedName ?? null],
    ["Delivery", job.delivery_type ? JOB_DELIVERY_LABELS[job.delivery_type] : null],
    ["Staged at", job.staging_location ?? null],
  ];

  return (
    <div className="hidden text-black print:block">
      <PrintLetterhead
        org={org}
        docTitle="WORK ORDER"
        meta={
          <>
            {job.title ? <div className="text-sm font-medium">{job.title}</div> : null}
            <div className="text-xs">
              {dates.length ? `Scheduled ${dates.join(" – ")}` : "Not yet scheduled"}
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

      {/* Scope of work — quantities only, no pricing */}
      <div className="mt-4">
        <div className="mb-1 text-sm font-semibold">Scope of work</div>
        {job.line_items.length ? (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] text-gray-500">
                <th className="py-1 pr-2 font-medium">Room / item</th>
                <th className="py-1 pl-2 text-right font-medium">Quantity</th>
                {job.show_prices ? <th className="py-1 pl-2 text-right font-medium">Amount</th> : null}
              </tr>
            </thead>
            <tbody>
              {job.line_items.map((l) => (
                <tr key={l.id} className="border-b align-top">
                  <td className="py-1 pr-2">{scopeLabel(l)}</td>
                  <td className="py-1 pl-2 text-right tabular-nums text-gray-600">
                    {scopeQty(l)}
                  </td>
                  {job.show_prices ? (
                    <td className="py-1 pl-2 text-right tabular-nums text-gray-600">
                      {formatMoney(lineTotal(l))}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-gray-600">
            No line items on file — see the estimate / notes.
          </p>
        )}
      </div>

      {job.notes ? (
        <div className="mt-4 break-inside-avoid text-sm">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Job notes / conditions
          </div>
          <p className="whitespace-pre-wrap">{job.notes}</p>
        </div>
      ) : null}

      <div className="mt-10 text-center text-xs text-gray-500">{org.company_name}</div>
    </div>
  );
}
