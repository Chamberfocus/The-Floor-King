"use server";

import { redirect } from "next/navigation";
import { assertRole } from "@/lib/auth";
import {
  authorizeMerge,
  mayMergeCustomers,
  mergeIdempotencyKey,
  type ChosenProfileFields,
  type ProfileMergeField,
  PROFILE_MERGE_FIELDS,
} from "@/lib/customer-duplicate-cleanup";
import {
  excludeDuplicatePair,
  executeMergeRpc,
} from "@/lib/data/customer-duplicate-cleanup";

const MERGE_ROLES = ["admin", "office"] as const;

export type MergeActionState = {
  ok: boolean;
  error: string | null;
};

export async function markNotDuplicate(
  _prev: MergeActionState,
  formData: FormData,
): Promise<MergeActionState> {
  const profile = await assertRole([...MERGE_ROLES]);
  const a = String(formData.get("customer_a") ?? "").trim();
  const b = String(formData.get("customer_b") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!a || !b) return { ok: false, error: "Both customer ids are required." };
  if (!reason) return { ok: false, error: "A reason is required to mark records as not a duplicate." };
  const auth = authorizeMerge(profile.role);
  if (!auth.ok) return { ok: false, error: auth.error };
  const result = await excludeDuplicatePair({
    a,
    b,
    reason,
    actorId: profile.id,
  });
  if (!result.ok) return { ok: false, error: result.error };
  redirect("/customers/duplicates");
}

export async function mergeDuplicateCustomers(
  _prev: MergeActionState,
  formData: FormData,
): Promise<MergeActionState> {
  const profile = await assertRole([...MERGE_ROLES]);
  if (!mayMergeCustomers(profile.role)) {
    return { ok: false, error: "Only office/admin can merge customer records." };
  }
  const survivor = String(formData.get("survivor_id") ?? "").trim();
  const duplicate = String(formData.get("duplicate_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const idempotency =
    String(formData.get("idempotency_key") ?? "").trim() ||
    mergeIdempotencyKey(survivor, duplicate);
  if (!survivor || !duplicate) {
    return { ok: false, error: "Select a surviving customer and a duplicate." };
  }
  const chosen: ChosenProfileFields = {};
  for (const field of PROFILE_MERGE_FIELDS) {
    const v = String(formData.get(`field_${field}`) ?? "").trim();
    if (v === "survivor" || v === "duplicate") {
      chosen[field as ProfileMergeField] = v;
    }
  }
  const result = await executeMergeRpc({
    survivorId: survivor,
    duplicateId: duplicate,
    chosen,
    reason,
    idempotencyKey: idempotency,
  });
  if (!result.ok) {
    return { ok: false, error: result.error || "Merge was blocked." };
  }
  redirect(`/customers/${survivor}?merged_from=${duplicate}`);
}
