import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Plug, AlertTriangle, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getOrgSettings } from "@/lib/data/org";
import {
  FCB2B_DOCUMENTS,
  FCB2B_SERVICES,
  FCB2B_REQUEST_PARAMS,
  ONBOARDING_ASKS,
} from "@/lib/fcb2b";
import { getSupplierFeed, listPriceImports } from "@/lib/data/supplier-feeds";
import { CopyBrief } from "./copy-brief";
import { ConnectionForm } from "./connection-form";

export const metadata: Metadata = { title: "Connect supplier" };
export const dynamic = "force-dynamic";

export default async function SupplierConnectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(["admin", "office"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data: supplier } = await supabase
    .from("suppliers")
    .select("id, name, account_number, contact_name, email, phone")
    .eq("id", id)
    .maybeSingle();
  if (!supplier) notFound();

  const org = await getOrgSettings();

  // Can a feed from this supplier actually change anything? A price catalog
  // matches on SKU within that supplier's own products — so products that
  // aren't attributed to them are invisible to it.
  const [{ count: linked }, { count: linkedSku }, { count: allProducts }] =
    await Promise.all([
      supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("supplier_id", id),
      supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("supplier_id", id)
        .not("sku", "is", null),
      supabase.from("products").select("id", { count: "exact", head: true }),
    ]);

  const ready = (linkedSku ?? 0) > 0;

  const [feed, imports] = await Promise.all([
    getSupplierFeed(supabase, id),
    listPriceImports(supabase, id, 8),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href={`/settings/suppliers/${id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to {supplier.name}
      </Link>
      <PageHeader
        title={`Connect ${supplier.name}`}
        description="Everything needed to set up an automatic price feed — and the brief to send them."
      />

      {/* The prerequisite, stated before anything else. */}
      <div
        className={
          ready
            ? "mb-6 flex gap-3 rounded-lg border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/40"
            : "mb-6 flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40"
        }
      >
        {ready ? (
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
        ) : (
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
        )}
        <div className="text-sm">
          <div className="font-semibold">
            {ready
              ? `${linkedSku} products ready to receive prices`
              : "No products are attributed to this supplier yet"}
          </div>
          <p className="mt-1 text-muted-foreground">
            A price catalog updates by matching the supplier&apos;s SKU against
            products marked as theirs.{" "}
            {ready ? (
              <>
                {linked} of your {allProducts} products are linked to{" "}
                {supplier.name}, and {linkedSku} of those carry a SKU.
              </>
            ) : (
              <>
                None of your {allProducts} products are linked to {supplier.name},
                so a feed from them would match nothing and change nothing.
                Attribute their products first — the SKU is already on most of
                the catalog, it&apos;s the supplier link that&apos;s missing.
              </>
            )}
          </p>
        </div>
      </div>

      <ConnectionForm
        supplierId={id}
        supplierName={supplier.name}
        feed={feed}
        linkedWithSku={linkedSku ?? 0}
      />

      {/* Price runs, newest first — the record of what this feed has done. */}
      {imports.length ? (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Price imports</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {imports.map((imp) => (
              <Link
                key={imp.id}
                href={`/settings/suppliers/${id}/imports/${imp.id}`}
                className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-primary"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{imp.source_name ?? "Price import"}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(imp.created_at).toLocaleDateString()} · {imp.matched} matched ·{" "}
                    {imp.unmatched} unmatched
                  </div>
                </div>
                <span
                  className={
                    imp.status === "applied"
                      ? "shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                      : imp.status === "discarded"
                        ? "shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                        : "shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                  }
                >
                  {imp.status === "applied"
                    ? `${imp.changed} applied`
                    : imp.status === "discarded"
                      ? "discarded"
                      : "needs review"}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* The brief to send them */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Plug className="size-4 text-primary" /> Send this to {supplier.name}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Copy this and send it to their EDI or IT contact — not the sales rep.
            It asks for exactly what&apos;s needed and nothing else.
          </p>
          <CopyBrief
            company={org.company_name || "Cleveland Floor King"}
            supplier={supplier.name}
            accountNumber={supplier.account_number ?? null}
            contactEmail={org.email ?? null}
            contactPhone={org.phone ?? null}
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">The six fcB2B documents</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {FCB2B_DOCUMENTS.map((d) => (
              <div key={d.code} className="text-sm">
                <span className="font-mono font-semibold">{d.code}</span>{" "}
                <span className="font-medium">{d.name}</span>
                <p className="text-xs text-muted-foreground">{d.why}</p>
              </div>
            ))}
            <p className="border-t pt-3 text-xs text-muted-foreground">
              Only the <span className="font-mono">832</span> is needed for price
              updates. The rest are worth asking about while you have their
              attention — 855 and 856 are what remove guesswork about whether an
              order was accepted and what actually shipped.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Web services, if they offer them
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {FCB2B_SERVICES.map((sv) => (
              <div key={sv.path} className="text-sm">
                <span className="font-mono text-xs">{sv.path}</span>{" "}
                <span className="font-medium">{sv.name}</span>
                <p className="text-xs text-muted-foreground">{sv.why}</p>
              </div>
            ))}
            <div className="border-t pt-3">
              <p className="mb-1.5 text-xs font-semibold">
                Every request carries four parameters:
              </p>
              {FCB2B_REQUEST_PARAMS.map((p) => (
                <p key={p.name} className="text-xs text-muted-foreground">
                  <span className="font-mono text-foreground">{p.name}</span> —{" "}
                  {p.meaning}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            What to get back before switching anything on
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {ONBOARDING_ASKS.map((a) => (
            <div key={a.q} className="text-sm">
              <div className="font-medium">{a.q}</div>
              <p className="text-xs text-muted-foreground">{a.detail}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
