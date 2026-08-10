import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Phone, Mail, MapPin, FileText, Plug } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { requireProfile } from "@/lib/auth";
import { getSupplier } from "@/lib/data/suppliers";
import { getVendorSummary } from "@/lib/data/purchase-orders";
import {
  SUPPLIER_KIND_LABELS,
  PO_STATUS_LABELS,
  PO_STATUS_BADGE,
  formatPoNumber,
} from "@/lib/types";
import { formatMoney, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Vendor" };
export const dynamic = "force-dynamic";

const lineTotal = (items: { quantity: number | null; unit_cost: number | null }[]) =>
  items.reduce((s, it) => s + (it.quantity ?? 0) * (it.unit_cost ?? 0), 0);

export default async function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/");
  const { id } = await params;
  const vendor = await getSupplier(id);
  if (!vendor) notFound();
  const { pos, totalSpend, openCount, openTotal } = await getVendorSummary(id);

  const contact = [
    vendor.contact_name,
    vendor.account_number ? `Acct ${vendor.account_number}` : null,
    vendor.payment_terms,
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/settings/suppliers"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Vendors
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <PageHeader title={vendor.name} description={SUPPLIER_KIND_LABELS[vendor.kind]} />
        {vendor.active === false ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            Inactive
          </span>
        ) : null}
        <Link
          href={`/settings/suppliers/${vendor.id}/connect`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <Plug className="size-4" /> Connect price feed
        </Link>
      </div>

      {/* Contact + terms */}
      <Card className="mb-4">
        <CardContent className="grid grid-cols-1 gap-x-6 gap-y-2 pt-6 text-sm sm:grid-cols-2">
          {contact.length ? (
            <div className="sm:col-span-2 font-medium">{contact.join(" · ")}</div>
          ) : null}
          {vendor.phone ? (
            <a href={`tel:${vendor.phone}`} className="inline-flex items-center gap-2 hover:text-primary">
              <Phone className="size-4 text-muted-foreground" /> {vendor.phone}
            </a>
          ) : null}
          {vendor.email ? (
            <a href={`mailto:${vendor.email}`} className="inline-flex items-center gap-2 hover:text-primary">
              <Mail className="size-4 text-muted-foreground" /> {vendor.email}
            </a>
          ) : null}
          {vendor.address ? (
            <div className="inline-flex items-center gap-2 sm:col-span-2">
              <MapPin className="size-4 text-muted-foreground" /> {vendor.address}
            </div>
          ) : null}
          {vendor.notes ? (
            <div className="text-muted-foreground sm:col-span-2">{vendor.notes}</div>
          ) : null}
          {!contact.length && !vendor.phone && !vendor.email && !vendor.address ? (
            <div className="text-muted-foreground">
              No contact details yet — add them from the Vendors list.
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Financials */}
      <div className="mb-5 grid grid-cols-3 gap-3">
        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">Total spend</div>
          <div className="text-xl font-semibold tabular-nums">{formatMoney(totalSpend)}</div>
          <div className="text-xs text-muted-foreground">issued, non-void</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">Open POs</div>
          <div className="text-xl font-semibold tabular-nums">{openCount}</div>
          <div className="text-xs text-muted-foreground">not yet closed</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">Outstanding</div>
          <div className="text-xl font-semibold tabular-nums">{formatMoney(openTotal)}</div>
          <div className="text-xs text-muted-foreground">open PO value</div>
        </div>
      </div>

      <h2 className="mb-2 text-sm font-semibold">Purchase orders</h2>
      {pos.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No purchase orders yet"
          description="POs you issue to this vendor will show here with their number, status, and total."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">PO #</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {pos.map((po) => (
                <tr key={po.id} className="hover:bg-muted/40">
                  <td className="px-3 py-2">
                    <Link href={`/purchase-orders/${po.id}`} className="font-medium hover:underline">
                      {formatPoNumber(po.po_number)}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{formatDate(po.created_at)}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        PO_STATUS_BADGE[po.status],
                      )}
                    >
                      {PO_STATUS_LABELS[po.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatMoney(lineTotal(po.items ?? []))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
