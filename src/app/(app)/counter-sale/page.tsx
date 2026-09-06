import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { getBusinessSettings } from "@/lib/data/business-settings";
import { getOrgSettings } from "@/lib/data/org";
import { createClient } from "@/lib/supabase/server";
import { CounterSaleForm } from "./counter-sale-form";

export const metadata: Metadata = { title: "Counter sale" };
export const dynamic = "force-dynamic";

/**
 * Cash & carry: material off the shelf, paid for at the desk.
 *
 * There was nowhere for this to go. An estimate is a quote for work, an order
 * is a request waiting to be reviewed, and a job is an install — so a walk-in
 * either got typed in as a fake job or never reached the books at all.
 *
 * It records a paid invoice against a real customer, which is what a counter
 * sale actually is, and takes their details on the way through — the reason for
 * doing it here rather than on a pad.
 */
export default async function CounterSalePage() {
  await requireProfile();
  const [biz, org] = await Promise.all([
    getBusinessSettings(),
    getOrgSettings(),
  ]);
  // There's no org-wide default tax rate, so follow what the quick estimate
  // does: reuse the rate on the most recent estimate. It's the shop's usual
  // rate in practice, and it's still editable on the form.
  const supabase = await createClient();
  const { data: lastEst } = await supabase
    .from("estimates")
    .select("tax_rate")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-3xl pb-16">
      <PageHeader
        title="Counter sale"
        description="Cash & carry — ring it up, take their details, print the receipt."
      />
      <CounterSaleForm
        defaultTaxRate={Number(lastEst?.tax_rate ?? 0) || 0}
        targetMarginPct={Number(biz?.target_gross_margin_pct ?? 40)}
        freightMarkupPct={Number(org.freight_markup_pct ?? 0) || 0}
      />
    </div>
  );
}
