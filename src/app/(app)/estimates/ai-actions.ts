"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { aiText } from "@/lib/ai";
import { searchCatalog } from "@/lib/data/products";
import { getBusinessSettings } from "@/lib/data/business-settings";
import { priceFromMargin } from "@/lib/estimate-calc";

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
export async function draftEstimateFromText(
  customerId: string,
  description: string,
): Promise<DraftQuoteResult> {
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
  redirect(`/estimates/${est.id}/edit`);
}
