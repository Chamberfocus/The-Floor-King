"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assertRole } from "@/lib/auth";
import { employeeDbError } from "@/lib/employee-error";
import {
  scoreCustomerDuplicate,
  type DuplicateConfidence,
  type DuplicateReason,
} from "@/lib/customer-duplicate";

export type SafeDuplicateMatch = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  street: string | null;
  reason: DuplicateReason;
  confidence: DuplicateConfidence;
};

export type SafeCustomerFormState = {
  error: string | null;
  duplicates?: SafeDuplicateMatch[];
};

export type SafeLeadSourceDetail = {
  id: string;
  source_id: string;
  label: string;
  position: number;
};

export type SafeLeadSource = {
  id: string;
  key: string | null;
  label: string;
  position: number;
  detail_mode: "none" | "options" | "referrer";
  detail_label: string | null;
  detail_required: boolean;
  details: SafeLeadSourceDetail[];
};

export type SafeFormOptions = {
  sources: SafeLeadSource[];
  referrers: { id: string; full_name: string }[];
};

const LEGACY_ENUM = new Set([
  "referral",
  "google",
  "website",
  "angi",
  "facebook",
  "repeat",
  "walk_in",
  "other",
]);

const ALLOWED_STAGES = new Set([
  "new",
  "contacted",
  "estimate_scheduled",
  "quoted",
  "won",
  "lost",
]);

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
function nullable(v: FormDataEntryValue | null): string | null {
  return str(v) || null;
}

export async function loadSafeCustomerOptions(): Promise<SafeFormOptions> {
  try {
    await assertRole(["admin", "office", "sales_manager", "salesman", "scheduler"]);
    const supabase = await createClient();

    const [{ data: sourceRows }, { data: refRows }] = await Promise.all([
      supabase
        .from("lead_sources")
        .select("id, key, label, position, detail_mode, detail_label, detail_required, active")
        .eq("active", true)
        .order("position"),
      supabase
        .from("customers")
        .select("id, full_name")
        .is("cancelled_at", null)
        .order("full_name")
        .limit(250),
    ]);

    const ids = (sourceRows ?? []).map((s) => s.id as string);
    let detailRows: SafeLeadSourceDetail[] = [];
    if (ids.length) {
      const { data } = await supabase
        .from("lead_source_details")
        .select("id, source_id, label, position, active")
        .in("source_id", ids)
        .eq("active", true)
        .order("position");
      detailRows = (data ?? []).map((d) => ({
        id: String(d.id),
        source_id: String(d.source_id),
        label: String(d.label ?? ""),
        position: Number(d.position ?? 0),
      }));
    }

    const sources: SafeLeadSource[] = (sourceRows ?? []).map((s) => ({
      id: String(s.id),
      key: typeof s.key === "string" ? s.key : null,
      label: String(s.label ?? ""),
      position: Number(s.position ?? 0),
      detail_mode:
        s.detail_mode === "options" || s.detail_mode === "referrer"
          ? s.detail_mode
          : "none",
      detail_label: typeof s.detail_label === "string" ? s.detail_label : null,
      detail_required: Boolean(s.detail_required),
      details: detailRows.filter((d) => d.source_id === s.id),
    }));

    const referrers = (refRows ?? [])
      .filter((r) => typeof r.id === "string")
      .map((r) => ({
        id: String(r.id),
        full_name: typeof r.full_name === "string" ? r.full_name : "Customer",
      }));

    return { sources, referrers };
  } catch {
    return { sources: [], referrers: [] };
  }
}

async function duplicateMatches(args: {
  fullName: string;
  email: string | null;
  phone: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}): Promise<SafeDuplicateMatch[]> {
  const supabase = await createClient();
  const rows = new Map<string, Record<string, unknown>>();
  const add = (data: Record<string, unknown>[] | null) => {
    for (const row of data ?? []) {
      if (typeof row.id === "string") rows.set(row.id, row);
    }
  };

  if (args.email) {
    const { data } = await supabase
      .from("customers")
      .select("id, full_name, email, phone, street, city, state, zip")
      .ilike("email", args.email)
      .limit(20);
    add((data ?? []) as Record<string, unknown>[]);
  }

  const digits = (args.phone ?? "").replace(/\D/g, "");
  if (digits.length >= 4) {
    const { data } = await supabase
      .from("customers")
      .select("id, full_name, email, phone, street, city, state, zip")
      .ilike("phone", `%${digits.slice(-4)}%`)
      .limit(50);
    add((data ?? []) as Record<string, unknown>[]);
  }

  if (args.fullName) {
    const { data } = await supabase
      .from("customers")
      .select("id, full_name, email, phone, street, city, state, zip")
      .ilike("full_name", args.fullName)
      .limit(25);
    add((data ?? []) as Record<string, unknown>[]);
  }

  const matches: SafeDuplicateMatch[] = [];
  for (const row of rows.values()) {
    const score = scoreCustomerDuplicate(
      {
        fullName: args.fullName,
        email: args.email,
        phone: args.phone,
        address: args.street,
        city: args.city,
        state: args.state,
        zip: args.zip,
      },
      {
        id: String(row.id),
        full_name: typeof row.full_name === "string" ? row.full_name : "",
        email: typeof row.email === "string" ? row.email : null,
        phone: typeof row.phone === "string" ? row.phone : null,
        address: typeof row.street === "string" ? row.street : null,
        city: typeof row.city === "string" ? row.city : null,
        state: typeof row.state === "string" ? row.state : null,
        zip: typeof row.zip === "string" ? row.zip : null,
      },
    );
    if (!score) continue;
    matches.push({
      id: String(row.id),
      full_name: typeof row.full_name === "string" ? row.full_name : "Customer",
      email: typeof row.email === "string" ? row.email : null,
      phone: typeof row.phone === "string" ? row.phone : null,
      city: typeof row.city === "string" ? row.city : null,
      street: typeof row.street === "string" ? row.street : null,
      reason: score.reason,
      confidence: score.confidence,
    });
  }

  return matches.sort((a, b) =>
    a.confidence === b.confidence ? 0 : a.confidence === "high" ? -1 : 1,
  );
}

export async function createCustomerSafe(
  _prev: SafeCustomerFormState,
  formData: FormData,
): Promise<SafeCustomerFormState> {
  const profile = await assertRole(["admin", "office", "sales_manager", "salesman", "scheduler"]);

  const full_name = str(formData.get("full_name"));
  if (!full_name) return { error: "A name is required." };

  const source_id = nullable(formData.get("source_id"));
  if (!source_id) return { error: "Please choose where this lead came from." };

  const company = nullable(formData.get("company"));
  const email = nullable(formData.get("email"));
  const phone = nullable(formData.get("phone"));
  const street = nullable(formData.get("street"));
  const city = nullable(formData.get("city"));
  const state = nullable(formData.get("state"));
  const zip = nullable(formData.get("zip"));
  const notes = nullable(formData.get("notes"));
  const source_detail_id = nullable(formData.get("source_detail_id"));
  const source_detail_text = nullable(formData.get("source_detail_text"));
  const referred_by_customer_id = nullable(formData.get("referred_by_customer_id"));
  const stageInput = str(formData.get("stage")) || "new";
  const stage = ALLOWED_STAGES.has(stageInput) ? stageInput : "new";
  const force = str(formData.get("force_create")) === "1";
  const overrideReason = str(formData.get("duplicate_override_reason"));

  const supabase = await createClient();

  const { data: source, error: sourceError } = await supabase
    .from("lead_sources")
    .select("id, key, detail_mode, detail_required")
    .eq("id", source_id)
    .maybeSingle();

  if (sourceError || !source) return { error: "Choose a valid lead source." };

  if (source.detail_required) {
    const filled =
      source.detail_mode === "referrer"
        ? Boolean(source_detail_text || referred_by_customer_id)
        : Boolean(source_detail_id || source_detail_text);
    if (!filled) return { error: "Add the required detail for this source." };
  }

  const matches = await duplicateMatches({
    fullName: full_name,
    email,
    phone,
    street,
    city,
    state,
    zip,
  });

  if (matches.length && !force) {
    return { error: null, duplicates: matches };
  }

  const hasHigh = matches.some((m) => m.confidence === "high");
  if (hasHigh && force) {
    if (!["admin", "office", "sales_manager"].includes(profile.role)) {
      return {
        error:
          "A customer with the same phone or email already exists. Ask office/admin to review it.",
        duplicates: matches,
      };
    }
    if (!overrideReason) {
      return { error: "Enter a reason to create this possible duplicate.", duplicates: matches };
    }
  }

  const legacySource =
    typeof source.key === "string" && LEGACY_ENUM.has(source.key)
      ? source.key
      : null;

  const { data, error } = await supabase
    .from("customers")
    .insert({
      full_name,
      company,
      email,
      phone,
      street,
      city,
      state,
      zip,
      notes,
      stage,
      source: legacySource,
      source_id,
      source_detail_id,
      source_detail_text,
      referred_by_customer_id,
      created_by: profile.id,
      assigned_to: profile.id,
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    return {
      error: employeeDbError(
        error?.message ?? "",
        "This customer could not be created. Please try again.",
      ),
    };
  }

  redirect(`/customers/${data.id}?new=1`);
}
