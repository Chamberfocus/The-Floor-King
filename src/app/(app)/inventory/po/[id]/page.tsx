import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMoney } from "@/lib/format";
import { ReorderAlerts } from "@/components/reorder-alert";
import { StockPoEditor, type InitialItem } from "./stock-po-editor";
import { receiveStockPOLine, deleteStockPO } from "../../actions";

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
  const prodUnit = new Map<string, string>();
  if (pids.length) {
    const { data: prods } = await db
      .from("products")
      .select("id, name, manufacturer, color, unit, stock_kind")
      .in("id", pids);
    for (const p of prods ?? []) {
      prodName.set(
        p.id as string,
        [p.manufacturer, p.name, p.color].filter(Boolean).join(" ") || (p.name as string),
      );
      prodKind.set(p.id as string, (p.stock_kind as string) || "discrete");
      prodUnit.set(p.id as string, (p.unit as string) || "each");
    }
  }
  const status = po.status as string;
  const isDraft = status === "draft";
  const isOrdered = status === "ordered";
  const total = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_cost) || 0), 0);

  const StatusPill = (
    <span
      className={`rounded-full px-3 py-1 text-xs font-semibold ${
        isDraft
          ? "bg-muted"
          : isOrdered
            ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
            : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
      }`}
    >
      {isDraft ? "Draft" : isOrdered ? "On order" : "Received"}
    </span>
  );

  return (
    <div className="mx-auto max-w-3xl pb-20">
      <Link
        href="/inventory"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to inventory
      </Link>
      <PageHeader
        title="Stock replenishment PO"
        description="Restock the warehouse — not tied to a customer job."
      >
        {StatusPill}
      </PageHeader>

      {isDraft ? (
        <StockPoEditor
          poId={id}
          initialSupplier={(po.supplier as string) ?? ""}
          initialItems={items.map(
            (it): InitialItem => ({
              id: it.id as string,
              product_id: (it.product_id as string) ?? "",
              label: (it.product_id && prodName.get(it.product_id)) || (it.description as string) || "",
              description: (it.description as string) ?? "",
              quantity: it.quantity != null ? String(it.quantity) : "",
              unit: (it.unit as string) || prodUnit.get(it.product_id as string) || "each",
              unit_cost: it.unit_cost != null ? String(it.unit_cost) : "",
            }),
          )}
        />
      ) : (
        <>
          {/* Flag line products we already hold usable remnants/rolls of. */}
          {items.length ? (
            <div className="mb-4">
              <ReorderAlerts productIds={pids} />
            </div>
          ) : null}

          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="text-base">
                {isOrdered ? "Receive stock as it arrives" : "Received items"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ul className="divide-y">
                {items.map((it) => {
                  const qty = Number(it.quantity) || 0;
                  const received = Number(it.received_qty) || 0;
                  const outstanding = Math.max(0, qty - received);
                  const rolled = it.product_id ? prodKind.get(it.product_id) === "rolled" : false;
                  return (
                    <li key={it.id} className="py-3">
                      <div className="min-w-0">
                        <div className="font-medium">
                          {(it.product_id && prodName.get(it.product_id)) || it.description}
                        </div>
                        <div className="text-xs tabular-nums text-muted-foreground">
                          {qty} {it.unit}
                          {it.unit_cost ? ` · ${formatMoney(Number(it.unit_cost))}/${it.unit}` : ""}
                          {received > 0 ? ` · received ${received}` : ""}
                          {isOrdered && outstanding > 0 ? ` · ${outstanding} still coming` : ""}
                          {received >= qty && qty > 0 ? " · ✓ all in" : ""}
                        </div>
                      </div>
                      {isOrdered && outstanding > 0 ? (
                        <form
                          action={receiveStockPOLine}
                          className="mt-2 flex flex-wrap items-end gap-2 rounded-md bg-muted/40 p-2"
                        >
                          <input type="hidden" name="po_id" value={id} />
                          <input type="hidden" name="item_id" value={it.id} />
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">Receive</label>
                            <Input
                              name="amount"
                              inputMode="decimal"
                              defaultValue={outstanding}
                              className="h-11 w-24 text-base"
                            />
                          </div>
                          {rolled ? (
                            <>
                              <div>
                                <label className="mb-1 block text-xs text-muted-foreground">Width (ft)</label>
                                <Input name="width_ft" inputMode="decimal" placeholder="12" className="h-11 w-20 text-base" />
                              </div>
                              <div>
                                <label className="mb-1 block text-xs text-muted-foreground">Location</label>
                                <Input name="location" placeholder="Rack 3, Bay B" className="h-11 w-36 text-base" />
                              </div>
                            </>
                          ) : null}
                          <Button type="submit" size="sm" className="h-11">
                            Receive {it.unit}
                          </Button>
                        </form>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              PO total{" "}
              <span className="font-semibold tabular-nums text-foreground">{formatMoney(total)}</span>
            </span>
          </div>
        </>
      )}

      {/* Delete — undoes any on-order / received stock this PO added. */}
      <form action={deleteStockPO} className="mt-8 flex justify-end border-t pt-4">
        <input type="hidden" name="po_id" value={id} />
        <ConfirmButton
          variant="destructive"
          size="sm"
          title="Delete this stock purchase order?"
          description="Reverses any on-order and received stock this PO added, removes rolls/remnants it created, then deletes it. This can't be undone."
          confirmLabel="Delete PO"
          destructive
        >
          <Trash2 className="size-3.5" /> Delete this PO
        </ConfirmButton>
      </form>
    </div>
  );
}
