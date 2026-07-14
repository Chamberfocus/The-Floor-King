/**
 * The accessory engine — adoption and generation.
 *
 * Both operations take an injected Supabase client rather than reaching for a
 * request-scoped one, so the exact same code runs from a Server Function and
 * from a verification script. A verifier that re-implements the logic proves
 * nothing about the logic that ships; this way there is only one implementation.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_PIECE_LENGTH_IN,
  FLOORING_CATEGORIES,
  accessoryItemName,
  defaultsForType,
  displayVariant,
  isColorPolluted,
  parseAccessoryType,
  styleIsNotALine,
  variantKey,
  variesByRun,
} from "@/lib/accessories";
import type {
  AccessoryProgram,
  AccessoryProgramType,
  AccessoryType,
  AccessoryUnit,
  Product,
} from "@/lib/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = SupabaseClient<any, any, any>;

const PAGE = 1000;
const BATCH = 500;

/** The most common value in a list — the price/unit the vendor really uses. */
function modal<T>(values: T[]): T {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

// --- Colors ------------------------------------------------------------------

export interface ResolvedColor {
  key: string; // variantKey — what the unique index is built on
  display: string;
  products: number;
}

/**
 * The colors a program generates against, read LIVE from the flooring products.
 *
 * This is the whole point of tying colors to the floors: there is no second list
 * to maintain. Add a flooring color and it appears here, so the coordinating
 * accessories become generatable with no extra data entry.
 *
 * Deduped by `variantKey`, which folds "NATURAL"/"Natural"/"natural" into ONE
 * variant — without that fold the catalog would carry three near-identical
 * T-Molds and the unique index would happily allow all three.
 */
export async function resolveColors(
  db: Db,
  program: Pick<
    AccessoryProgram,
    "manufacturer" | "style" | "color_source" | "manual_colors"
  >,
): Promise<ResolvedColor[]> {
  if (program.color_source === "manual") {
    const seen = new Map<string, ResolvedColor>();
    for (const raw of program.manual_colors ?? []) {
      const key = variantKey(raw);
      if (!key || seen.has(key)) continue;
      seen.set(key, { key, display: displayVariant(raw), products: 0 });
    }
    return [...seen.values()].sort((a, b) => a.display.localeCompare(b.display));
  }

  const rows: { color: string | null }[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db
      .from("products")
      .select("color")
      .in("category", FLOORING_CATEGORIES)
      .not("color", "is", null)
      .range(from, from + PAGE - 1);
    if (program.manufacturer) q = q.eq("manufacturer", program.manufacturer);
    if (program.color_source === "line" && program.style) {
      q = q.eq("style", program.style);
    }
    const { data, error } = await q;
    if (error) throw error;
    const batch = (data ?? []) as { color: string | null }[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }

  // Fold case/spacing variants, keeping the most common spelling for display.
  const byKey = new Map<string, { spellings: Map<string, number>; n: number }>();
  for (const r of rows) {
    const key = variantKey(r.color);
    if (!key) continue;
    const raw = (r.color ?? "").trim();
    const e = byKey.get(key) ?? { spellings: new Map<string, number>(), n: 0 };
    e.spellings.set(raw, (e.spellings.get(raw) ?? 0) + 1);
    e.n += 1;
    byKey.set(key, e);
  }
  return [...byKey.entries()]
    .map(([key, e]) => {
      const best = [...e.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0];
      return { key, display: displayVariant(best), products: e.n };
    })
    .sort((a, b) => a.display.localeCompare(b.display));
}

// --- Adoption ----------------------------------------------------------------

export interface AdoptReport {
  scanned: number;
  adopted: number;
  programs: number;
  types: number;
  overrides: number;
  skipped: Record<string, number>;
  error: string | null;
}

/**
 * Take over the vendor trim rows already in the catalog: read the type out of
 * each name, group by (manufacturer, line, type), and record that grouping.
 *
 * PURELY ADDITIVE. Writes only the provenance columns onto rows that already
 * exist — never deletes, deactivates, renames, re-SKUs, or re-prices a vendor
 * row. The vendor's price IS the truth; where colors within one type disagree on
 * price, the odd ones out get a per-item `price_override` so their real price
 * survives verbatim instead of being averaged away.
 *
 * Anything that does not parse cleanly is LEFT ALONE and surfaced as
 * unprogrammed. A wrong guess here would mis-price a real item, so we don't guess.
 *
 * `manufacturers` scopes the pass to a few brands, so the derivation can be
 * reviewed on brands you know before it is trusted across the whole catalog.
 */
export async function adoptTrim(
  db: Db,
  opts: { manufacturers?: string[] } = {},
): Promise<AdoptReport> {
  const report: AdoptReport = {
    scanned: 0,
    adopted: 0,
    programs: 0,
    types: 0,
    overrides: 0,
    skipped: {},
    error: null,
  };

  // Only rows not already in a program — so re-running adoption is a no-op on
  // what it already took, rather than a second pass over it.
  const trim: Product[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db
      .from("products")
      .select("*")
      .eq("category", "trim")
      .is("accessory_program_id", null)
      .range(from, from + PAGE - 1);
    if (opts.manufacturers?.length) q = q.in("manufacturer", opts.manufacturers);
    const { data, error } = await q;
    if (error) return { ...report, error: error.message };
    const batch = (data ?? []) as Product[];
    trim.push(...batch);
    if (batch.length < PAGE) break;
  }
  report.scanned = trim.length;

  interface Cluster {
    manufacturer: string;
    style: string;
    typeName: string;
    rows: Product[];
  }
  const clusters = new Map<string, Cluster>();
  const bump = (why: string) => {
    report.skipped[why] = (report.skipped[why] ?? 0) + 1;
  };

  // The flooring lines that actually exist and carry colors. A program is only
  // real if a floor we carry sits on that (manufacturer, style) — that IS the
  // premise: the colors come from the floors, so no floor means no colors and
  // the program would generate nothing.
  //
  // This is also the only reliable way to spot a vendor sheet that has dumped
  // colour+type into the `style` column ("Monticello Qtr Round"). A name
  // heuristic can't catch that; asking whether the line exists can.
  const floorLines = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("products")
      .select("manufacturer, style")
      .in("category", FLOORING_CATEGORIES)
      .not("color", "is", null)
      .range(from, from + PAGE - 1);
    if (error) return { ...report, error: error.message };
    const batch = (data ?? []) as { manufacturer: string | null; style: string | null }[];
    for (const r of batch) {
      const m = (r.manufacturer ?? "").trim().toLowerCase();
      const s = (r.style ?? "").trim().toLowerCase();
      if (m && s) floorLines.add(`${m}|${s}`);
    }
    if (batch.length < PAGE) break;
  }

  for (const p of trim) {
    const typeName = parseAccessoryType(p.name);
    if (!typeName) {
      bump("No recognisable accessory type in the name");
      continue;
    }
    const manufacturer = (p.manufacturer ?? "").trim();
    const style = (p.style ?? "").trim();
    if (!manufacturer || styleIsNotALine(style)) {
      bump("No manufacturer / product line to source colors from");
      continue;
    }
    if (isColorPolluted(p.color)) {
      bump("The color field contains the item type (bad import)");
      continue;
    }
    if (!variantKey(p.color)) {
      bump("No color — needs a size, or it is a one-off item");
      continue;
    }
    if (!floorLines.has(`${manufacturer.toLowerCase()}|${style.toLowerCase()}`)) {
      bump(
        "No flooring line by that name — its 'style' isn't a line we carry, so there are no colors to coordinate with",
      );
      continue;
    }
    const key = `${manufacturer}|${style}|${typeName}`;
    const c = clusters.get(key) ?? { manufacturer, style, typeName, rows: [] };
    c.rows.push(p);
    clusters.set(key, c);
  }
  if (!clusters.size) return report;

  // --- Types ---
  const { data: existingTypes } = await db.from("accessory_types").select("*");
  const typeByName = new Map<string, AccessoryType>(
    ((existingTypes ?? []) as AccessoryType[]).map((t) => [t.name.toLowerCase(), t]),
  );
  const wantedTypes = [...new Set([...clusters.values()].map((c) => c.typeName))];
  const newTypes = wantedTypes.filter((n) => !typeByName.has(n.toLowerCase()));
  if (newTypes.length) {
    const base = typeByName.size;
    const rows = newTypes.map((name, i) => {
      // Unit and axis come from what the vendor rows actually SAY, not from a
      // guess about the name. Adoption only ever clusters rows that carry a
      // color, so an adopted type varies by color by definition — letting a name
      // heuristic call it `size` would make the generator ignore the very colors
      // the vendor ships it in.
      const mine = [...clusters.values()].filter((c) => c.typeName === name);
      const units = mine.flatMap((c) =>
        c.rows.map((r) => ((r.unit ?? "").toLowerCase() === "lnft" ? "lnft" : "each")),
      );
      const unit = (units.length ? modal(units) : defaultsForType(name).unit) as AccessoryUnit;
      return {
        name,
        unit,
        axis: "color" as const,
        sizes: [] as string[],
        // Only goods that run along a wall get a stick length; a stair tread is
        // bought one per stair, so a linear-feet conversion would be meaningless.
        piece_length_in:
          unit === "each" && variesByRun(name) ? DEFAULT_PIECE_LENGTH_IN : null,
        default_price: 0,
        sort: (base + i) * 10,
        active: true,
      };
    });
    const { data, error } = await db.from("accessory_types").insert(rows).select("*");
    if (error) return { ...report, error: error.message };
    for (const t of (data ?? []) as AccessoryType[]) typeByName.set(t.name.toLowerCase(), t);
  }
  report.types = wantedTypes.length;

  // --- Programs: one per (manufacturer, line) ---
  const lines = new Map<string, { manufacturer: string; style: string }>();
  for (const c of clusters.values()) {
    lines.set(`${c.manufacturer}|${c.style}`, {
      manufacturer: c.manufacturer,
      style: c.style,
    });
  }
  const { data: existingPrograms } = await db.from("accessory_programs").select("*");
  const progByLine = new Map<string, AccessoryProgram>(
    ((existingPrograms ?? []) as AccessoryProgram[]).map((p) => [
      `${(p.manufacturer ?? "").toLowerCase()}|${(p.style ?? "").toLowerCase()}`,
      p,
    ]),
  );
  const newPrograms = [...lines.values()].filter(
    (l) => !progByLine.has(`${l.manufacturer.toLowerCase()}|${l.style.toLowerCase()}`),
  );
  for (let i = 0; i < newPrograms.length; i += BATCH) {
    const rows = newPrograms.slice(i, i + BATCH).map((l) => ({
      name: `${l.manufacturer} — ${l.style}`,
      manufacturer: l.manufacturer,
      style: l.style,
      color_source: "line",
      manual_colors: [],
      active: true,
    }));
    const { data, error } = await db.from("accessory_programs").insert(rows).select("*");
    if (error) return { ...report, error: error.message };
    for (const p of (data ?? []) as AccessoryProgram[]) {
      progByLine.set(
        `${(p.manufacturer ?? "").toLowerCase()}|${(p.style ?? "").toLowerCase()}`,
        p,
      );
    }
  }
  report.programs = lines.size;

  // --- program × type → the vendor's price (the mode across that line's colors) ---
  const { data: existingPT } = await db.from("accessory_program_types").select("*");
  const ptSeen = new Set(
    ((existingPT ?? []) as AccessoryProgramType[]).map(
      (pt) => `${pt.program_id}|${pt.type_id}`,
    ),
  );
  const ptRows: Record<string, unknown>[] = [];
  const clusterPrice = new Map<string, { price: number; unit: AccessoryUnit }>();

  for (const c of clusters.values()) {
    const program = progByLine.get(
      `${c.manufacturer.toLowerCase()}|${c.style.toLowerCase()}`,
    );
    const type = typeByName.get(c.typeName.toLowerCase());
    if (!program || !type) continue;
    const price = modal(c.rows.map((r) => Number(r.material_rate) || 0));
    const unit = modal(
      c.rows.map((r) => ((r.unit ?? "").toLowerCase() === "lnft" ? "lnft" : "each")),
    ) as AccessoryUnit;
    clusterPrice.set(`${program.id}|${type.id}`, { price, unit });
    if (ptSeen.has(`${program.id}|${type.id}`)) continue;
    ptSeen.add(`${program.id}|${type.id}`);
    ptRows.push({
      program_id: program.id,
      type_id: type.id,
      price,
      unit,
      piece_length_in:
        unit === "each" && variesByRun(c.typeName) ? DEFAULT_PIECE_LENGTH_IN : null,
      active: true,
    });
  }
  for (let i = 0; i < ptRows.length; i += BATCH) {
    const { error } = await db
      .from("accessory_program_types")
      .insert(ptRows.slice(i, i + BATCH));
    if (error) return { ...report, error: error.message };
  }

  // --- Stamp provenance. Nothing else about these rows changes. ---
  for (const c of clusters.values()) {
    const program = progByLine.get(
      `${c.manufacturer.toLowerCase()}|${c.style.toLowerCase()}`,
    );
    const type = typeByName.get(c.typeName.toLowerCase());
    if (!program || !type) continue;
    const base = clusterPrice.get(`${program.id}|${type.id}`);
    // Two vendor rows in one line can share a color (a duplicate import). The
    // unique index would reject the second, so only the first claims the slot —
    // the rest stay unprogrammed and get listed for a human to merge.
    const claimed = new Set<string>();
    for (const p of c.rows) {
      const key = variantKey(p.color);
      if (claimed.has(key)) {
        bump("A duplicate of another item in the same line — merge these by hand");
        continue;
      }
      claimed.add(key);
      const rate = Number(p.material_rate) || 0;
      // Where this color disagrees with its type's price, keep ITS price and
      // record that as a deliberate override — never flatten it to the base.
      const isOverride = !!base && rate !== base.price;
      if (isOverride) report.overrides += 1;
      const { error } = await db
        .from("products")
        .update({
          accessory_program_id: program.id,
          accessory_type_id: type.id,
          accessory_variant: key,
          accessory_origin: "adopted",
          price_override: isOverride ? rate : null,
          piece_length_in:
            (p.unit ?? "").toLowerCase() !== "lnft" && variesByRun(c.typeName)
              ? DEFAULT_PIECE_LENGTH_IN
              : null,
        })
        .eq("id", p.id);
      if (error) return { ...report, error: error.message };
      report.adopted += 1;
    }
  }

  return report;
}

// --- Generation --------------------------------------------------------------

export interface GenerateReport {
  created: number;
  updated: number;
  unchanged: number;
  kept: number; // adopted vendor rows, deliberately left untouched
  retired: number; // generated items whose color left the source line
  error: string | null;
}

/**
 * Generate (or regenerate) every item a program implies.
 *
 * Idempotent by construction: each item is keyed on (program, type, variant) —
 * the same key the database enforces as UNIQUE — so running this twice, or after
 * adding a color, can never double-enter an item. Adding a 4th color creates
 * only that color's items; the other three are recognised and left alone.
 */
export async function generateProgramItems(
  db: Db,
  programId: string,
): Promise<GenerateReport> {
  const out: GenerateReport = {
    created: 0,
    updated: 0,
    unchanged: 0,
    kept: 0,
    retired: 0,
    error: null,
  };

  const { data: prog } = await db
    .from("accessory_programs")
    .select("*")
    .eq("id", programId)
    .maybeSingle();
  const program = prog as AccessoryProgram | null;
  if (!program) return { ...out, error: "Program not found." };

  const [{ data: ptData }, { data: tData }] = await Promise.all([
    db.from("accessory_program_types").select("*").eq("program_id", programId),
    db.from("accessory_types").select("*"),
  ]);
  const typeById = new Map(((tData ?? []) as AccessoryType[]).map((t) => [t.id, t]));
  const programTypes = ((ptData ?? []) as AccessoryProgramType[]).filter(
    (pt) => pt.active && typeById.get(pt.type_id)?.active,
  );

  const colors = await resolveColors(db, program);

  const existing: Product[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("products")
      .select("*")
      .eq("accessory_program_id", programId)
      .range(from, from + PAGE - 1);
    if (error) return { ...out, error: error.message };
    const batch = (data ?? []) as Product[];
    existing.push(...batch);
    if (batch.length < PAGE) break;
  }
  const slot = (typeId: string, variant: string) => `${typeId}|${variant}`;
  const bySlot = new Map(
    existing.map((p) => [slot(p.accessory_type_id ?? "", p.accessory_variant ?? ""), p]),
  );

  const wanted = new Set<string>();
  const inserts: Record<string, unknown>[] = [];

  for (const pt of programTypes) {
    const type = typeById.get(pt.type_id)!;
    const unit = (pt.unit ?? type.unit) as AccessoryUnit;
    const pieceLen =
      unit === "each"
        ? (pt.piece_length_in ?? type.piece_length_in ?? DEFAULT_PIECE_LENGTH_IN)
        : null;

    // The axis decides what this type varies by. A size type never gets a color,
    // which is what stops the generator producing "Baseboard — Gunstock Oak".
    const variants: { key: string; display: string }[] =
      type.axis === "color"
        ? colors.map((c) => ({ key: c.key, display: c.display }))
        : type.axis === "size"
          ? type.sizes.map((s) => ({ key: variantKey(s), display: s }))
          : [{ key: "", display: "" }];

    for (const v of variants) {
      const key = slot(type.id, v.key);
      wanted.add(key);
      const found = bySlot.get(key);
      const name = accessoryItemName({
        manufacturer: program.manufacturer,
        style: program.style,
        typeName: type.name,
        variant: v.display,
      });

      if (!found) {
        inserts.push({
          name,
          category: "trim",
          unit,
          material_rate: pt.price,
          labor_rate: 0,
          manufacturer: program.manufacturer,
          style: program.style,
          color: type.axis === "color" ? v.display : null,
          active: true,
          // 0086 would auto-class a linear-foot item as a roll and then silently
          // never accumulate on_hand from a PO receipt. Trim is counted goods.
          stock_kind: "discrete",
          accessory_program_id: program.id,
          accessory_type_id: type.id,
          accessory_variant: v.key,
          accessory_origin: "generated",
          piece_length_in: pieceLen,
        });
        continue;
      }

      // An adopted vendor row owns its price, name, and SKU. We took it over to
      // LEARN from it, not to overwrite it.
      if (found.accessory_origin === "adopted") {
        out.kept += 1;
        continue;
      }
      // A variant with an explicit override keeps its price; only its label and
      // unit follow the type.
      const nextRate = found.price_override != null ? found.material_rate : pt.price;
      const changed =
        Number(found.material_rate) !== Number(nextRate) ||
        (found.unit ?? "") !== unit ||
        found.name !== name ||
        Number(found.piece_length_in ?? 0) !== Number(pieceLen ?? 0);
      if (!changed) {
        out.unchanged += 1;
        continue;
      }
      const { error } = await db
        .from("products")
        .update({
          name,
          unit,
          material_rate: nextRate,
          piece_length_in: pieceLen,
          stock_kind: "discrete",
        })
        .eq("id", found.id);
      if (error) return { ...out, error: error.message };
      out.updated += 1;
    }
  }

  for (let i = 0; i < inserts.length; i += BATCH) {
    const chunk = inserts.slice(i, i + BATCH);
    const { error } = await db.from("products").insert(chunk);
    if (error) return { ...out, error: error.message };
    out.created += chunk.length;
  }

  // A color that left the source line orphans its generated items. Deactivate —
  // never delete — so any estimate or PO that already used one still resolves.
  // Adopted vendor rows are never retired; they are not ours to retire.
  const orphans = existing.filter(
    (p) =>
      p.accessory_origin === "generated" &&
      p.active &&
      !wanted.has(slot(p.accessory_type_id ?? "", p.accessory_variant ?? "")),
  );
  for (const o of orphans) {
    const { error } = await db.from("products").update({ active: false }).eq("id", o.id);
    if (error) return { ...out, error: error.message };
    out.retired += 1;
  }

  await db
    .from("accessory_programs")
    .update({ last_generated_at: new Date().toISOString() })
    .eq("id", programId);

  return out;
}
