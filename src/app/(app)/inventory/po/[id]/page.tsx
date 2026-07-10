import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Trash2, Boxes } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMoney } from "@/lib/format";
import { ReorderAlerts } from "@/components/reorder-alert";
import { AddStockPOLine } from "./add-line";
import { placeStockPO, removeStockPOLine, receiveStockPOLine } from "../../actions";

export const metadata: Metadata = { title: "Stock PO" };
export const dynamic = "force-dynamic";

export default async function StockPOPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  if (!["admin", "office", "warehouse"].includes(profile.role)) redirect("/");
  const { id } = await params;
  const db = createAdminClient();
  const { data: po } = await db.from("purchase_orders").select("*").eq("id", id).maybeSingle();
  if (!po || !po.is_stock) notFound();
  const { data: itemsRaw } = await db
    .from("po_items")
    .select("*")
    .eq("po_id", id)
    .order("position", { ascending: true });
  const items = itemsRaw ?? [];
  const pids = items.map((i) => i.product_id).filter(Boolean) as string[];
  const prodName = new Map<string, string>();
  const prodKind = new Map<string, string>();
  if (pids.length) {
    const { data: prods } = await db.from("products").select("id, name, manufacturer, color, stock_kind").in("id", pids);
    for (const p of prods ?? []) {
      prodName.set(p.id as string, [p.manufacturer, p.name, p.color].filter(Boolean).join(" ") || (p.name as string));
      prodKind.set(p.id as string, (p.stock_kind as string) || "discrete");
    }
  }
  const status = po.status as string;
  const isDraft = status === "draft";
  const isOrdered = status === "ordered";
  const total = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_cost) || 0), 0);

  return (
    <div className="mx-auto max-w-3xl pb-20">
      <Link href="/inventory" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to inventory
      </Link>
      <PageHeader title="Stock replenishment PO" description="Restock the warehouse — not tied to a customer job.">
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            isDraft ? "bg-muted" : isOrdered ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
          }`}
        >
          {isDraft ? "Draft" : isOrdered ? "On order" : "Received"}
        </span>
      </PageHeader>

      {/* Reorder alert: flag line products we already hold remnants/rolls of. */}
      {items.length ? (
        <div className="mb-4">
          <ReorderAlerts productIds={pids} />
        </div>
      ) : null}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base">Items</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No items yet. Add what you want to restock.</p>
          ) : (
            <ul className="divide-y">
              {items.map((it) => {
                const qty = Number(it.quantity) || 0;
                const received = Number(it.received_qty) || 0;
                const outstanding = Math.max(0, qty - received);
                const rolled = it.product_id ? prodKind.get(it.product_id) === "rolled" : false;
                return (
                  <li key={it.id} className="py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium">{(it.product_id && prodName.get(it.product_id)) || it.description}</div>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {qty} {it.unit} {it.unit_cost ? `· ${formatMoney(Number(it.unit_cost))}/${it.unit}` : ""}
                          {received > 0 ? ` · received ${received}` : ""}
                          {isOrdered && outstanding > 0 ? ` · ${outstanding} still coming` : ""}
                          {received >= qty && qty > 0 ? " · ✓ all in" : ""}
                        </div>
                      </div>
                      {isDraft ? (
                        <form action={removeStockPOLine}>
                          <input type="hidden" name="po_id" value={id} />
                          <input type="hidden" name="item_id" value={it.id} />
                          <Button type="submit" variant="ghost" size="icon-sm" aria-label="Remove">
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </form>
                      ) : null}
                    </div>
                    {isOrdered && outstanding > 0 ? (
                      <form action={receiveStockPOLine} className="mt-2 flex flex-wrap items-end gap-2 rounded-md bg-muted/40 p-2">
                        <input type="hidden" name="po_id" value={id} />
                        <input type="hidden" name="item_id" value={it.id} />
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">Receive</label>
                          <Input name="amount" inputMode="decimal" defaultValue={outstanding} className="h-10 w-24 text-base" />
                        </div>
                        {rolled ? (
                          <>
                            <div>
                              <label className="mb-1 block text-xs text-muted-foreground">Width (ft)</label>
                              <Input name="width_ft" inputMode="decimal" placeholder="12" className="h-10 w-20 text-base" />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-muted-foreground">Location</label>
                              <Input name="location" placeholder="Rack 3, Bay B" className="h-10 w-36 text-base" />
                            </div>
                          </>
                        ) : null}
                        <Button type="submit" size="sm">Receive {it.unit}</Button>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          {isDraft ? <AddStockPOLine poId={id} /> : null}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          Est. total <span className="font-semibold tabular-nums text-foreground">{formatMoney(total)}</span>
        </span>
        {isDraft && items.length > 0 ? (
          <form action={placeStockPO}>
            <input type="hidden" name="po_id" value={id} />
            <Button type="submit">
              <Boxes className="size-4" /> Place order (→ on order)
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
