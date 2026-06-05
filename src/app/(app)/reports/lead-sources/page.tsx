import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { getLeadSourceReport } from "@/lib/data/reports";
import { LEAD_SOURCE_LABELS } from "@/lib/types";

export const metadata: Metadata = { title: "Lead Sources report" };

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default async function LeadSourcesReportPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string }>;
}) {
  const sp = await searchParams;
  const today = new Date();
  const end = sp.end || isoDay(today);
  const start =
    sp.start || isoDay(new Date(today.getTime() - 29 * 86400000));

  const report = await getLeadSourceReport(
    `${start}T00:00:00`,
    `${end}T23:59:59`,
  );

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/reports"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Reports
      </Link>
      <PageHeader
        title="Lead Sources"
        description="Where your leads came from in the selected period."
      />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label className="block text-xs text-muted-foreground">From</label>
          <Input type="date" name="start" defaultValue={start} />
        </div>
        <div className="space-y-1">
          <label className="block text-xs text-muted-foreground">To</label>
          <Input type="date" name="end" defaultValue={end} />
        </div>
        <Button type="submit" variant="outline">
          Update
        </Button>
      </form>

      <div className="mb-4 grid grid-cols-2 gap-4">
        <div className="rounded-lg border p-4">
          <div className="text-xs text-muted-foreground">Total leads</div>
          <div className="text-2xl font-semibold">{report.totalLeads}</div>
        </div>
        <div className="rounded-lg border p-4">
          <div className="text-xs text-muted-foreground">Won</div>
          <div className="text-2xl font-semibold">{report.totalWon}</div>
        </div>
      </div>

      {report.rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No leads created in this period.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Won</TableHead>
                <TableHead className="text-right">Win rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.map((r) => (
                <TableRow key={r.source}>
                  <TableCell className="font-medium">
                    {r.source === "unknown"
                      ? "Unknown"
                      : LEAD_SOURCE_LABELS[r.source]}
                  </TableCell>
                  <TableCell className="text-right">{r.leads}</TableCell>
                  <TableCell className="text-right">{r.won}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {r.leads ? Math.round((r.won / r.leads) * 100) : 0}%
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
