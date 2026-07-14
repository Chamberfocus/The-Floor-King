"use server";

import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_PIECE_LENGTH_IN } from "@/lib/accessories";
// A "use server" module may only export async functions — types are re-exported
// from @/lib/accessory-engine, never from here.
import {
  adoptTrim,
  generateProgramItems,
  type AdoptReport,
  type GenerateReport,
} from "@/lib/accessory-engine";

function money(v: FormDataEntryValue | null): number {
  const n = parseFloat(typeof v === "string" ? v.replace(/[^0-9.]/g, "") : "");
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

// --- Adoption & generation (the engine does the work) ------------------------

/**
 * Adopt the vendor trim already in the catalog. Pass `manufacturers` to scope the
 * pass to a few brands — the derivation should be reviewed on brands you know
 * before it is trusted across the whole catalog.
 */
export async function adoptExistingTrim(
  manufacturers?: string[],
): Promise<AdoptReport> {
  await assertRole(["admin", "office"]);
  const report = await adoptTrim(createAdminClient(), { manufacturers });
  revalidatePath("/settings/accessories");
  revalidatePath("/catalog");
  return report;
}

export async function generateProgram(programId: string): Promise<GenerateReport> {
  await assertRole(["admin", "office"]);
  const report = await generateProgramItems(createAdminClient(), programId);
  revalidatePath("/settings/accessories");
  revalidatePath("/catalog");
  return report;
}

/** Regenerate every active program — use after adding a flooring color. */
export async function regenerateAll(): Promise<GenerateReport> {
  await assertRole(["admin", "office"]);
  const admin = createAdminClient();
  const { data } = await admin
    .from("accessory_programs")
    .select("id")
    .eq("active", true);
  const total: GenerateReport = {
    created: 0,
    updated: 0,
    unchanged: 0,
    kept: 0,
    retired: 0,
    error: null,
  };
  for (const p of (data ?? []) as { id: string }[]) {
    const r = await generateProgramItems(admin, p.id);
    if (r.error) return { ...total, error: r.error };
    total.created += r.created;
    total.updated += r.updated;
    total.unchanged += r.unchanged;
    total.kept += r.kept;
    total.retired += r.retired;
  }
  revalidatePath("/settings/accessories");
  revalidatePath("/catalog");
  return total;
}

/** Manufacturers that still have unadopted trim, biggest first. */
export async function unadoptedManufacturers(): Promise<
  { manufacturer: string; rows: number }[]
> {
  await assertRole(["admin", "office"]);
  const admin = createAdminClient();
  const counts = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data } = await admin
      .from("products")
      .select("manufacturer")
      .eq("category", "trim")
      .is("accessory_program_id", null)
      .not("manufacturer", "is", null)
      .range(from, from + 999);
    const batch = (data ?? []) as { manufacturer: string | null }[];
    for (const r of batch) {
      const m = (r.manufacturer ?? "").trim();
      if (m) counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    if (batch.length < 1000) break;
  }
  return [...counts.entries()]
    .map(([manufacturer, rows]) => ({ manufacturer, rows }))
    .sort((a, b) => b.rows - a.rows);
}

// --- CRUD — types, programs, and the per-program prices ----------------------

export async function saveAccessoryType(
  formData: FormData,
): Promise<{ error: string | null }> {
  await assertRole(["admin", "office"]);
  const supabase = await createClient();
  const id = str(formData.get("id"));
  const name = str(formData.get("name"));
  if (!name) return { error: "A name is required." };
  const unit = str(formData.get("unit")) === "lnft" ? "lnft" : "each";
  const axisRaw = str(formData.get("axis"));
  const axis = axisRaw === "size" || axisRaw === "none" ? axisRaw : "color";
  const sizes = str(formData.get("sizes"))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const pieceLen = parseFloat(str(formData.get("piece_length_in")));

  const row = {
    name,
    unit,
    axis,
    sizes: axis === "size" ? sizes : [],
    piece_length_in:
      unit === "each"
        ? Number.isFinite(pieceLen) && pieceLen > 0
          ? pieceLen
          : DEFAULT_PIECE_LENGTH_IN
        : null,
    default_price: money(formData.get("default_price")),
    sort: parseInt(str(formData.get("sort")), 10) || 0,
    active: formData.get("active") !== null,
  };
  const { error } = id
    ? await supabase.from("accessory_types").update(row).eq("id", id)
    : await supabase.from("accessory_types").insert(row);
  if (error) return { error: error.message };
  revalidatePath("/settings/accessories");
  return { error: null };
}

/**
 * Deleting a type must not orphan the items it generated. The FK is ON DELETE
 * SET NULL, which would strand them with no way back — so we deactivate the type
 * and retire its generated items instead, leaving adopted vendor rows alone.
 */
export async function deleteAccessoryType(
  id: string,
): Promise<{ error: string | null }> {
  await assertRole(["admin", "office"]);
  const admin = createAdminClient();
  const { error: e1 } = await admin
    .from("products")
    .update({ active: false })
    .eq("accessory_type_id", id)
    .eq("accessory_origin", "generated");
  if (e1) return { error: e1.message };
  const { error } = await admin
    .from("accessory_types")
    .update({ active: false })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/settings/accessories");
  revalidatePath("/catalog");
  return { error: null };
}

export async function saveProgram(
  formData: FormData,
): Promise<{ error: string | null }> {
  await assertRole(["admin", "office"]);
  const supabase = await createClient();
  const id = str(formData.get("id"));
  const manufacturer = str(formData.get("manufacturer"));
  const style = str(formData.get("style"));
  const sourceRaw = str(formData.get("color_source"));
  const color_source =
    sourceRaw === "manufacturer" || sourceRaw === "manual" ? sourceRaw : "line";
  if (color_source !== "manual" && !manufacturer) {
    return { error: "Pick a manufacturer — that's where the colors come from." };
  }
  const name =
    str(formData.get("name")) ||
    [manufacturer, style].filter(Boolean).join(" — ") ||
    "Accessory program";
  const row = {
    name,
    manufacturer: manufacturer || null,
    style: color_source === "line" ? style || null : null,
    color_source,
    manual_colors:
      color_source === "manual"
        ? str(formData.get("manual_colors"))
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    active: formData.get("active") !== null,
  };
  const { error } = id
    ? await supabase.from("accessory_programs").update(row).eq("id", id)
    : await supabase.from("accessory_programs").insert(row);
  if (error) {
    return {
      error: error.message.includes("accessory_programs_line_uniq")
        ? "A program already exists for that manufacturer and line."
        : error.message,
    };
  }
  revalidatePath("/settings/accessories");
  return { error: null };
}

/** Set the price of one type within one program — every color inherits it. */
export async function saveProgramType(
  formData: FormData,
): Promise<{ error: string | null }> {
  await assertRole(["admin", "office"]);
  const supabase = await createClient();
  const program_id = str(formData.get("program_id"));
  const type_id = str(formData.get("type_id"));
  if (!program_id || !type_id) return { error: "Missing program or type." };
  const on = formData.get("on") !== null;
  if (!on) {
    const { error } = await supabase
      .from("accessory_program_types")
      .update({ active: false })
      .eq("program_id", program_id)
      .eq("type_id", type_id);
    if (error) return { error: error.message };
    revalidatePath("/settings/accessories");
    return { error: null };
  }
  const unitRaw = str(formData.get("unit"));
  const unit = unitRaw === "lnft" ? "lnft" : unitRaw === "each" ? "each" : null;
  const pieceLen = parseFloat(str(formData.get("piece_length_in")));
  const { error } = await supabase.from("accessory_program_types").upsert(
    {
      program_id,
      type_id,
      price: money(formData.get("price")),
      unit,
      piece_length_in:
        unit === "each" && Number.isFinite(pieceLen) && pieceLen > 0
          ? pieceLen
          : null,
      active: true,
    },
    { onConflict: "program_id,type_id" },
  );
  if (error) return { error: error.message };
  revalidatePath("/settings/accessories");
  return { error: null };
}

/** Clear a variant's price override so it falls back to its type's price. */
export async function clearPriceOverride(
  productId: string,
): Promise<{ error: string | null }> {
  await assertRole(["admin", "office"]);
  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update({ price_override: null })
    .eq("id", productId);
  if (error) return { error: error.message };
  revalidatePath("/settings/accessories");
  return { error: null };
}
