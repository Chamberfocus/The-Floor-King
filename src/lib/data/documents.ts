import { createClient } from "@/lib/supabase/server";
import type { CustomerDocument } from "@/lib/types";

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
