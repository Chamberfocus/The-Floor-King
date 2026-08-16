import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPriceImport, isSafeToApply } from "@/lib/data/supplier-feeds";
import { ReviewTable } from "./review-table";

export const metadata: Metadata = { title: "Review price import" };
export const dynamic = "force-dynamic";

export default async function PriceImportPage({
  params,
}: {
  params: Promise<{ id: string; importId: string }>;
}) {
  await requireRole(["admin", "office"]);
  const { id, importId } = await params;
  const supabase = await createClient();

  const [{ imp, lines }, { data: supplier }] = await Promise.all([
    getPriceImport(supabase, importId),
    supabase.from("suppliers").select("id, name").eq("id", id).maybeSingle(),
  ]);
  if (!imp || !supplier) notFound();
  // An import belongs to one supplier — don't render it under another's URL.
  if (imp.supplier_id && imp.supplier_id !== id) notFound();

  const readOnly = imp.status !== "draft";
  const safe = lines.filter(isSafeToApply).length;
  const flagged = lines.filter(
    (l) =>
      l.product_id &&
      l.new_cost != null &&
      l.new_cost !== l.old_cost &&
      !isSafeToApply(l),
  ).length;

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href={`/settings/suppliers/${id}/connect`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to {supplier.name}
      </Link>
      <PageHeader
        title={imp.source_name ?? "Price import"}
        description={`From ${supplier.name} · read ${new Date(imp.created_at).toLocaleString()}${
          imp.effective_date ? ` · effective ${imp.effective_date}` : ""
        }`}
      />

      {readOnly ? (
        <div className="mb-6 flex gap-3 rounded-lg border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/40">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
          <div className="text-sm">
            <div className="font-semibold">
              {imp.status === "applied"
                ? `${imp.changed} price${imp.changed === 1 ? "" : "s"} applied`
                : "This import was discarded"}
            </div>
            <p className="mt-1 text-muted-foreground">
              {imp.status === "applied"
                ? `Applied ${imp.applied_at ? new Date(imp.applied_at).toLocaleString() : ""}. Every change is in each product's price history.`
                : "Nothing was changed. It's kept so the record of what they sent stays complete."}
            </p>
          </div>
        </div>
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        {[
          { label: "Items read", value: lines.length },
          { label: "Matched to our catalog", value: imp.matched },
          { label: "Ready to apply", value: safe },
          { label: "Need a look", value: flagged },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="text-2xl font-semibold tabular-nums">{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {imp.unmatched > 0 ? (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
          <strong>{imp.unmatched}</strong> of their items don&apos;t match anything we sell. That is
          normal — they publish their whole catalog. It only matters if something you <em>do</em>{" "}
          stock is in that list, which means its SKU or supplier is wrong in our catalog.
        </p>
      ) : null}

      <ReviewTable
        supplierId={id}
        importId={importId}
        lines={lines}
        readOnly={readOnly}
      />
    </div>
  );
}
