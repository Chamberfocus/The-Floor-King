/**
 * Salesperson review — the last guided step before Builder.
 *
 * Groups what the questionnaire derived so an experienced estimator can scan
 * rooms, measured vs order, removal, install, prep, and specials without
 * reading every line item first.
 */

import { formatSqft, takeoffConceptRows, type MaterialTakeoff } from "./quantities";
import {
  CONDITION_CONFIDENCE_LABELS,
  familyFromCatalogCategory,
  familyLabel,
  isHardSurfaceFamily,
  type ConditionConfidence,
  type FlooringFamily,
} from "./families";
import { questionPurpose, type InstallContext } from "./rules";
import type { KnowledgeWhen, QuestionPurpose } from "@/lib/types";

export interface ReviewRoom {
  name: string;
  measuredSqft: number;
  sections: { name: string; length: string; width: string; sqft: number }[];
}

export interface ReviewSection {
  id: string;
  title: string;
  rows: { label: string; value: string; tone?: "muted" | "warn" | "ok" }[];
}

export interface SalespersonReview {
  rooms: ReviewRoom[];
  products: string[];
  takeoffs: MaterialTakeoff[];
  sections: ReviewSection[];
  warnings: { id: string; text: string }[];
  notes: string[];
}

/** Review column a answered question belongs in — purpose/key, not a `|level|` regex. */
export type ReviewBucket = "removal" | "installation" | "prep" | "accessories" | "specials";

const REMOVAL_KEYS = new Set([
  "hs_demo",
  "existing_bond",
  "existing_pad",
  "demo_disposal",
  "asbestos_risk",
]);

const SPECIAL_KEYS = new Set([
  "furniture_level",
  "furniture_heavy",
  "toilets",
  "appliances",
  "doors_shave",
  "carpet_curb",
  "occupancy",
  "access_conditions",
  "crew_entry",
  "delivery_scope",
  "radiant_heat",
]);

const ACCESSORY_MATERIAL_KEYS = new Set([
  "carpet_pad",
  "adhesive",
  "hs_underlayment",
  "tack_strip",
  "tack_strip_qty",
  "tile_setting",
  "attached_pad",
  "metals_needed",
  "metals_qty",
  "metal_type",
  "metal_color",
  "hs_transitions",
  "hs_base_trim",
  "vents_registers",
]);

/**
 * One source of truth for the salesperson review columns.
 *
 * `furniture_level` is LABOR, not Prep — a `|level|` regex used to dump it
 * there. Warehouse/layout notes (pattern, plank direction, tile layout) sit
 * under Installation, not Special conditions.
 */
export function reviewBucketForQuestion(q: {
  key?: string | null;
  label?: string | null;
  kind?: string;
  config?: {
    purpose?: QuestionPurpose | null;
    knowledge_when?: KnowledgeWhen | null;
    note?: boolean;
    trim_list?: boolean;
  };
}): ReviewBucket {
  const key = q.key ?? "";
  if (REMOVAL_KEYS.has(key)) return "removal";
  if (SPECIAL_KEYS.has(key)) return "specials";
  if (ACCESSORY_MATERIAL_KEYS.has(key) || q.config?.trim_list) return "accessories";

  const purpose = questionPurpose(q);
  switch (purpose) {
    case "PREP":
      return "prep";
    case "INSTALLATION":
    case "WAREHOUSE":
    case "MEASUREMENT":
      return "installation";
    case "ACCESSORY":
      return "accessories";
    case "MATERIAL":
      return ACCESSORY_MATERIAL_KEYS.has(key) ? "accessories" : "installation";
    case "LABOR":
      return "specials";
    case "WARNING":
    case "SCHEDULING":
    case "PURCHASING":
    case "SCOPE":
    case "PRICE":
      return "specials";
    default:
      break;
  }

  const blob = `${key} ${q.label ?? ""}`.toLowerCase();
  if (/demo|tear|removal|haul|dispos|pad remove/.test(blob)) return "removal";
  if (/prep|subfloor|moisture|vapor|substrate|skim|grind/.test(blob)) return "prep";
  if (/trim|metal|transition|quarter|nose|underlay|adhesive|tack|vent|grout|thinset|backer/.test(blob))
    return "accessories";
  if (/install|method|acclim|surface|stair|layout|pattern|direction/.test(blob)) return "installation";
  if (/toilet|appliance|furniture|occupancy|access|delivery|asbestos/.test(blob)) return "specials";
  return "specials";
}

export function confidenceFromLabel(raw: string | null | undefined): ConditionConfidence | null {
  const t = (raw ?? "").toLowerCase();
  if (!t) return null;
  if (t.includes("field") || t.includes("tbd") || t.includes("verify")) return "field_verify";
  if (t.includes("allow")) return "allowance";
  if (t.includes("estimat")) return "estimated";
  if (t.includes("known")) return "known";
  return null;
}

export function formatFtIn(ft: number, inch: number): string {
  const f = Math.floor(Math.max(0, ft));
  const i = Math.round(inch * 100) / 100;
  if (f <= 0 && i <= 0) return "";
  if (i === 0) return `${f}'`;
  return `${f}' ${i}"`;
}

export function formatDimensionPair(
  lenFt: number,
  lenIn: number,
  widFt: number,
  widIn: number,
): string {
  const a = formatFtIn(lenFt, lenIn);
  const b = formatFtIn(widFt, widIn);
  if (!a || !b) return "";
  return `${a} × ${b}`;
}

/** Measured area per product label — mixed jobs must not share whole-job sq ft. */
export function groupMeasuredSqftByLabel(
  rows: { label: string; measuredSqft: number }[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const label = r.label.trim();
    if (!label || !(r.measuredSqft > 0)) continue;
    out[label] = Math.round(((out[label] ?? 0) + r.measuredSqft) * 100) / 100;
  }
  return out;
}

/** Measured area per flooring family — carpet rooms are not LVP rooms. */
export function groupMeasuredSqftByFamily(
  rows: { category?: string | null; measuredSqft: number }[],
): Partial<Record<FlooringFamily, number>> {
  const out: Partial<Record<FlooringFamily, number>> = {};
  for (const r of rows) {
    const fam = familyFromCatalogCategory(r.category);
    if (fam === "other" || !(r.measuredSqft > 0)) continue;
    out[fam] = Math.round(((out[fam] ?? 0) + r.measuredSqft) * 100) / 100;
  }
  return out;
}

/**
 * Whole-job taped sq ft may become a family takeoff only when that family
 * owns the job. Mixed jobs without a per-room assignment stay 0 — we do not
 * clone 500 sq ft onto both carpet and LVP.
 */
export function measuredSqftForFamilyTakeoff(args: {
  family: FlooringFamily;
  totalSqft: number;
  byFamily: Partial<Record<FlooringFamily, number>>;
  jobFamilies: FlooringFamily[];
}): number {
  const assigned = args.byFamily[args.family];
  if (assigned != null && assigned > 0) return assigned;
  const flooring = args.jobFamilies.filter((f) => f !== "other");
  if (flooring.length <= 1) {
    const n = Number(args.totalSqft);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  return 0;
}

/** Sum of several families — still 0 on an unassigned mixed job. */
export function measuredSqftForFamiliesTakeoff(args: {
  families: FlooringFamily[];
  totalSqft: number;
  byFamily: Partial<Record<FlooringFamily, number>>;
  jobFamilies: FlooringFamily[];
}): number {
  const wanted = args.families.filter((f) => f !== "other");
  if (!wanted.length) return 0;
  let assigned = 0;
  for (const f of wanted) {
    const n = args.byFamily[f];
    if (n != null && n > 0) assigned += n;
  }
  if (assigned > 0) return Math.round(assigned * 100) / 100;
  const flooring = args.jobFamilies.filter((f) => f !== "other");
  if (flooring.length > 0 && flooring.every((f) => wanted.includes(f))) {
    const n = Number(args.totalSqft);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  return 0;
}

/**
 * Self-leveler bags and subfloor sheets.
 * Mixed carpet + hard surface uses HS rooms only. Unassigned mixed stays 0
 * rather than pouring bags onto the carpet. Carpet-only or HS-only still
 * uses the whole measured area (0142 asks Floor prep on either path).
 */
export function measuredSqftForPrepTakeoff(args: {
  totalSqft: number;
  byFamily: Partial<Record<FlooringFamily, number>>;
  jobFamilies: FlooringFamily[];
}): number {
  const hs = args.jobFamilies.filter(isHardSurfaceFamily);
  const flooring = args.jobFamilies.filter((f) => f !== "other");
  if (flooring.includes("carpet") && hs.length > 0) {
    return measuredSqftForFamiliesTakeoff({
      families: hs,
      totalSqft: args.totalSqft,
      byFamily: args.byFamily,
      jobFamilies: args.jobFamilies,
    });
  }
  const n = Number(args.totalSqft);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Builder emit / running takeoff strip for one question.
 * Pad covers carpet rooms. Laminate underlayment and prep cover HS rooms.
 * A flooring product covers its own family — never the whole mixed job.
 */
export function measuredSqftForQuestionCover(args: {
  kind?: string | null;
  key?: string | null;
  category?: string | null;
  totalSqft: number;
  byFamily: Partial<Record<FlooringFamily, number>>;
  jobFamilies: FlooringFamily[];
}): number {
  const kind = args.kind ?? "";
  const key = args.key ?? "";
  const cat = (args.category ?? "").trim().toLowerCase();
  if (kind === "selflevel" || kind === "subfloor" || key === "hs_underlayment") {
    return measuredSqftForPrepTakeoff(args);
  }
  if (key === "carpet_pad" || (kind === "product" && cat === "underlayment")) {
    return measuredSqftForFamilyTakeoff({
      family: "carpet",
      totalSqft: args.totalSqft,
      byFamily: args.byFamily,
      jobFamilies: args.jobFamilies,
    });
  }
  const fam = familyFromCatalogCategory(cat || (kind === "cuts" ? "carpet" : "other"));
  if (fam !== "other") {
    return measuredSqftForFamilyTakeoff({
      family: fam,
      totalSqft: args.totalSqft,
      byFamily: args.byFamily,
      jobFamilies: args.jobFamilies,
    });
  }
  const flooring = args.jobFamilies.filter((f) => f !== "other");
  if (flooring.length === 1) {
    return measuredSqftForFamilyTakeoff({
      family: flooring[0]!,
      totalSqft: args.totalSqft,
      byFamily: args.byFamily,
      jobFamilies: args.jobFamilies,
    });
  }
  return 0;
}

/**
 * Area-based yes/no / choice / number emit (demo, haul, prep labor).
 * Prep lines follow hard-surface rooms on a mixed job — the same split as
 * self-leveler bags. Demo / haul / furniture stay whole-job: the old floor is
 * not the new family.
 */
export function emitAreaSqftForQuestion(args: {
  key?: string | null;
  kind?: string | null;
  purpose?: string | null;
  totalSqft: number;
  byFamily: Partial<Record<FlooringFamily, number>>;
  jobFamilies: FlooringFamily[];
}): number {
  const key = args.key ?? "";
  const kind = args.kind ?? "";
  const purpose = (args.purpose ?? "").toUpperCase();
  if (key === "vinyl_skim") {
    return measuredSqftForFamilyTakeoff({
      family: "vinyl",
      totalSqft: args.totalSqft,
      byFamily: args.byFamily,
      jobFamilies: args.jobFamilies,
    });
  }
  if (
    purpose === "PREP" ||
    kind === "selflevel" ||
    kind === "subfloor" ||
    key === "hs_prep" ||
    key === "selflevel_needed" ||
    key === "subfloor_needed" ||
    key === "moisture_mitigation" ||
    key === "hs_underlayment" ||
    key === "vapor_barrier"
  ) {
    return measuredSqftForPrepTakeoff(args);
  }
  if (key === "carpet_pad" || key === "tack_strip") {
    return measuredSqftForFamilyTakeoff({
      family: "carpet",
      totalSqft: args.totalSqft,
      byFamily: args.byFamily,
      jobFamilies: args.jobFamilies,
    });
  }
  const n = Number(args.totalSqft);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function roomsAssignedToFamilies<T>(args: {
  rooms: { room: T; family: FlooringFamily | null }[];
  families: FlooringFamily[];
  jobFamilies: FlooringFamily[];
}): T[] {
  const wanted: Set<FlooringFamily> = new Set(args.families.filter((f) => f !== "other"));
  const assigned = args.rooms.filter((r) => r.family && r.family !== "other");
  if (assigned.length) {
    return assigned.filter((r) => r.family != null && wanted.has(r.family)).map((r) => r.room);
  }
  const flooring = args.jobFamilies.filter((f) => f !== "other");
  if (flooring.length > 0 && flooring.every((f) => wanted.has(f))) {
    return args.rooms.map((r) => r.room);
  }
  if (flooring.length === 1 && flooring[0] && wanted.has(flooring[0])) {
    return args.rooms.map((r) => r.room);
  }
  return [];
}

/** Subfloor sheets: HS rooms on a mixed job; every room on a single-path job. */
export function roomsForPrepTakeoff<T>(args: {
  rooms: { room: T; family: FlooringFamily | null }[];
  jobFamilies: FlooringFamily[];
}): T[] {
  const hs = args.jobFamilies.filter(isHardSurfaceFamily);
  const flooring = args.jobFamilies.filter((f) => f !== "other");
  if (flooring.includes("carpet") && hs.length > 0) {
    return roomsAssignedToFamilies({
      rooms: args.rooms,
      families: hs,
      jobFamilies: args.jobFamilies,
    });
  }
  return args.rooms.map((r) => r.room);
}

/**
 * Floor King Delivery add-on cost when the salesperson chose Include delivery
 * AND Settings already has a positive cost. Null = note only; never invent fuel $.
 */
export function deliveryAddonCost(
  selected: string[] | undefined,
  cost: number | null | undefined,
): number | null {
  if (!selected?.includes("Include delivery")) return null;
  const n = Number(cost);
  if (!(n > 0)) return null;
  return n;
}

function takeoffRows(t: MaterialTakeoff): ReviewSection["rows"] {
  return takeoffConceptRows(t);
}

export function buildSalespersonReview(args: {
  rooms: ReviewRoom[];
  products: string[];
  takeoffs: MaterialTakeoff[];
  ctx: InstallContext;
  removal: string[];
  installation: string[];
  prep: string[];
  accessories: string[];
  specials: string[];
  extraWarnings?: { id: string; text: string }[];
  /** Ids the salesperson dismissed — do not resurrect them from takeoff text. */
  suppressedWarningIds?: Iterable<string>;
}): SalespersonReview {
  const sections: ReviewSection[] = [];

  if (args.rooms.length) {
    sections.push({
      id: "rooms",
      title: "Rooms",
      rows: args.rooms.map((r) => {
        const bits = r.sections
          .filter((s) => s.sqft > 0)
          .map((s) => (s.length && s.width ? `${s.name}: ${s.length} × ${s.width} (${formatSqft(s.sqft)})` : `${s.name}: ${formatSqft(s.sqft)}`));
        return {
          label: r.name || "Room",
          value: bits.length ? `${formatSqft(r.measuredSqft)} — ${bits.join("; ")}` : formatSqft(r.measuredSqft),
        };
      }),
    });
  }

  if (args.products.length) {
    sections.push({
      id: "products",
      title: "Products",
      rows: args.products.map((p) => ({ label: "Product", value: p })),
    });
  }

  args.takeoffs.forEach((t, i) => {
    sections.push({
      id: `takeoff-${i}`,
      title: `${familyLabel(t.family)} takeoff`,
      rows: takeoffRows(t),
    });
  });

  const pushList = (id: string, title: string, items: string[]) => {
    if (!items.length) return;
    sections.push({
      id,
      title,
      rows: items.map((v) => ({ label: title.replace(/s$/, ""), value: v })),
    });
  };
  pushList("removal", "Removal", args.removal);
  pushList("installation", "Installation", args.installation);
  pushList("prep", "Prep", args.prep);
  pushList("accessories", "Accessories", args.accessories);
  pushList("specials", "Special conditions", args.specials);

  const conf = args.ctx.prepConfidence[0];
  const c = confidenceFromLabel(conf);
  if (c && c !== "known") {
    sections.push({
      id: "confidence",
      title: "Uncertainty",
      rows: [
        {
          label: "Prep",
          value: CONDITION_CONFIDENCE_LABELS[c],
          tone: "warn",
        },
      ],
    });
  }

  const warnings = mergeReviewWarnings(args.extraWarnings ?? [], args.takeoffs, {
    suppressIds: args.suppressedWarningIds,
  });

  // Occupancy / grade already sit in Special conditions / Installation when the
  // salesperson answered those questions. Only fall back here if ctx has them
  // and the section lists did not already print the same fact.
  const sectionBlob = sections
    .flatMap((s) => s.rows.map((r) => `${r.label} ${r.value}`.toLowerCase()))
    .join("\n");
  const notes: string[] = [];
  if (args.ctx.occupancy.length && !/occupancy/.test(sectionBlob)) {
    notes.push(`Occupancy: ${args.ctx.occupancy.join(", ")}`);
  }
  if (args.ctx.grade.length && !/\bgrade\b/.test(sectionBlob)) {
    notes.push(`Grade: ${args.ctx.grade.join(", ")}`);
  }

  return {
    rooms: args.rooms,
    products: args.products,
    takeoffs: args.takeoffs,
    sections,
    warnings,
    notes,
  };
}

/**
 * One list for Review + Builder notes.
 *
 * Questionnaire flags (`extraWarnings`) win on id. Takeoff engine messages
 * still ride along when the questionnaire did not already raise the same
 * carpet/vinyl "order is not sq ft ÷ 9" flag.
 */
export function mergeReviewWarnings(
  extra: { id: string; text: string }[],
  takeoffs: MaterialTakeoff[],
  opts?: { suppressIds?: Iterable<string> },
): { id: string; text: string }[] {
  const out = [...extra];
  const ids = new Set(out.map((w) => w.id));
  for (const id of opts?.suppressIds ?? []) ids.add(id);
  const texts = new Set(out.map((w) => w.text));
  for (const t of takeoffs) {
    t.warnings.forEach((text, i) => {
      const id =
        t.family === "carpet" && /cut plan|sq ft ÷ 9/i.test(text)
          ? "carpet-no-cuts"
          : t.family === "vinyl" && /sheet layout|order quantity|roll goods/i.test(text)
            ? "vinyl-no-layout"
            : `takeoff-${t.family}-${i}`;
      if (ids.has(id) || texts.has(text)) return;
      ids.add(id);
      texts.add(text);
      out.push({ id, text });
    });
  }
  return out;
}

/** Compact block that rides to the work order / builder job description. */
export function reviewToJobNotes(review: SalespersonReview): string {
  const lines: string[] = ["Guided takeoff:"];
  for (const s of review.sections) {
    lines.push(`${s.title}:`);
    for (const r of s.rows) lines.push(`• ${r.label}: ${r.value}`);
  }
  if (review.notes.length) {
    lines.push("Conditions:");
    for (const n of review.notes) lines.push(`• ${n}`);
  }
  if (review.warnings.length) {
    lines.push("Warnings:");
    for (const w of review.warnings) lines.push(`• ${w.text}`);
  }
  return lines.join("\n");
}

export function familyListLabel(families: FlooringFamily[]): string {
  if (!families.length) return "Flooring";
  return families.map(familyLabel).join(" + ");
}
