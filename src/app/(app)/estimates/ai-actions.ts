"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { aiText } from "@/lib/ai";
import { extractJobFromNotes } from "@/lib/extract";
import { searchCatalog } from "@/lib/data/products";
import { getBusinessSettings } from "@/lib/data/business-settings";
import { priceFromMargin } from "@/lib/estimate-calc";
import { FLOORING_TYPES, profileFor, areaSqft } from "@/lib/flooring-profiles";
import { createSmartEstimate, type SmartLine } from "./smart-actions";

const CATEGORIES = [
  "carpet", "lvp", "hardwood", "laminate", "tile", "vinyl",
  "underlayment", "trim", "labor", "other",
];

interface AiLine {
  room?: string;
  material?: string;
  category?: string;
  sqft?: number;
  description?: string;
}

export interface DraftQuoteResult {
  error: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Map a free-text flooring type onto one of the builder's profile keys. */
function mapFloorType(t: string): string {
  const s = (t || "").toLowerCase();
  if ((FLOORING_TYPES as readonly string[]).includes(s)) return s;
  if (/carpet|broadloom/.test(s)) return "carpet";
  if (/lvp|lvt|spc|wpc|luxury|plank|rigid/.test(s)) return "lvp";
  if (/laminate/.test(s)) return "laminate";
  if (/tile|ceramic|porcelain/.test(s)) return "tile";
  if (/sheet|vinyl/.test(s)) return "vinyl";
  if (/wood|oak|maple|hickory|engineered|solid/.test(s)) return "hardwood";
  return "lvp";
}

/**
 * Turn job notes — typed OR a photo of handwriting — into a real estimate,
 * built EXACTLY the way the smart builder builds it (rooms with ft+in
 * measurements, material priced to the target margin off the catalog, install
 * labor, carpet pad, and the extra add-ons), then open it to continue.
 */
export async function createEstimateFromNotes(
  customerId: string,
  input: { text?: string; storagePath?: string; mime?: string },
): Promise<{ error: string | null }> {
  if (!customerId) return { error: "Missing customer." };

  let opts: Parameters<typeof extractJobFromNotes>[0];
  if (input.storagePath) {
    const supabase = await createClient();
    const { data: signed } = await supabase.storage
      .from("documents")
      .createSignedUrl(input.storagePath, 600);
    if (!signed?.signedUrl) return { error: "Couldn't open that photo." };
    opts = { url: signed.signedUrl, mediaType: input.mime || "image/jpeg" };
  } else if (input.text?.trim()) {
    opts = { text: input.text.trim() };
  } else {
    return { error: "Type the job details or add a photo first." };
  }

  const job = await extractJobFromNotes(opts);
  if (!job || !job.rooms.length) {
    return {
      error:
        "I couldn't read any rooms from that. Add a little more detail (room, size, flooring type) or a clearer photo.",
    };
  }

  const settings = await getBusinessSettings();
  const margin = settings.target_gross_margin_pct || 40;
  const sellAt = (cost: number) => (cost > 0 ? round2(priceFromMargin(cost, margin)) : 0);

  const lines: SmartLine[] = [];
  // Labor is consolidated into ONE installation line per flooring type — never
  // combined with material. Accumulate area + cost across rooms here.
  const laborByCat = new Map<
    string,
    { label: string; unit: string; measureUnit: "sqft" | "sqyd"; area: number; costSum: number }
  >();
  for (const room of job.rooms) {
    const type = mapFloorType(room.type);
    const profile = profileFor(type);
    if (!profile) continue;

    const lenIn = Math.round(room.length_ft * 12 + room.length_in);
    const widIn = Math.round(room.width_ft * 12 + room.width_in);
    const sqft =
      room.sqft && room.sqft > 0
        ? room.sqft
        : lenIn > 0 && widIn > 0
          ? areaSqft(lenIn / 12, widIn / 12)
          : 0;
    const isYd = profile.unit === "sqyd";
    const qty = round2(isYd ? sqft / 9 : sqft);
    const unit = isYd ? "sq yd" : "sq ft";

    // Material cost: from the notes if written, else matched off the catalog.
    let cost = Number(room.material_cost) || 0;
    let productId: string | null = null;
    let manufacturer: string | null = null;
    let style: string | null = null;
    let color: string | null = null;
    let laborRate = 0;
    if (room.material) {
      try {
        const hits = await searchCatalog(room.material, { activeOnly: true, limit: 5 });
        const match = hits.find((p) => p.category === profile.category) ?? hits[0] ?? null;
        if (match) {
          productId = match.id;
          if (!cost) cost = Number(match.material_rate) || 0;
          laborRate = Number(match.labor_rate) || 0;
          manufacturer = match.manufacturer;
          style = match.style;
          color = match.color;
        }
      } catch {
        /* no catalog match — price it in the builder */
      }
    }

    // MATERIAL line — the quantity is what you actually order: area + waste,
    // rounded up to whole units. No hidden waste % (it's in the quantity).
    const matQty = isYd
      ? Math.ceil((sqft / 9) * (1 + profile.waste / 100))
      : Math.ceil(sqft * (1 + profile.waste / 100));
    lines.push({
      room: room.name || null,
      description:
        [manufacturer, room.material].filter(Boolean).join(" ").trim() || profile.label,
      category: profile.category,
      measure_unit: profile.unit,
      sqft: null,
      quantity: matQty > 0 ? matQty : null,
      // Keep the room cut size for the PO, even though the line bills by quantity.
      length_in: lenIn > 0 ? lenIn : null,
      width_in: widIn > 0 ? widIn : null,
      unit,
      material_rate: sellAt(cost),
      labor_rate: 0,
      material_cost: cost,
      labor_cost: 0,
      waste_pct: 0,
      product_id: productId,
      manufacturer,
      style,
      color,
    });

    // PAD — its own line, in square yards (rounded up), priced if a pad price
    // was written.
    if (profile.category === "carpet" && room.pad) {
      const padYd = Math.ceil(sqft / 9);
      const padCost = Number(room.pad_cost) || 0;
      lines.push({
        room: room.name || null,
        description: "Carpet pad",
        category: "underlayment",
        measure_unit: "sqyd",
        sqft: null,
        quantity: padYd > 0 ? padYd : null,
        length_in: null,
        width_in: null,
        unit: "sq yd",
        material_rate: sellAt(padCost),
        labor_rate: 0,
        material_cost: padCost,
        labor_cost: 0,
        waste_pct: 0,
        product_id: null,
        manufacturer: null,
        style: null,
        color: null,
      });
    }

    // LABOR — accumulate (actual area, no material waste) into one line per type.
    // Use a written install price if there is one, else the catalog labor rate.
    if (room.install && qty > 0) {
      const roomLaborCost = Number(room.labor_cost) > 0 ? Number(room.labor_cost) : laborRate;
      const e =
        laborByCat.get(profile.category) ?? {
          label: profile.label,
          unit,
          measureUnit: profile.unit,
          area: 0,
          costSum: 0,
        };
      e.area += qty;
      e.costSum += qty * roomLaborCost;
      laborByCat.set(profile.category, e);
    }
  }

  // One installation/labor line per flooring type (material & labor never mixed).
  for (const e of laborByCat.values()) {
    const area = round2(e.area);
    if (area <= 0) continue;
    const unitCost = e.area > 0 ? round2(e.costSum / e.area) : 0;
    lines.push({
      room: null,
      description: `Installation — ${e.label.toLowerCase()}`,
      category: "labor",
      measure_unit: e.measureUnit,
      sqft: null,
      quantity: area,
      length_in: null,
      width_in: null,
      unit: e.unit,
      material_rate: 0,
      labor_rate: sellAt(unitCost),
      material_cost: 0,
      labor_cost: unitCost,
      waste_pct: 0,
      product_id: null,
      manufacturer: null,
      style: null,
      color: null,
    });
  }

  // Job-wide extras (tear-out, transitions, stairs, metals…).
  for (const a of job.addons ?? []) {
    if (!a.label) continue;
    const cost = Number(a.cost) || 0;
    lines.push({
      room: null,
      description: a.label,
      category: a.labor ? "labor" : "other",
      measure_unit: "sqft",
      sqft: null,
      quantity: a.qty && a.qty > 0 ? a.qty : 1,
      length_in: null,
      width_in: null,
      unit: a.unit || "each",
      material_rate: a.labor ? 0 : sellAt(cost),
      labor_rate: a.labor ? sellAt(cost) : 0,
      material_cost: a.labor ? 0 : cost,
      labor_cost: a.labor ? cost : 0,
      waste_pct: 0,
      product_id: null,
      manufacturer: null,
      style: null,
      color: null,
    });
  }

  if (!lines.length) return { error: "Couldn't build any lines from that." };

  // Saves through the SAME pipeline as the smart builder, then opens the editor
  // to review and continue (createSmartEstimate redirects on success).
  return createSmartEstimate({
    customerId,
    title: job.title || "Flooring estimate",
    taxRate: 8,
    lines,
    presentation: "detailed",
  });
}

export interface ScopeLine {
  room?: string | null;
  description: string;
  quantity?: number | null;
  unit?: string | null;
}

/**
 * Write a detailed, customer-facing scope-of-work description from the line
 * items on an estimate or invoice. Returns the text for the builder to drop into
 * the description/notes field (nothing is saved here).
 */
export async function writeScopeDescription(input: {
  kind: "estimate" | "invoice";
  lines: ScopeLine[];
}): Promise<{ text: string; error: string | null }> {
  const items = (input.lines ?? [])
    .filter((l) => l.description?.trim())
    .map((l) => {
      const qty =
        l.quantity && l.quantity > 0
          ? ` (${Math.round(l.quantity * 100) / 100} ${l.unit || ""})`.trimEnd()
          : "";
      return `- ${l.room ? `${l.room}: ` : ""}${l.description.trim()}${qty}`;
    })
    .join("\n");
  if (!items) return { text: "", error: "Add some line items first." };

  return aiText({
    temperature: 0.8,
    system: `You're the owner of Cleveland Floor King — an experienced flooring pro — writing the scope of work on a customer's ${input.kind}. Write it the way you'd actually talk to a homeowner in their living room: warm, plain-spoken, and confident. They should feel like a real person who's done this a thousand times is taking care of them.

Voice & style:
- Write in flowing sentences and short natural paragraphs, NOT a bulleted parts list. Group the work by room or area so it reads like a walkthrough of the project.
- Use everyday language and contractions ("we'll", "you'll"). Address them as "you." Refer to your crew as "we" / "our team."
- Keep all the DETAIL — the materials, rooms, square footage, and what's included (tear-out and haul-away of the old floor, prepping the subfloor, the install itself, new pad, transitions and trim, moving furniture, cleanup) wherever the line items imply it — but say it like a person, not a spec sheet.
- A little reassurance is good (protecting their home, leaving it clean, doing it right). Don't be salesy or flowery, and don't overpromise.

Hard rules: base everything ONLY on the line items given — never invent prices, brand names, or details that aren't there. No greeting line, no sign-off, no dollar amounts. Just the description itself.`,
    maxTokens: 900,
    prompt: `Here are the line items for this job:\n${items}\n\nWrite the scope of work.`,
  });
}

/**
 * Turn a plain-English job description into a draft estimate: AI parses the
 * rooms/materials/areas, we match each to a catalog product and price it to the
 * target margin, then open the quote builder to review.
 */
export async function createDraftEstimateFromText(
  customerId: string,
  description: string,
): Promise<{ error: string | null; estimateId?: string }> {
  const desc = (description ?? "").trim();
  if (!customerId || desc.length < 4)
    return { error: "Describe the job first." };

  const { text, error } = await aiText({
    system: `You are a flooring estimator for Cleveland Floor King. Turn the job description into structured line items. Reply with ONLY JSON, no prose:
{"title": string, "lines": [{"room": string, "material": string, "category": one of [${CATEGORIES.join(", ")}], "sqft": number, "description": string}]}
Rules: one line per room/material. "material" is a short product term to search the catalog (e.g. "plush carpet", "luxury vinyl plank", "oak hardwood"). Estimate sqft if a size is given; if no size, make a reasonable guess and note it. Keep descriptions short.`,
    maxTokens: 1500,
    prompt: `Job description:\n${desc}`,
  });
  if (error) return { error };

  let parsed: { title?: string; lines?: AiLine[] };
  try {
    const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const s = cleaned.indexOf("{");
    const e = cleaned.lastIndexOf("}");
    parsed = JSON.parse(cleaned.slice(s, e + 1));
  } catch {
    return { error: "Couldn't read the AI's draft. Try rephrasing the job." };
  }
  const lines = (parsed.lines ?? []).filter((l) => l && (l.material || l.room));
  if (!lines.length) return { error: "No rooms/materials found in that description." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const settings = await getBusinessSettings();
  const margin = settings.target_gross_margin_pct || 40;

  // Create the estimate + a single option.
  const { data: est, error: estErr } = await supabase
    .from("estimates")
    .insert({
      customer_id: customerId,
      title: parsed.title || "Flooring estimate",
      status: "draft",
      tax_rate: 8.0,
      presentation: "detailed",
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();
  if (estErr || !est) return { error: estErr?.message || "Couldn't create the estimate." };

  const { data: opt } = await supabase
    .from("estimate_options")
    .insert({ estimate_id: est.id, name: "Option A", position: 0 })
    .select("id")
    .single();
  if (!opt) return { error: "Couldn't create the estimate option." };

  // Build line items, matching each to a catalog product for pricing.
  const rows = [];
  let i = 0;
  for (const l of lines) {
    const category = CATEGORIES.includes(l.category ?? "") ? l.category! : "other";
    const term = (l.material || category).trim();
    let productId: string | null = null;
    let cost = 0;
    let manufacturer: string | null = null;
    let style: string | null = null;
    let color: string | null = null;
    let labor = 0;
    try {
      const hits = await searchCatalog(term, { activeOnly: true, limit: 5 });
      const match =
        hits.find((p) => p.category === category) ?? hits[0] ?? null;
      if (match) {
        productId = match.id;
        cost = Number(match.material_rate) || 0;
        labor = Number(match.labor_rate) || 0;
        manufacturer = match.manufacturer;
        style = match.style;
        color = match.color;
      }
    } catch {
      /* no match — leave blank for manual pricing */
    }
    const sell = cost > 0 ? Math.round(priceFromMargin(cost, margin) * 100) / 100 : 0;
    rows.push({
      option_id: opt.id,
      position: i++,
      room: l.room || null,
      description: l.description || term,
      line_type: "mat_labor",
      sqft: typeof l.sqft === "number" && l.sqft > 0 ? l.sqft : null,
      measure_unit: "sqft",
      material_rate: sell,
      labor_rate: labor,
      material_cost: cost,
      labor_cost: 0,
      product_id: productId,
      manufacturer,
      style,
      color,
      category,
      unit: "sqft",
    });
  }
  await supabase.from("estimate_line_items").insert(rows);

  revalidatePath(`/customers/${customerId}`);
  return { error: null, estimateId: est.id as string };
}

/**
 * UI entry point: build the draft from text, then open the builder. Thin
 * wrapper over createDraftEstimateFromText so other callers (e.g. the field
 * assistant) can get the new estimate's id without a redirect.
 */
export async function draftEstimateFromText(
  customerId: string,
  description: string,
): Promise<DraftQuoteResult> {
  const res = await createDraftEstimateFromText(customerId, description);
  if (res.error) return { error: res.error };
  redirect(`/estimates/${res.estimateId}/edit`);
}
