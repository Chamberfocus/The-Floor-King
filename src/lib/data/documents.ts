import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/auth";
import { authorizeServiceRoleDocumentSign } from "@/lib/job-warehouse";
import type { CustomerDocument } from "@/lib/types";

async function memberCrewIdsFor(userId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("install_crews")
    .select("id")
    .eq("profile_id", userId)
    .eq("active", true);
  return (data ?? []).map((c) => c.id as string);
}

async function assertCanSignJobDocuments(jobId: string): Promise<boolean> {
  const profile = await getProfile();
  if (!profile || profile.role === "customer") return false;
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("id, assigned_to, assigned_crew_id")
    .eq("id", jobId)
    .maybeSingle();
  const crews = await memberCrewIdsFor(profile.id);
  return authorizeServiceRoleDocumentSign({
    role: profile.role,
    userId: profile.id,
    jobVisible: !!job,
    jobAssignedTo: (job?.assigned_to as string | null) ?? null,
    jobAssignedCrewId: (job?.assigned_crew_id as string | null) ?? null,
    memberCrewIds: crews,
  });
}

async function signDocuments(
  docs: CustomerDocument[],
): Promise<CustomerDocument[]> {
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return docs.map((d) => ({ ...d, url: null }));
  }
  return Promise.all(
    docs.map(async (d) => {
      const { data: signed } = await admin.storage
        .from("documents")
        .createSignedUrl(d.path, 3600);
      return { ...d, url: signed?.signedUrl ?? null };
    }),
  );
}

/** Completed-job photos attached to a work order (signed URLs for viewing). */
export async function getJobPhotos(jobId: string): Promise<CustomerDocument[]> {
  if (!jobId) return [];
  if (!(await assertCanSignJobDocuments(jobId))) return [];
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
  return signDocuments((data ?? []) as CustomerDocument[]);
}

/**
 * Measurement diagrams for a customer, for the INSTALLER job view.
 * Requires a visible authorized job for that customer — not page-only trust.
 */
export async function getMeasurementDocuments(
  customerId: string,
  jobId?: string | null,
): Promise<CustomerDocument[]> {
  if (!customerId) return [];
  if (!jobId) return [];
  if (!(await assertCanSignJobDocuments(jobId))) return [];
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("customer_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job || (job.customer_id as string) !== customerId) return [];

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

  return signDocuments((data ?? []) as CustomerDocument[]);
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
