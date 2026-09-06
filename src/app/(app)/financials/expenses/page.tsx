import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Wallet } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { listExpenses } from "@/lib/data/finance";
import { listJobs } from "@/lib/data/jobs";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/format";
import { ExpenseForm } from "../expense-form";

export const metadata: Metadata = { title: "Expenses" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function ExpensesPage() {
  const profile = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "office") redirect("/");

  const [expenses, jobs] = await Promise.all([listExpenses(), listJobs()]);
  const jobOptions = jobs.map((j) => ({
    id: j.id,
    label: `${j.customer_name ?? "?"} — ${j.title ?? "Job"}`,
  }));

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/financials"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to financials
      </Link>
      <PageHeader
        title="Expenses"
        description="Already-paid cash/card costs. Unpaid vendor invoices belong on Bills."
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Add an expense</CardTitle>
        </CardHeader>
        <CardContent>
          <ExpenseForm jobs={jobOptions} />
        </CardContent>
      </Card>

      {expenses.length === 0 ? (
        <EmptyState icon={Wallet} title="No expenses recorded yet" />
      ) : (
        <>
          <div className="space-y-2 md:hidden">
            {expenses.map((e) => (
              <div key={e.id} className="rounded-lg border p-3">
                <div className="min-w-0">
                  <div className="font-medium">
                    {EXPENSE_CATEGORY_LABELS[e.category]}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(e.date)}
                    {e.vendor ? ` · ${e.vendor}` : ""}
                  </div>
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">Vendor</div>
                    <div className="font-medium">{e.vendor ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Amount</div>
                    <div className="font-medium">{formatMoney(e.amount)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="hidden overflow-x-auto rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{formatDate(e.date)}</TableCell>
                    <TableCell>{EXPENSE_CATEGORY_LABELS[e.category]}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {e.vendor ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatMoney(e.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Expense history cannot be deleted. Reversal of recorded direct expenses is deferred
            to a later accounting phase.
          </p>
        </>
      )}
    </div>
  );
}
