import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CustomerDocument } from "@/lib/types";

/** Completed-job photos attached to a work order (signed URLs for viewing). */
export async function getJobPhotos(jobId: string): Promise<CustomerDocument[]> {
  if (!jobId) return [];
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return [];
  }
  const { data } = await admin
    .from("documents")
    .select("id, customer_id, po_id, uploaded_by, name, path, mime, kind, created_at")
    .eq("job_id", jobId)
    .eq("kind", "completed")
    .order("created_at", { ascending: false });
  const docs = (data ?? []) as CustomerDocument[];
  return Promise.all(
    docs.map(async (d) => {
      const { data: signed } = await admin.storage.from("documents").createSignedUrl(d.path, 3600);
      return { ...d, url: signed?.signedUrl ?? null };
    }),
  );
}

/**
 * Measurement diagrams for a customer, for the INSTALLER job view. Loaded with
 * the service-role client because crew/warehouse are blocked from the documents
 * table by RLS — but they must see the measurement diagram to do the job. The
 * job page is internal-only (customers are redirected), so this is safe.
 */
export async function getMeasurementDocuments(
  customerId: string,
): Promise<CustomerDocument[]> {
  if (!customerId) return [];
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return [];
  }
  const { data } = await admin
    .from("documents")
    .select(
      "id, customer_id, po_id, uploaded_by, name, path, mime, kind, created_at",
    )
    .eq("customer_id", customerId)
    .eq("kind", "measurement")
    .order("created_at", { ascending: false });

  const docs = (data ?? []) as CustomerDocument[];
  return Promise.all(
    docs.map(async (d) => {
      const { data: signed } = await admin.storage
        .from("documents")
        .createSignedUrl(d.path, 3600);
      return { ...d, url: signed?.signedUrl ?? null };
    }),
  );
}

/** Documents attached to a customer, each with a short-lived signed URL. */
export async function listCustomerDocuments(
  customerId: string,
): Promise<CustomerDocument[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("documents")
    .select(
      "id, customer_id, po_id, uploaded_by, name, path, mime, kind, created_at",
    )
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  const docs = (data ?? []) as CustomerDocument[];
  return Promise.all(
    docs.map(async (d) => {
      const { data: signed } = await supabase.storage
        .from("documents")
        .createSignedUrl(d.path, 3600);
      return { ...d, url: signed?.signedUrl ?? null };
    }),
  );
}
