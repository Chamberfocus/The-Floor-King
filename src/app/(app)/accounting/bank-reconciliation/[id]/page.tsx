import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole, getProfile } from "@/lib/auth";
import { listEligibleBankAccounts, getBankReconciliationSession } from "@/lib/data/bank-reconciliation";
import { BankReconciliationWorkspace } from "../bank-reconciliation-workspace";

export default async function BankReconciliationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(["admin", "office"]);
  const profile = await getProfile();
  const { id } = await params;

  let detail: Awaited<ReturnType<typeof getBankReconciliationSession>> = null;
  try {
    detail = await getBankReconciliationSession(id);
  } catch {
    detail = null;
  }
  if (!detail) notFound();

  const accounts = await listEligibleBankAccounts();
  const acct = accounts.find((a) => a.id === detail.session.account_id);
  const accountLabel = acct ? `${acct.code} — ${acct.name}` : "Bank account";

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <p className="text-sm text-muted-foreground">
        <Link href="/accounting" className="underline">
          Accounting
        </Link>{" "}
        /{" "}
        <Link href="/accounting/bank-reconciliation" className="underline">
          Bank reconciliation
        </Link>
      </p>
      <BankReconciliationWorkspace
        sessionId={id}
        accountId={detail.session.account_id as string}
        accountLabel={accountLabel}
        status={detail.session.status as string}
        statementStart={detail.session.statement_start as string}
        statementEnd={detail.session.statement_end as string}
        openingBalance={Number(detail.session.opening_balance) || 0}
        endingBalance={Number(detail.session.ending_balance) || 0}
        importBatch={detail.importBatch as Record<string, unknown> | null}
        bankLines={detail.bankLines}
        journalLines={detail.journalLines}
        matches={detail.matches}
        package={detail.package}
        suggestions={detail.suggestions}
        isAdmin={profile?.role === "admin"}
      />
    </div>
  );
}
