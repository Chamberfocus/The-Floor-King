"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertRole } from "@/lib/auth";
import { resolveOrCreateCustomer } from "@/lib/data/customer-resolve";
import type { ScoredCustomerMatch } from "@/lib/customer-resolve";

const OFFICE = ["admin", "office", "sales_manager", "salesman"] as const;

export interface QuickEstimateLine {
  description: string;
  quantity: string | number;
  unit: string;
  /** Sell price per unit. */
  rate: string | number;
  /** Our cost per unit, so the margin is real from the start. */
  cost?: string | number | null;
  productId?: string | null;
  category?: string | null;
}

export interface QuickEstimateInput {
  customerId: string | null;
  newCustomer: { full_name: string; phone: string; email: string } | null;
  useExistingId?: string | null;
  forceCreate?: boolean;
  overrideReason?: string | null;
  title: string;
  lines: QuickEstimateLine[];
  taxRate: string | number;
  notes: string;
  /** Send it straight away rather than leaving it as a draft. */
  markSent: boolean;
}

const n = (v: string | number | null | undefined): number => {
  if (v === null || v === undefined || v === "") return 0;
  const x = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(x) ? x : 0;
};

/**
 * A short estimate without the questionnaire.
 *
 * The guided flow is right for a full flooring job — rooms, prep, trims, the
 * lot. It is far too much for "two rooms of vinyl, here's the number", which is
 * how a good share of quotes actually go out. Same records, same builder
 * afterwards; just a faster way in.
 */
export async function createQuickEstimate(input: QuickEstimateInput): Promise<{
  error: string | null;
  estimateId?: string;
  matches?: ScoredCustomerMatch[];
}> {
  await assertRole([...OFFICE]);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const lines = input.lines.filter(
    (l) => l.description.trim() !== "" && n(l.quantity) > 0,
  );
  if (!lines.length) return { error: "Add at least one line." };

  let customerId = input.customerId;
  if (!customerId) {
    const name = input.newCustomer?.full_name.trim();
    if (!name) return { error: "Pick a customer, or type a name for a new one." };
    const resolved = await resolveOrCreateCustomer({
      input: {
        fullName: name,
        phone: input.newCustomer?.phone.trim() || null,
        email: input.newCustomer?.email.trim() || null,
      },
      insert: {
        full_name: name,
        phone: input.newCustomer?.phone.trim() || null,
        email: input.newCustomer?.email.trim() || null,
        stage: "quoted",
        created_by: user?.id ?? null,
      },
      useExistingId: input.useExistingId,
      forceCreate: input.forceCreate,
      overrideReason: input.overrideReason,
    });
    if (resolved.action === "needs_choice") {
      return { error: null, matches: resolved.matches };
    }
    if (resolved.action === "error") return { error: resolved.error };
    customerId = resolved.customerId;
  }

  const { data: estimate, error } = await supabase
    .from("estimates")
    .insert({
      customer_id: customerId,
      title: input.title.trim() || "Estimate",
      status: input.markSent ? "sent" : "draft",
      sent_at: input.markSent ? new Date().toISOString() : null,
      presentation: "detailed",
      tax_rate: n(input.taxRate),
      discount_kind: "amount",
      discount_value: 0,
      notes: input.notes.trim() || null,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();
  if (error || !estimate) return { error: "Couldn't create the estimate." };

  const { data: option, error: optErr } = await supabase
    .from("estimate_options")
    .insert({ estimate_id: estimate.id, name: "Option A", position: 0 })
    .select("id")
    .single();
  if (optErr || !option) return { error: "Couldn't create the option." };

  const { error: lineErr } = await supabase.from("estimate_line_items").insert(
    lines.map((l, i) => ({
      option_id: option.id,
      position: i,
      description: l.description.trim(),
      // Count units price by quantity; area units price by measured area. The
      // shared calc reads the UNIT to decide, so it has to be carried.
      unit: l.unit || "each",
      quantity: n(l.quantity),
      line_type: "mat_labor" as const,
      measure_unit: "sqft" as const,
      material_rate: n(l.rate),
      material_cost: n(l.cost),
      labor_rate: 0,
      labor_cost: 0,
      waste_pct: 0,
      product_id: l.productId ?? null,
      category: l.category ?? null,
    })),
  );
  if (lineErr) return { error: "Couldn't save the lines." };

  revalidatePath("/estimates");
  revalidatePath(`/customers/${customerId}`);
  return { error: null, estimateId: estimate.id as string };
}
