import Link from "next/link";
import { requireRole, getProfile } from "@/lib/auth";
import { REPORT_LABELS } from "@/lib/accounting/control-center";
import { listGlAccounts } from "@/lib/data/accounting";
import { ACCOUNTING_NOT_BOOKS_MESSAGE } from "@/lib/accounting/types";
import { deactivateGlAccountAction } from "../actions";
import { IdempotencyField } from "../components/idempotency-field";

export default async function ChartOfAccountsPage() {
  await requireRole(["admin", "office"]);
  const profile = await getProfile();
  const accounts = await listGlAccounts();

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {REPORT_LABELS.chartOfAccounts}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {ACCOUNTING_NOT_BOOKS_MESSAGE}
        </p>
      </div>
      <p className="text-sm">
        <Link href="/accounting" className="underline">
          Control Center
        </Link>
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left">
              <th className="p-2">Code</th>
              <th className="p-2">Name</th>
              <th className="p-2">Type</th>
              <th className="p-2">Subtype</th>
              <th className="p-2">Active</th>
              <th className="p-2">System</th>
              {profile?.role === "admin" ? (
                <th className="p-2">Actions</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id as string} className="border-b">
                <td className="p-2 font-mono text-xs">{a.code as string}</td>
                <td className="p-2">{a.name as string}</td>
                <td className="p-2">{a.account_type as string}</td>
                <td className="p-2 text-muted-foreground">
                  {(a.subtype as string | null) ?? ""}
                </td>
                <td className="p-2">
                  {a.is_active === false ? "no" : "yes"}
                </td>
                <td className="p-2">{a.is_system ? "yes" : ""}</td>
                {profile?.role === "admin" ? (
                  <td className="p-2">
                    {a.is_active !== false && !a.is_system ? (
                      <form
                        action={deactivateGlAccountAction}
                        className="flex flex-wrap items-center gap-1"
                      >
                        <input
                          type="hidden"
                          name="account_id"
                          value={a.id as string}
                        />
                        <IdempotencyField />
                        <input
                          type="text"
                          name="reason"
                          required
                          placeholder="Reason"
                          className="w-28 rounded border px-1 py-0.5 text-xs"
                        />
                        <button type="submit" className="underline text-xs">
                          Deactivate
                        </button>
                      </form>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
            {accounts.length === 0 ? (
              <tr>
                <td className="p-3 text-muted-foreground" colSpan={7}>
                  No GL accounts.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Deactivate uses <code>gl_account_deactivate_safe</code> when migration
        0177 is applied. System accounts cannot be deactivated.
      </p>
    </div>
  );
}
