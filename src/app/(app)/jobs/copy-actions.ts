"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertRole } from "@/lib/auth";
import { duplicateEstimateToCustomer } from "@/app/(app)/estimates/actions";
import { createJobForCustomer } from "@/app/(app)/jobs/new/actions";
import type { UserRole } from "@/lib/types";

/**
 * Copy a whole job to another unit.
 *
 * The same work at the next address is the normal shape of a property manager's
 * business — Abington Arms is one building with a job per unit, and every one of
 * them is the same scope with a different door number. Rebuilding that from
 * scratch each time is the single biggest waste of an estimator's day.
 *
 * Both halves already existed and neither knew about the other:
 * duplicateEstimateToCustomer copies the quote (and was already written for this
 * exact case — it takes an address and will create it if you type a new one),
 * and createJobForCustomer raises a job from an estimate. This joins them, so
 * "same again, unit 814" is one action rather than a copy, a hunt for the new
 * draft, and a second form.
 *
 * A job with no estimate behind it — a quick pickup order, a carried-over job —
 * copies its own fields instead. There's nothing to duplicate on the money side,
 * and refusing would be a strange place to draw a line.
 */

const STAFF: UserRole[] = ["admin", "office", "sales_manager", "salesman", "scheduler"];

export interface CopyJobInput {
  jobId: string;
  /** The unit this copy is for: an existing address, or one to create. */
  serviceAddressId: string | null;
  newAddress: {
    label: string;
    street: string;
    city: string;
    state: string;
    zip: string;
  } | null;
  /** Defaults to the source job's title when left blank. */
  title: string;
}

export interface CopyJobResult {
  error: string | null;
  jobId?: string;
}

export async function copyJob(input: CopyJobInput): Promise<CopyJobResult> {
  if (!input.jobId) return { error: "Missing the job to copy." };
  await assertRole(STAFF);
  const supabase = await createClient();

  const { data: src } = await supabase
    .from("jobs")
    .select("id, customer_id, title, notes, estimate_id, delivery_type")
    .eq("id", input.jobId)
    .maybeSingle();
  if (!src) return { error: "That job no longer exists." };
  const customerId = src.customer_id as string | null;
  if (!customerId) return { error: "That job has no customer." };

  const title = input.title.trim() || (src.title as string) || "Job";

  /**
   * Copy the quote first, pointed at the new unit — that's what carries the
   * scope, the options and the costed material. It also creates the address
   * when a new one is typed, so the job below can be given the same one.
   */
  let estimateId: string | null = null;
  let serviceAddressId = input.serviceAddressId;
  if (src.estimate_id) {
    const res = await duplicateEstimateToCustomer(
      src.estimate_id as string,
      customerId,
      {
        serviceAddressId: input.serviceAddressId ?? undefined,
        newAddress: input.serviceAddressId ? null : input.newAddress,
      },
    );
    if (res.error || !res.estimateId)
      return { error: res.error ?? "Couldn't copy the estimate." };
    estimateId = res.estimateId;

    // The copy resolved or created the address; read it back so the job lands
    // at the same unit rather than the account's billing address.
    const { data: newEst } = await supabase
      .from("estimates")
      .select("service_address_id")
      .eq("id", estimateId)
      .maybeSingle();
    serviceAddressId =
      (newEst?.service_address_id as string | null) ?? serviceAddressId;
  } else if (!serviceAddressId && input.newAddress?.street?.trim()) {
    // No estimate to carry the address, so create it here instead.
    const { data: created } = await supabase
      .from("service_addresses")
      .insert({
        customer_id: customerId,
        label: input.newAddress.label?.trim() || null,
        street: input.newAddress.street?.trim() || null,
        city: input.newAddress.city?.trim() || null,
        state: input.newAddress.state?.trim() || null,
        zip: input.newAddress.zip?.trim() || null,
      })
      .select("id")
      .single();
    serviceAddressId = (created?.id as string) ?? null;
  }

  const made = await createJobForCustomer({
    customerId,
    newCustomer: null,
    title,
    serviceAddressId,
    estimateId,
    // Deliberately NOT scheduled: the same work at a different unit happens on
    // its own day, and inheriting the original's date would put two crews in
    // two places on one morning.
    scheduledDate: null,
    arrivalWindow: null,
    installerId: null,
    notes: (src.notes as string) || "",
  });
  if (made.error || !made.jobId) return { error: made.error ?? "Couldn't create the job." };

  revalidatePath("/jobs");
  revalidatePath(`/customers/${customerId}`);
  return { error: null, jobId: made.jobId };
}
