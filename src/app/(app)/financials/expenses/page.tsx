import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { deleteExpense } from "../actions";

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
        <ArrowLeft className="size-4" /> Financials
      </Link>
      <PageHeader
        title="Expenses"
        description="Record what you spend so your Profit & Loss is accurate."
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
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No expenses recorded yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead></TableHead>
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
                  <TableCell className="text-right">
                    <form action={deleteExpense}>
                      <input type="hidden" name="id" value={e.id} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Delete expense"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </form>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
