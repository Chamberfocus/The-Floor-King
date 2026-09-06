import Link from "next/link";
import { requireRole, getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  getAccountMappings,
  listGlAccounts,
} from "@/lib/data/accounting";
import {
  getLatestOpeningBalanceBatch,
  getOpeningBalanceBatch,
} from "@/lib/data/opening-balances";
import {
  openingStatusLabel,
  type OpeningApItemDraft,
  type OpeningArItemDraft,
  type OpeningGlLineDraft,
} from "@/lib/accounting/opening-balances";
import { OpeningBalanceWizard } from "./opening-balance-wizard";

export default async function OpeningBalancesPage() {
  await requireRole(["admin", "office"]);
  const profile = await getProfile();
  const isAdmin = profile?.role === "admin";

  let batch: Awaited<ReturnType<typeof getLatestOpeningBalanceBatch>> = null;
  let detail: Awaited<ReturnType<typeof getOpeningBalanceBatch>> = null;
  let schemaReady = true;
  let schemaError: string | null = null;

  try {
    batch = await getLatestOpeningBalanceBatch();
    if (batch) detail = await getOpeningBalanceBatch(batch.id);
  } catch (e) {
    schemaReady = false;
    schemaError = e instanceof Error ? e.message : "Opening balance tables unavailable.";
  }

  const accounts = await listGlAccounts();
  const mappings = await getAccountMappings();
  const supabase = await createClient();
  const [{ data: customers }, { data: vendors }] = await Promise.all([
    supabase
      .from("customers")
      .select("id, full_name")
      .is("cancelled_at", null)
      .order("full_name")
      .limit(500),
    supabase.from("suppliers").select("id, name").order("name").limit(500),
  ]);

  const initialLines: OpeningGlLineDraft[] = (detail?.lines ?? []).map((l) => ({
    accountId: l.account_id as string,
    signedAmount: Number(l.signed_amount),
    note: (l.note as string | null) ?? undefined,
  }));
  const initialAr: OpeningArItemDraft[] = (detail?.arItems ?? []).map((i) => ({
    customerId: i.customer_id as string,
    amount: Number(i.amount),
    dueDate: (i.due_date as string | null) ?? null,
    legacyInvoiceNumber: (i.legacy_invoice_number as string | null) ?? null,
    reference: (i.reference as string | null) ?? null,
    jobId: (i.job_id as string | null) ?? null,
    note: (i.note as string | null) ?? null,
  }));
  const initialAp: OpeningApItemDraft[] = (detail?.apItems ?? []).map((i) => ({
    vendorId: i.vendor_id as string,
    amount: Number(i.amount),
    billDate: (i.bill_date as string | null) ?? null,
    dueDate: (i.due_date as string | null) ?? null,
    legacyBillNumber: (i.legacy_bill_number as string | null) ?? null,
    reference: (i.reference as string | null) ?? null,
    note: (i.note as string | null) ?? null,
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link href="/accounting" className="underline">
              Accounting
            </Link>
            {" / Opening balances"}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Opening balance wizard
          </h1>
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
            Enter starting balances from your prior books. This does not turn
            accounting on or make Floor King CRM the official books.
          </p>
        </div>
        <div className="rounded-md border px-3 py-2 text-sm">
          Status:{" "}
          <strong>
            {schemaReady
              ? openingStatusLabel(batch?.status ?? null)
              : "Schema pending (0172)"}
          </strong>
        </div>
      </div>

      {!schemaReady ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <p className="font-medium">Migration 0172 is not applied yet.</p>
          <p className="mt-1 text-muted-foreground">
            {schemaError}. Apply{" "}
            <code className="text-xs">
              supabase/migrations/0172_f6_p2b_opening_balance_wizard.sql
            </code>{" "}
            in the Supabase SQL editor when ready. Do not enable posting or
            cutover.
          </p>
        </div>
      ) : (
        <OpeningBalanceWizard
          batch={
            batch
              ? {
                  id: batch.id,
                  as_of_date: batch.as_of_date,
                  status: batch.status,
                  description: batch.description,
                }
              : null
          }
          initialLines={initialLines}
          initialAr={initialAr}
          initialAp={initialAp}
          accounts={accounts as never[]}
          customers={(customers ?? []) as { id: string; full_name: string }[]}
          vendors={(vendors ?? []) as { id: string; name: string }[]}
          mappings={mappings}
          isAdmin={Boolean(isAdmin)}
        />
      )}
    </div>
  );
}
