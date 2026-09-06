import Link from "next/link";
import { requireRole, getProfile } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { bankReconStatusLabel } from "@/lib/accounting/bank-reconciliation";
import {
  listBankReconciliationSessions,
  listEligibleBankAccounts,
} from "@/lib/data/bank-reconciliation";
import { createBankReconciliationAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function BankReconciliationPage() {
  await requireRole(["admin", "office"]);
  const profile = await getProfile();

  let sessions: Awaited<ReturnType<typeof listBankReconciliationSessions>> = [];
  let accounts: Awaited<ReturnType<typeof listEligibleBankAccounts>> = [];
  let schemaReady = true;
  let schemaError: string | null = null;

  try {
    [sessions, accounts] = await Promise.all([
      listBankReconciliationSessions(),
      listEligibleBankAccounts(),
    ]);
  } catch (e) {
    schemaReady = false;
    schemaError = e instanceof Error ? e.message : "Bank reconciliation unavailable.";
  }

  const accountLabel = new Map(
    accounts.map((a) => [a.id, `${a.code} — ${a.name}`]),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/accounting" className="underline">
            Accounting
          </Link>{" "}
          / Bank reconciliation
        </p>
        <h1 className="text-2xl font-semibold">Bank reconciliation</h1>
        <p className="text-sm text-muted-foreground">
          Import bank statements, match to posted GL activity, and finalize when the difference is $0.00.
        </p>
      </div>

      {!schemaReady ? (
        <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {schemaError} Apply migration 0173 in Supabase when ready.
        </Card>
      ) : null}

      <Card className="p-4 space-y-4">
        <h2 className="font-medium">Start new reconciliation</h2>
        <form action={createBankReconciliationAction} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="account_id">Bank / cash account</Label>
            <select
              id="account_id"
              name="account_id"
              required
              className="w-full rounded-md border px-2 py-1.5 text-sm"
              defaultValue=""
            >
              <option value="" disabled>
                Select account…
              </option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="statement_start">Statement start</Label>
            <Input id="statement_start" name="statement_start" type="date" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="statement_end">Statement end</Label>
            <Input id="statement_end" name="statement_end" type="date" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="opening_balance">Beginning balance</Label>
            <Input
              id="opening_balance"
              name="opening_balance"
              type="number"
              step="0.01"
              required
              defaultValue="0"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ending_balance">Ending balance</Label>
            <Input
              id="ending_balance"
              name="ending_balance"
              type="number"
              step="0.01"
              required
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Input id="notes" name="notes" placeholder="January operating checking" />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit">Create reconciliation</Button>
          </div>
        </form>
      </Card>

      <Card className="p-4 space-y-3">
        <h2 className="font-medium">Recent reconciliations</h2>
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reconciliations yet.</p>
        ) : (
          <ul className="divide-y text-sm">
            {sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <Link
                    href={`/accounting/bank-reconciliation/${s.id}`}
                    className="font-medium underline"
                  >
                    {accountLabel.get(s.account_id as string) ?? "Bank account"}
                  </Link>
                  <p className="text-muted-foreground">
                    {s.statement_start as string} → {s.statement_end as string} ·{" "}
                    {bankReconStatusLabel(s.status as string)}
                  </p>
                </div>
                <div className="text-right">
                  <p>{formatMoney(Number(s.ending_balance) || 0)} ending</p>
                  {s.difference != null ? (
                    <p className="text-muted-foreground">
                      Diff {formatMoney(Number(s.difference) || 0)}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {profile?.role === "admin" ? (
        <p className="text-xs text-muted-foreground">
          Admin can void reconciliations before books_of_record is enabled.
        </p>
      ) : null}
    </div>
  );
}
