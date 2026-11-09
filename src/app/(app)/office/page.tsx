import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth";
import { loadOfficeHub, type OfficeJobRow } from "@/lib/data/office-hub";
import { formatDate, formatMoney } from "@/lib/format";
import { OFFICE_LANE_LABEL, OFFICE_LANE_ORDER, type OfficeJobLane } from "@/lib/office-hub";
import { formatPoNumber, WAREHOUSE_STATUS_LABELS, type WarehouseStatus } from "@/lib/types";

export const metadata: Metadata = { title: "Office" };
export const dynamic = "force-dynamic";

const LINKS: { href: string; label: string }[] = [
  { href: "/invoices", label: "Invoices" },
  { href: "/purchase-orders", label: "Purchase orders" },
  { href: "/warehouse", label: "Warehouse" },
  { href: "/bills", label: "Bills" },
  { href: "/accounting", label: "Accounting" },
  { href: "/reports/statements", label: "Statements" },
  { href: "/reports/sales-tax", label: "Sales tax" },
  { href: "/home", label: "Today's follow-ups" },
  { href: "/jobs", label: "All jobs" },
];

export default async function OfficePage() {
  const profile = await requireRole(["admin", "office"]);
  const hub = await loadOfficeHub();
  const collectHref = hub.collectKind === "overdue" ? "/invoices?view=overdue" : "/invoices?view=open";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Office"
        description="The financial desk for the store. Collect what is owed, write the invoice when the job is ready, and see whether the warehouse or the salesperson still has the next step."
      />

      {profile.role === "admin" ? (
        <p className="text-sm text-muted-foreground">
          You still run the whole store, including Settings and Business Pulse. This is the desk an office manager works from.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          You can see the whole job, the salesperson, and the warehouse. Settings and Business Pulse stay with the owner.
        </p>
      )}

      <nav className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="font-medium text-primary underline-offset-4 hover:underline">
            {link.label}
          </Link>
        ))}
      </nav>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          href={collectHref}
          label="Still owed"
          value={hub.ar ? formatMoney(hub.ar.total) : String(hub.collectTotal)}
          hint={
            hub.collectKind === "overdue"
              ? `${hub.collectTotal} overdue`
              : hub.ar
                ? `${hub.ar.count} with a balance`
                : `${hub.collectTotal} open`
          }
        />
        <Stat
          href="#write-the-invoice"
          label="Need an invoice"
          value={String(hub.jobs.filter((job) => job.lane === "invoice").length)}
          hint="Ready or finished, not billed"
        />
        <Stat
          href="/warehouse"
          label="With the warehouse"
          value={String(hub.jobs.filter((job) => job.lane === "warehouse").length)}
          hint={`${hub.poOpen} purchase orders still out`}
        />
        <Stat
          href="/bills"
          label="Bills to pay"
          value={formatMoney(hub.billTotal)}
          hint={
            hub.billOverdue
              ? `${hub.billOverdue} overdue of ${hub.billCount}`
              : `${hub.billCount} open`
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Collect</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              {hub.collectKind === "overdue"
                ? "These invoices are past due. The balance is the same number the invoice uses."
                : "Nothing is past due. These invoices still have a balance."}
            </p>
            {hub.collect.length === 0 ? (
              <p className="text-sm">No invoice is waiting on a payment.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {hub.collect.map((row) => (
                  <li key={row.id} className="flex items-start justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <Link href={`/invoices/${row.id}`} className="font-medium hover:underline">
                        {row.number ? `Invoice ${row.number}` : "Invoice"}
                      </Link>
                      <p className="truncate text-muted-foreground">
                        {row.customerId ? (
                          <Link href={`/customers/${row.customerId}`} className="hover:underline">
                            {row.customerName || "Customer"}
                          </Link>
                        ) : (
                          row.customerName || "Customer"
                        )}
                        {row.due ? ` · due ${formatDate(row.due)}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 font-medium">{formatMoney(row.balance)}</span>
                  </li>
                ))}
              </ul>
            )}
            <Link href={collectHref} className="text-sm font-medium text-primary hover:underline">
              Open the invoice list
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Where the jobs are</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <p className="text-sm text-muted-foreground">
              Recent jobs that need a bill, a warehouse check, or a schedule. The salesperson on the account is named so you can follow up.
            </p>
            {OFFICE_LANE_ORDER.map((lane) => (
              <JobLane key={lane} lane={lane} jobs={hub.jobs.filter((job) => job.lane === lane)} />
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Purchase orders</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              {hub.poOpen} ordered
              {hub.poDraft ? `, ${hub.poDraft} still a draft` : ""}
              {hub.poReceived ? `, ${hub.poReceived} received or closed` : ""}. Drafts have not been sent. A received order is ready to match to a supplier bill.
            </p>
            {hub.purchaseOrders.length === 0 ? (
              <p className="text-sm">No purchase order is out with a supplier.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {hub.purchaseOrders.map((row) => (
                  <li key={row.id} className="text-sm">
                    <Link href={`/purchase-orders/${row.id}`} className="font-medium hover:underline">
                      {row.number != null ? formatPoNumber(row.number) : "Draft purchase order"}
                    </Link>
                    <p className="text-muted-foreground">
                      {[row.supplier, row.customerName, row.jobTitle].filter(Boolean).join(" · ") || "Supplier"}
                      {row.backordered ? " · backordered" : ""}
                      {row.eta ? ` · eta ${formatDate(row.eta)}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <Link href="/purchase-orders?view=ordered" className="font-medium text-primary hover:underline">
                Ordered
              </Link>
              <Link href="/purchase-orders?view=draft" className="font-medium text-primary hover:underline">
                Drafts
              </Link>
              <Link href="/purchase-orders?view=received" className="font-medium text-primary hover:underline">
                Received
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bills to pay</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Supplier bills with a balance. This is the same accounts-payable list, shortened to what is still owed.
            </p>
            {hub.bills.length === 0 ? (
              <p className="text-sm">No supplier bill has a balance.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {hub.bills.map((row) => (
                  <li key={row.id} className="flex items-start justify-between gap-3 text-sm">
                    <div>
                      <Link href={`/bills/${row.id}`} className="font-medium hover:underline">
                        {row.number ? `Bill ${row.number}` : "Bill"}
                      </Link>
                      <p className="text-muted-foreground">
                        {row.supplier || "Supplier"}
                        {row.due ? ` · due ${formatDate(row.due)}` : ""}
                        {row.overdue ? " · overdue" : ""}
                      </p>
                    </div>
                    <span className="shrink-0 font-medium">{formatMoney(row.balance)}</span>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/bills" className="text-sm font-medium text-primary hover:underline">
              Open accounts payable
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({
  href,
  label,
  value,
  hint,
}: {
  href: string;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Link href={href} className="rounded-lg border bg-card p-4 transition-colors hover:bg-muted/40">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </Link>
  );
}

function JobLane({ lane, jobs }: { lane: OfficeJobLane; jobs: OfficeJobRow[] }) {
  return (
    <section id={lane === "invoice" ? "write-the-invoice" : undefined} className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{OFFICE_LANE_LABEL[lane]}</h3>
      {jobs.length === 0 ? (
        <p className="text-sm text-muted-foreground">None right now.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {jobs.map((job) => (
            <li key={job.id} className="text-sm">
              <Link href={`/jobs/${job.id}`} className="font-medium hover:underline">
                {job.customerName || job.title}
              </Link>
              <p className="text-muted-foreground">{job.next}</p>
              <p className="text-muted-foreground">
                {job.customerName ? `${job.title}` : "Job"}
                {job.salesperson ? ` · Salesperson: ${job.salesperson}` : " · No salesperson on this account"}
                {job.warehouseStatus
                  ? ` · ${WAREHOUSE_STATUS_LABELS[job.warehouseStatus as WarehouseStatus] ?? job.warehouseStatus}`
                  : ""}
                {job.scheduledDate ? ` · install ${formatDate(job.scheduledDate)}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
