import Link from "next/link";
import { requireRole, getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  getAccountingSettings,
  getAccountMappings,
  listGlAccounts,
} from "@/lib/data/accounting";
import {
  fetchBalanceSheet,
  fetchCutoverSnapshot,
  fetchExceptions,
  fetchPnL,
  fetchTrialBalance,
  monthStartIso,
  todayIso,
} from "@/lib/data/accounting-reports";
import {
  ACCOUNTING_NOT_BOOKS_MESSAGE,
} from "@/lib/accounting/types";
import { formatMoney } from "@/lib/format";
import {
  controlCenterNavItems,
  REPORT_LABELS,
} from "@/lib/accounting/control-center";
import {
  lockAccountingPeriodAction,
  updateAccountingSettingsAction,
  closeAccountingPeriodAction,
  reopenAccountingPeriodAction,
} from "./actions";
import { BackupPitrAttestationForm } from "./backup-pitr-form";
import { listFinancialAuditEvents } from "@/lib/data/financial-audit";
import { FINANCIAL_AUDIT_ACTION_LABELS } from "@/lib/accounting/audit-log";
import { getLatestOpeningBalanceBatch } from "@/lib/data/opening-balances";
import { openingStatusLabel } from "@/lib/accounting/opening-balances";
import { BooksStatusBanner } from "./components/books-status-banner";
import { PeriodActionForm } from "./components/period-action-form";

export default async function AccountingControlCenterPage() {
  await requireRole(["admin", "office"]);
  const profile = await getProfile();
  const settings = await getAccountingSettings();
  const accounts = await listGlAccounts();
  const mappings = await getAccountMappings();
  const supabase = await createClient();

  let openingBatchStatus: string | null = null;
  try {
    const openingBatch = await getLatestOpeningBalanceBatch();
    openingBatchStatus = openingBatch?.status ?? null;
  } catch {
    openingBatchStatus = null;
  }

  const { data: periods } = await supabase
    .from("accounting_periods")
    .select("id, label, start_date, end_date, status")
    .order("start_date", { ascending: false })
    .limit(24);

  const today = todayIso();
  const monthStart = monthStartIso(today);
  const [tb, pnl, bs, exceptions, cutover] = await Promise.all([
    fetchTrialBalance(today),
    fetchPnL(monthStart, today),
    fetchBalanceSheet(today),
    fetchExceptions(),
    fetchCutoverSnapshot(),
  ]);
  const auditEvents = await listFinancialAuditEvents({ limit: 25 });
  const nav = controlCenterNavItems().filter((i) => i.href !== "/accounting");
  const exceptionCount =
    exceptions.counts.critical +
    exceptions.counts.high +
    exceptions.counts.warning;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {REPORT_LABELS.controlCenter}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {ACCOUNTING_NOT_BOOKS_MESSAGE}
        </p>
      </div>

      <BooksStatusBanner
        books={tb.books}
        source={tb.source}
        fallbackReason={tb.fallbackReason}
      />

      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
        <div>
          Automatic posting:{" "}
          <strong>{settings.posting_enabled ? "ON" : "OFF"}</strong>
        </div>
        <div>
          Event pilots — invoice/payment/credit/AP/expense/deposit/installer:{" "}
          <strong>
            {[
              settings.invoice_posting_enabled,
              settings.payment_posting_enabled,
              settings.credit_posting_enabled,
              settings.ap_posting_enabled,
              settings.expense_posting_enabled,
              settings.deposit_posting_enabled,
              settings.installer_posting_enabled,
            ].some(Boolean)
              ? "some ON (still requires master posting_enabled)"
              : "all OFF"}
          </strong>
        </div>
        <div>
          Inventory posting:{" "}
          <strong>
            {settings.inventory_posting_enabled ? "ON" : "OFF"}
          </strong>
        </div>
        <div>
          Cutover date:{" "}
          <strong>{settings.cutover_date ?? "not set"}</strong>
        </div>
        <div>
          Books of record flag:{" "}
          <strong>{settings.books_of_record ? "YES" : "NO"}</strong>
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          F6-P5 control center does not enable posting. External books remain
          official until cutover validation.
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">Trial Balance</div>
          <div className="mt-1 font-medium">
            {tb.balanced ? "Balanced" : "Out of balance"}
          </div>
          <div className="text-xs text-muted-foreground">
            Debits {formatMoney(tb.totalDebits)}
          </div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">P&amp;L (MTD)</div>
          <div className="mt-1 font-medium">{formatMoney(pnl.netIncome)}</div>
          <div className="text-xs text-muted-foreground">Net income</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">Balance Sheet</div>
          <div className="mt-1 font-medium">{formatMoney(bs.assets)}</div>
          <div className="text-xs text-muted-foreground">
            Assets {bs.balanced ? "· in balance" : "· OUT"}
          </div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">Exceptions</div>
          <div className="mt-1 font-medium">
            {exceptionCount} actionable ·{" "}
            {exceptions.counts.expected_not_active} expected
          </div>
          <Link href="/accounting/exceptions" className="text-xs underline">
            View scan
          </Link>
        </div>
      </section>

      <div className="rounded-lg border p-4 text-sm space-y-2">
        <h2 className="font-medium">Reports</h2>
        <ul className="grid gap-1 sm:grid-cols-2 text-sm">
          {nav.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="underline">
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          CSV export:{" "}
          <Link
            href={`/accounting/export?report=trial-balance&asOf=${today}`}
            className="underline"
          >
            Trial Balance
          </Link>
          {" · "}
          <Link
            href={`/accounting/export?report=general-ledger&start=${monthStart}&end=${today}`}
            className="underline"
          >
            General Ledger
          </Link>
        </p>
      </div>

      <div className="rounded-lg border p-4 text-sm space-y-2">
        <h2 className="font-medium">Cutover snapshot</h2>
        <p className="text-xs text-muted-foreground">
          Verdict:{" "}
          <strong
            className={
              cutover.verdict === "NOT_READY"
                ? "text-destructive"
                : "text-amber-700"
            }
          >
            {cutover.verdict}
          </strong>
          {" · "}
          <Link href="/accounting/cutover" className="underline">
            Details
          </Link>
        </p>
        {cutover.blockers.length > 0 ? (
          <ul className="list-disc pl-5 text-xs text-destructive">
            {cutover.blockers.slice(0, 5).map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="rounded-lg border p-4 text-sm space-y-2">
        <h2 className="font-medium">Opening balances</h2>
        <p>
          Status:{" "}
          <strong>
            {settings.opening_balances_entered
              ? "Completed"
              : openingStatusLabel(
                  (openingBatchStatus as
                    | "draft"
                    | "validated"
                    | "posted"
                    | "void"
                    | null) ?? null,
                )}
          </strong>
        </p>
        <Link href="/accounting/opening-balances" className="underline text-sm">
          Open opening balance wizard
        </Link>
      </div>

      <div className="rounded-lg border p-4 text-sm space-y-2">
        <h2 className="font-medium">Bank reconciliation</h2>
        <Link
          href="/accounting/bank-reconciliation"
          className="underline text-sm"
        >
          Open bank reconciliation workspace
        </Link>
      </div>

      <div className="rounded-lg border p-4 text-sm space-y-2">
        <h2 className="font-medium">Backup / PITR attestation</h2>
        <p className="text-xs text-muted-foreground">
          Recording attestation does not enable posting.
        </p>
        {profile?.role === "admin" ? (
          <BackupPitrAttestationForm
            confirmedAt={settings.backup_pitr_confirmed_at}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            Admin only. Status:{" "}
            {settings.backup_pitr_confirmed_at ? "confirmed" : "not confirmed"}
          </p>
        )}
      </div>

      {profile?.role === "admin" ? (
        <form
          action={updateAccountingSettingsAction}
          className="space-y-3 rounded-lg border p-4 text-sm"
        >
          <h2 className="font-medium">Admin settings</h2>
          <p className="text-xs text-muted-foreground">
            Books-of-record remains gated (openings + accountant validation).
            Do not enable posting casually.
          </p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="posting_enabled"
              defaultChecked={settings.posting_enabled}
            />
            Master: Enable automatic event posting (after cutover validation)
          </label>
          <div className="grid gap-1 md:grid-cols-2">
            {(
              [
                ["invoice_posting_enabled", "Invoice pilot", settings.invoice_posting_enabled],
                ["payment_posting_enabled", "Payment pilot", settings.payment_posting_enabled],
                ["credit_posting_enabled", "Credit/refund pilot", settings.credit_posting_enabled],
                ["ap_posting_enabled", "AP/bill pilot", settings.ap_posting_enabled],
                ["expense_posting_enabled", "Expense pilot", settings.expense_posting_enabled],
                ["deposit_posting_enabled", "Deposit pilot", settings.deposit_posting_enabled],
                ["installer_posting_enabled", "Installer pilot", settings.installer_posting_enabled],
              ] as const
            ).map(([name, label, checked]) => (
              <label key={name} className="flex items-center gap-2">
                <input type="checkbox" name={name} defaultChecked={checked} />
                {label}
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="inventory_posting_enabled"
              defaultChecked={settings.inventory_posting_enabled}
            />
            Enable perpetual inventory ledger posting
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="books_of_record"
              defaultChecked={settings.books_of_record}
            />
            Mark as books of record (gated)
          </label>
          <label className="block">
            Cutover date
            <input
              type="date"
              name="cutover_date"
              defaultValue={settings.cutover_date ?? ""}
              className="mt-1 block w-full rounded-md border px-2 py-1"
            />
          </label>
          <label className="block">
            Default cash account
            <select
              name="default_cash_method"
              defaultValue={settings.default_cash_method}
              className="mt-1 block w-full rounded-md border px-2 py-1"
            >
              <option value="undeposited">Undeposited Funds</option>
              <option value="cash">Operating Checking</option>
            </select>
          </label>
          <button
            type="submit"
            className="rounded-md bg-foreground px-3 py-1.5 text-background"
          >
            Save settings
          </button>
        </form>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Periods</h2>
        <p className="text-xs text-muted-foreground">
          Close / reopen / lock require a reason and use privileged RPCs (0177).
          Admin only.
        </p>
        <ul className="space-y-2 text-sm">
          {(periods ?? []).map((p) => (
            <li
              key={p.id as string}
              className="flex flex-col gap-2 rounded-md border px-3 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
            >
              <span>
                {p.label as string} · {p.start_date as string} →{" "}
                {p.end_date as string} · <strong>{p.status as string}</strong>
              </span>
              {profile?.role === "admin" ? (
                <span className="flex flex-col gap-2">
                  {p.status === "open" ? (
                    <PeriodActionForm
                      periodId={p.id as string}
                      action={closeAccountingPeriodAction}
                      label="Close"
                      reasonPlaceholder="Close reason (required)"
                    />
                  ) : null}
                  {p.status === "closed" ? (
                    <PeriodActionForm
                      periodId={p.id as string}
                      action={reopenAccountingPeriodAction}
                      label="Reopen"
                      reasonPlaceholder="Reopen reason (required)"
                    />
                  ) : null}
                  {p.status !== "locked" ? (
                    <PeriodActionForm
                      periodId={p.id as string}
                      action={lockAccountingPeriodAction}
                      label="Lock"
                      reasonPlaceholder="Lock reason (required)"
                    />
                  ) : null}
                </span>
              ) : null}
            </li>
          ))}
          {(periods ?? []).length === 0 ? (
            <li className="text-muted-foreground text-sm">No periods yet.</li>
          ) : null}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Financial audit trail</h2>
        {auditEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No audit events yet.
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {auditEvents.map((e) => (
              <li key={e.id} className="rounded-md border px-3 py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {FINANCIAL_AUDIT_ACTION_LABELS[
                      e.action as keyof typeof FINANCIAL_AUDIT_ACTION_LABELS
                    ] ?? e.action}
                  </span>
                  <time className="text-xs text-muted-foreground">
                    {new Date(e.occurredAt).toLocaleString()}
                  </time>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {e.entityType}
                  {e.entityId ? ` · ${e.entityId}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border p-4 text-sm text-muted-foreground">
        <h2 className="font-medium text-foreground">Chart snapshot</h2>
        <p className="mt-1">
          {accounts.length} accounts · {Object.keys(mappings).length} system
          mappings.{" "}
          <Link href="/accounting/chart-of-accounts" className="underline">
            Manage chart
          </Link>
        </p>
      </section>
    </div>
  );
}
