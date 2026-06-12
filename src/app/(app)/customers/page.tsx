import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Search, Upload } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { StageBadge } from "@/components/stage-badge";
import { SearchPicker } from "@/components/ui/search-picker";
import { listCustomers } from "@/lib/data/customers";
import {
  LEAD_SOURCE_LABELS,
  LEAD_STAGE_LABELS,
  LEAD_STAGE_ORDER,
  type LeadStage,
} from "@/lib/types";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; stage?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const stageParam = sp.stage as LeadStage | undefined;
  const stage =
    stageParam && LEAD_STAGE_ORDER.includes(stageParam) ? stageParam : undefined;

  const customers = await listCustomers({ search: q, stage });

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Everyone in your pipeline — leads and customers alike."
      >
        <div className="flex gap-2">
          <Link
            href="/customers/import"
            className={buttonVariants({ size: "lg", variant: "outline" })}
          >
            <Upload className="size-4" /> Import clients
          </Link>
          <Link href="/customers/new" className={buttonVariants({ size: "lg" })}>
            <Plus className="size-4" /> Add customer
          </Link>
        </div>
      </PageHeader>

      {/* Search + filter (works without JavaScript) */}
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={q}
            placeholder="Search name, phone, email, city…"
            className="pl-8"
          />
        </div>
        <SearchPicker
          className="w-44"
          name="stage"
          defaultValue={stage ?? ""}
          placeholder="All stages"
          options={[
            { value: "", label: "All stages" },
            ...LEAD_STAGE_ORDER.map((s) => ({
              value: s,
              label: LEAD_STAGE_LABELS[s],
            })),
          ]}
        />
        <Button type="submit" variant="outline" size="lg">
          Search
        </Button>
        {(q || stage) && (
          <Link
            href="/customers"
            className={buttonVariants({ variant: "ghost", size: "lg" })}
          >
            Clear
          </Link>
        )}
      </form>

      {customers.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {q || stage
              ? "No customers match your search."
              : "No customers yet. Add your first lead to get started."}
          </p>
          {!q && !stage ? (
            <Link
              href="/customers/new"
              className={buttonVariants({ className: "mt-4" })}
            >
              <Plus className="size-4" /> Add customer
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/customers/${c.id}`}
                      className="hover:underline"
                    >
                      {c.full_name}
                    </Link>
                    {c.company ? (
                      <span className="block text-xs text-muted-foreground">
                        {c.company}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <StageBadge stage={c.stage} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.phone ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.city ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.source ? LEAD_SOURCE_LABELS[c.source] : "—"}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatDate(c.updated_at)}
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
