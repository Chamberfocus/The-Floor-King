/**
 * What a mill or distributor says about an item we sell: how much they have,
 * and the size and spec that came with the price catalog. Pure — no network.
 *
 * Our warehouse on_hand is a different number. These facts never replace it.
 */
import type { CatalogPriceRow } from "@/lib/fcb2b";
import { normalizeUnit } from "@/lib/units";

export interface SupplierItemFact {
  supplierSku: string;
  availableQty: number | null;
  availableUom: string | null;
  rollWidthFt: number | null;
  rollLengthFt: number | null;
  description: string | null;
  specUrl: string | null;
  details: Record<string, unknown>;
}

function num(value: string | null | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function allValues(body: string, pattern: RegExp): string[] {
  const out: string[] = [];
  const xml = new RegExp(
    `<([A-Za-z0-9_:.-]*${pattern.source}[A-Za-z0-9_:.-]*)\\b[^>]*>([^<]+)</\\1>`,
    "gi",
  );
  for (const match of body.matchAll(xml)) {
    if (match[2]?.trim()) out.push(match[2].trim());
  }
  if (out.length) return out;
  const key = `([A-Za-z0-9_.-]*${pattern.source}[A-Za-z0-9_.-]*)`;
  const quoted = new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, "gi");
  const bare = new RegExp(`"${key}"\\s*:\\s*(-?\\d[\\d,]*(?:\\.\\d+)?)`, "gi");
  for (const match of body.matchAll(quoted)) {
    if (match[2]?.trim()) out.push(match[2].trim());
  }
  for (const match of body.matchAll(bare)) {
    if (match[2]?.trim()) out.push(match[2].trim());
  }
  return out;
}

/** Sum every available-quantity the supplier reported for one item. */
export function stockFromBody(body: string): { qty: number | null; uom: string | null } {
  const quantities = allValues(body, /quantityavailable|availablequantity|qtyavailable|stockavailable/)
    .map(num)
    .filter((n): n is number => n != null);
  const uomRaw = allValues(body, /uom|unitofmeasure|unitcode/)[0] ?? null;
  if (!quantities.length) return { qty: null, uom: normalizeUnit(uomRaw) || uomRaw };
  const qty = Math.round(quantities.reduce((sum, n) => sum + n, 0) * 1000) / 1000;
  return { qty, uom: normalizeUnit(uomRaw) || uomRaw };
}

/** Only an https link is safe to store or show as a spec sheet. */
export function safeSpecUrl(value: string | null | undefined): string | null {
  const url = (value ?? "").trim();
  return /^https:\/\//i.test(url) ? url : null;
}

/** A spec sheet, warranty, or image URL from a document-service answer. */
export function specUrlFromBody(body: string): string | null {
  const candidates = allValues(body, /documenturl|specurl|specificationurl|warrantyurl|imageurl|href/);
  for (const value of candidates) {
    const url = safeSpecUrl(value);
    if (url) return url;
  }
  return null;
}

type Measurement = { qualifier?: string; value?: number | null; uom?: string };

/** Specs we can already read off an 832 price row. Stock is not in that file. */
export function factsFromCatalogRow(row: CatalogPriceRow): SupplierItemFact {
  const measurements = Array.isArray(row.raw.measurements)
    ? (row.raw.measurements as Measurement[])
    : [];
  const classifications =
    row.raw.classifications && typeof row.raw.classifications === "object"
      ? (row.raw.classifications as Record<string, string>)
      : {};
  return {
    supplierSku: row.supplierSku,
    availableQty: null,
    availableUom: null,
    rollWidthFt: row.rollWidthFt,
    rollLengthFt: row.rollLengthFt,
    description: row.description,
    specUrl: null,
    details: {
      ...(Object.keys(classifications).length ? { classifications } : {}),
      ...(measurements.length ? { measurements } : {}),
      ...(row.raw.manufacturer ? { manufacturer: row.raw.manufacturer } : {}),
    },
  };
}

/** One line for a picker: mill quantity, else the roll size from their catalog. */
export function millFactLabel(fact: {
  availableQty?: number | null;
  availableUom?: string | null;
  rollWidthFt?: number | null;
  rollLengthFt?: number | null;
}): string | null {
  if (fact.availableQty != null) {
    const uom = fact.availableUom ? ` ${fact.availableUom}` : "";
    return `Mill has ${fact.availableQty}${uom}`;
  }
  if (fact.rollWidthFt != null && fact.rollLengthFt != null) {
    return `Mill roll ${fact.rollWidthFt} ft × ${fact.rollLengthFt} ft`;
  }
  if (fact.rollWidthFt != null) return `Mill roll ${fact.rollWidthFt} ft wide`;
  return null;
}

/** A row as it sits in supplier_item_facts. Numbers may arrive as strings. */
export interface StoredSupplierFact {
  supplier_sku: string;
  available_qty: number | null;
  available_uom: string | null;
  roll_width_ft: number | null;
  roll_length_ft: number | null;
  description: string | null;
  spec_url: string | null;
  details: Record<string, unknown>;
}

function numOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

function detailsOrEmpty(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/** Keep a previously stored value when the new report left that field out. */
function keepText(incoming: string | null | undefined, previous: string | null | undefined): string | null {
  const next = textOrNull(incoming);
  if (next) return next;
  return textOrNull(previous);
}

export function storedFactFromRow(row: Record<string, unknown>): StoredSupplierFact {
  return {
    supplier_sku: textOrNull(row.supplier_sku) ?? "",
    available_qty: numOrNull(row.available_qty),
    available_uom: textOrNull(row.available_uom),
    roll_width_ft: numOrNull(row.roll_width_ft),
    roll_length_ft: numOrNull(row.roll_length_ft),
    description: textOrNull(row.description),
    spec_url: safeSpecUrl(textOrNull(row.spec_url)),
    details: detailsOrEmpty(row.details),
  };
}

/**
 * Fold a new report onto the last one.
 * A blank incoming quantity, width, or spec link must not erase what we stored.
 * Zero is a real quantity and does replace the old one.
 */
export function mergeSupplierFact(
  existing: StoredSupplierFact | null,
  incoming: SupplierItemFact,
): StoredSupplierFact {
  const prev = existing ? storedFactFromRow(existing as unknown as Record<string, unknown>) : null;
  const nextDetails = detailsOrEmpty(incoming.details);
  const prevDetails = prev?.details ?? {};
  return {
    supplier_sku: (prev?.supplier_sku || incoming.supplierSku).trim(),
    available_qty: incoming.availableQty != null ? incoming.availableQty : (prev?.available_qty ?? null),
    available_uom: keepText(incoming.availableUom, prev?.available_uom),
    roll_width_ft: incoming.rollWidthFt != null ? incoming.rollWidthFt : (prev?.roll_width_ft ?? null),
    roll_length_ft: incoming.rollLengthFt != null ? incoming.rollLengthFt : (prev?.roll_length_ft ?? null),
    description: keepText(incoming.description, prev?.description),
    spec_url: keepText(safeSpecUrl(incoming.specUrl), prev?.spec_url),
    details: Object.keys(nextDetails).length ? { ...prevDetails, ...nextDetails } : prevDetails,
  };
}
