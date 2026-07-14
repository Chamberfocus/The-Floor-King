import { createClient } from "@/lib/supabase/server";
import {
  isColorPolluted,
  parseAccessoryType,
  styleIsNotALine,
  variantKey,
} from "@/lib/accessories";
import { resolveColors, type ResolvedColor } from "@/lib/accessory-engine";
import type {
  AccessoryProgram,
  AccessoryProgramType,
  AccessoryType,
  Product,
} from "@/lib/types";

export type { ResolvedColor };

const PAGE = 1000; // Supabase caps a single request at 1000 rows.

export async function listAccessoryTypes(): Promise<AccessoryType[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accessory_types")
    .select("*")
    .order("sort", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as AccessoryType[];
}

export async function listAccessoryPrograms(): Promise<AccessoryProgram[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accessory_programs")
    .select("*")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as AccessoryProgram[];
}

export async function listProgramTypes(): Promise<AccessoryProgramType[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accessory_program_types")
    .select("*");
  if (error) throw error;
  return (data ?? []) as AccessoryProgramType[];
}

/**
 * The colors a program generates against, read LIVE from the flooring products.
 * Delegates to the engine so the server and the generator resolve colors through
 * exactly the same code — two implementations would eventually disagree, and a
 * disagreement here silently changes which items exist.
 */
export async function resolveProgramColors(
  program: Pick<
    AccessoryProgram,
    "manufacturer" | "style" | "color_source" | "manual_colors"
  >,
): Promise<ResolvedColor[]> {
  return resolveColors(await createClient(), program);
}

/** Every catalog item a program currently owns. */
export async function listProgramItems(programId: string): Promise<Product[]> {
  const supabase = await createClient();
  const all: Product[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("accessory_program_id", programId)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = (data ?? []) as Product[];
    all.push(...batch);
    if (batch.length < PAGE) break;
  }
  return all;
}

export interface ProgramSummary {
  program: AccessoryProgram;
  types: (AccessoryProgramType & { type: AccessoryType })[];
  colors: ResolvedColor[];
  itemCount: number; // items that exist today
  expected: number; // items the current setup implies
  missing: number; // colors added since the last generate → nothing orphaned, just new
  adopted: number; // vendor rows we took over (never re-priced)
}

/**
 * Everything the settings screen needs, in one pass. `missing` is the drift
 * signal: it is what "add a color and its items appear" looks like before you
 * press the button.
 */
export async function programSummaries(): Promise<ProgramSummary[]> {
  const [programs, types, programTypes] = await Promise.all([
    listAccessoryPrograms(),
    listAccessoryTypes(),
    listProgramTypes(),
  ]);
  const typeById = new Map(types.map((t) => [t.id, t]));

  const supabase = await createClient();
  const counts = new Map<string, { total: number; adopted: number }>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("products")
      .select("accessory_program_id, accessory_origin")
      .not("accessory_program_id", "is", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = (data ?? []) as {
      accessory_program_id: string;
      accessory_origin: string | null;
    }[];
    for (const r of batch) {
      const c = counts.get(r.accessory_program_id) ?? { total: 0, adopted: 0 };
      c.total += 1;
      if (r.accessory_origin === "adopted") c.adopted += 1;
      counts.set(r.accessory_program_id, c);
    }
    if (batch.length < PAGE) break;
  }

  const out: ProgramSummary[] = [];
  for (const program of programs) {
    const mine = programTypes
      .filter((pt) => pt.program_id === program.id && pt.active)
      .map((pt) => ({ ...pt, type: typeById.get(pt.type_id)! }))
      .filter((pt) => pt.type && pt.type.active)
      .sort((a, b) => a.type.sort - b.type.sort || a.type.name.localeCompare(b.type.name));
    const colors = await resolveProgramColors(program);
    // Each type contributes as many items as its own axis implies — a color type
    // spans the line's colors, a size type spans its sizes, `none` is one item.
    const expected = mine.reduce((sum, pt) => {
      if (pt.type.axis === "color") return sum + colors.length;
      if (pt.type.axis === "size") return sum + Math.max(pt.type.sizes.length, 1);
      return sum + 1;
    }, 0);
    const c = counts.get(program.id) ?? { total: 0, adopted: 0 };
    out.push({
      program,
      types: mine,
      colors,
      itemCount: c.total,
      expected,
      missing: Math.max(expected - c.total, 0),
      adopted: c.adopted,
    });
  }
  return out;
}

export interface UnprogrammedRow {
  product: Product;
  reason: string;
}

/**
 * Trim items that are NOT in a program, with the reason. These stay exactly as
 * they are — real, searchable, orderable products — but they are listed so that
 * nothing is silently dropped on the floor.
 */
export async function listUnprogrammed(): Promise<UnprogrammedRow[]> {
  const supabase = await createClient();
  const all: Product[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("category", "trim")
      .is("accessory_program_id", null)
      .order("manufacturer", { ascending: true })
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = (data ?? []) as Product[];
    all.push(...batch);
    if (batch.length < PAGE) break;
  }
  return all.map((product) => ({ product, reason: unprogrammedReason(product) }));
}

function unprogrammedReason(p: Product): string {
  if (!parseAccessoryType(p.name)) return "No recognisable accessory type in the name";
  if (isColorPolluted(p.color)) return "The color field contains the item type (bad import)";
  if (!p.manufacturer?.trim() || styleIsNotALine(p.style))
    return "No manufacturer / product line to source colors from";
  if (!variantKey(p.color)) return "No color — needs a size, or it is a one-off item";
  return "Not yet adopted into a program";
}
