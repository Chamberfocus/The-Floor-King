/**
 * Procurement facts for one page of jobs already chosen by job_queue_page.
 * Material quantity uses materialNeedQty. Cost columns are not selected.
 */
import { createClient } from "@/lib/supabase/server";
import type { CalcLine } from "@/lib/estimate-calc";
import { isMaterialLine } from "@/lib/job-scope";
import { materialNeedQty } from "@/lib/job-operational-scope";
import {
  coverageSentence,
  poAttentionFact,
  poEtaMissing,
  procurementCoverage,
  type PoReceiptLine,
} from "@/lib/po-facts";
import { lineDisplayUnit } from "@/lib/units";
import { formatDate } from "@/lib/format";

const LINE_COLS =
  "id, job_id, description, quantity, unit, measure_unit, product_id, category, line_type, manufacturer, color, style, item_no, room, sqft, waste_pct, length_in, width_in, measurements, sqft_per_box, roll_width_ft, from_stock, source";

export interface JobProcurementCard {
  lines: { text: string }[];
  pos: { text: string }[];
}

type LineRow = CalcLine & {
  id: string;
  job_id: string;
  description: string | null;
  product_id: string | null;
  manufacturer: string | null;
  color: string | null;
  style: string | null;
  item_no: string | null;
  room: string | null;
  from_stock: boolean | null;
  source: string | null;
  sqft_per_box: number | null;
  roll_width_ft: number | null;
};

export async function listJobProcurementFacts(
  jobIds: string[],
  opts?: { includeSupplier?: boolean },
): Promise<Map<string, JobProcurementCard>> {
  const includeSupplier = opts?.includeSupplier !== false;
  const out = new Map<string, JobProcurementCard>();
  if (!jobIds.length) return out;
  const supabase = await createClient();
  const { data: lineData, error } = await supabase
    .from("job_line_items")
    .select(LINE_COLS)
    .in("job_id", jobIds);
  if (error || !lineData) return out;

  const lines = (lineData as unknown as LineRow[]).filter((line) =>
    isMaterialLine(line),
  );
  const productIds = [
    ...new Set(lines.map((l) => l.product_id).filter((id): id is string => Boolean(id))),
  ];
  const supplierByProduct = new Map<string, string | null>();
  const nameByProduct = new Map<string, string>();
  if (productIds.length) {
    const { data: products } = await supabase
      .from("products")
      .select("id, name, supplier")
      .in("id", productIds);
    for (const product of products ?? []) {
      supplierByProduct.set(product.id as string, (product.supplier as string | null) ?? null);
      if (product.name) nameByProduct.set(product.id as string, product.name as string);
    }
  }

  const { data: pos } = await supabase
    .from("purchase_orders")
    .select("id, job_id, po_number, supplier, status, eta_date, backordered, is_stock")
    .in("job_id", jobIds)
    .not("status", "in", "(void,cancelled)");
  const poRows = (pos ?? []) as {
    id: string;
    job_id: string;
    po_number: number | null;
    supplier: string | null;
    status: string | null;
    eta_date: string | null;
    backordered: boolean | null;
    is_stock: boolean | null;
  }[];
  const poIds = poRows.map((p) => p.id);
  const itemsByPo = new Map<string, (PoReceiptLine & {
    job_line_id: string | null;
    product_id: string | null;
    quantity: number | null;
    unit: string | null;
  })[]>();
  if (poIds.length) {
    const { data: items } = await supabase
      .from("po_items")
      .select("po_id, job_line_id, product_id, quantity, unit, received_qty, received_at")
      .in("po_id", poIds);
    for (const item of items ?? []) {
      const poId = item.po_id as string;
      const arr = itemsByPo.get(poId) ?? [];
      arr.push({
        job_line_id: (item.job_line_id as string | null) ?? null,
        product_id: (item.product_id as string | null) ?? null,
        quantity: item.quantity == null ? null : Number(item.quantity),
        unit: (item.unit as string | null) ?? null,
        received_qty: item.received_qty == null ? null : Number(item.received_qty),
        received_at: (item.received_at as string | null) ?? null,
      });
      itemsByPo.set(poId, arr);
    }
  }

  const statusByPo = new Map(poRows.map((p) => [p.id, p.status ?? "draft"]));
  const posByJob = new Map<string, typeof poRows>();
  for (const po of poRows) {
    if (po.is_stock) continue;
    const arr = posByJob.get(po.job_id) ?? [];
    arr.push(po);
    posByJob.set(po.job_id, arr);
  }

  for (const jobId of jobIds) {
    const jobLines = lines.filter((l) => l.job_id === jobId);
    const jobPos = posByJob.get(jobId) ?? [];
    const shown = jobLines.slice(0, 3).map((line) => {
      const need = materialNeedQty(line);
      const unit = lineDisplayUnit(line);
      const label =
        (line.product_id ? nameByProduct.get(line.product_id) : null) ||
        line.description ||
        "Material";
      const room = line.room ? `${line.room} · ` : "";
      const supplier = line.product_id ? supplierByProduct.get(line.product_id) : null;
      if (line.from_stock || line.source === "stock") {
        return { text: `${room}${label} · ${need} ${unit || "units"} · From stock` };
      }
      const linked = jobPos.flatMap((po) =>
        (itemsByPo.get(po.id) ?? [])
          .filter((item) => item.job_line_id === line.id)
          .map((item) => ({
            quantity: Number(item.quantity) || 0,
            unit: item.unit,
            status: statusByPo.get(po.id) ?? "draft",
          })),
      );
      if (!linked.length && jobPos.length) {
        return {
          text: `${room}${label}${includeSupplier && supplier ? ` · ${supplier}` : ""} · Required ${need} ${unit || "units"}. Purchase orders on this job are not linked to this line, so coverage is not calculated.`,
        };
      }
      const coverage = procurementCoverage({ need, needUnit: unit, items: linked });
      const sentence =
        coverageSentence({
          need,
          unit,
          kind: coverage.kind,
          orderedQty: coverage.orderedQty,
          draftQty: coverage.draftQty,
        }) ?? `${need} ${unit}`;
      return {
        text: `${room}${label}${includeSupplier && supplier ? ` · ${supplier}` : ""} · ${sentence}`,
      };
    });
    const extra = Math.max(0, jobLines.length - shown.length);
    if (extra) shown.push({ text: `${extra} more material line${extra === 1 ? "" : "s"} on the job.` });

    const poTexts = jobPos.slice(0, 4).map((po) => {
      const attention = poAttentionFact({
        status: po.status,
        backordered: po.backordered,
        items: itemsByPo.get(po.id) ?? [],
      });
      const eta = po.eta_date
        ? `ETA ${formatDate(po.eta_date)}`
        : poEtaMissing(po)
          ? "ETA not entered"
          : "";
      const number = po.po_number != null ? `PO-${po.po_number}` : "Draft PO";
      return {
        text: [number, includeSupplier ? po.supplier : null, attention, eta]
          .filter(Boolean)
          .join(" · "),
      };
    });
    if (jobLines.length || poTexts.length) {
      out.set(jobId, { lines: shown, pos: poTexts });
    }
  }
  return out;
}
