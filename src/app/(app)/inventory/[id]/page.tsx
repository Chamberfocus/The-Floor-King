import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { getProduct, listMovements } from "@/lib/data/inventory";
import { STOCK_MOVEMENT_LABELS, type StockMovementKind } from "@/lib/types";
import { formatMoney, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { receiveStock, pullStock, adjustStock, setStockSettings } from "../actions";

export const metadata: Metadata = { title: "Stock item" };

export default async function InventoryItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireProfile();
  if (!["admin", "office", "warehouse", "sales_manager"].includes(profile.role))
    redirect("/");
  const { id } = await params;
  const product = await getProduct(id);
  if (!product) notFound();
  const movements = await listMovements(id);
  const low = product.reorder_point > 0 && product.on_hand <= product.reorder_point;

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/inventory"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to inventory
      </Link>

      <PageHeader
        title={product.name}
        description={[product.manufacturer, product.sku ? `#${product.sku}` : null]
          .filter(Boolean)
          .join(" · ")}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="py-4">
            <div className="text-xs text-muted-foreground">On hand</div>
            <div className={cn("text-2xl font-bold", low && "text-destructive")}>
              {product.on_hand} {product.unit}
            </div>
            {low ? <div className="text-xs font-medium text-destructive">Low — reorder</div> : null}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-xs text-muted-foreground">Value (at cost)</div>
            <div className="text-2xl font-bold">
              {formatMoney(product.on_hand * (product.material_rate || 0))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-xs text-muted-foreground">Bin</div>
            <div className="text-2xl font-bold">{product.bin_location ?? "—"}</div>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <ActionCard title="Receive" action={receiveStock} id={product.id} field="qty" label="Quantity received" cta="Receive" />
        <ActionCard title="Pull for job" action={pullStock} id={product.id} field="qty" label="Quantity pulled" cta="Pull" jobField />
        <ActionCard title="Set counted total" action={adjustStock} id={product.id} field="counted" label="Counted on hand" cta="Set" />
      </div>

      {/* Settings */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Stock settings</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={setStockSettings} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="product_id" value={product.id} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="track_stock" defaultChecked={product.track_stock} className="size-4" />
              Track this product
            </label>
            <div>
              <Label htmlFor="reorder_point">Reorder at</Label>
              <Input id="reorder_point" name="reorder_point" type="number" step="0.01" min="0" defaultValue={product.reorder_point} className="w-24" />
            </div>
            <div>
              <Label htmlFor="bin_location">Bin</Label>
              <Input id="bin_location" name="bin_location" defaultValue={product.bin_location ?? ""} className="w-28" />
            </div>
            <Button type="submit" variant="outline">Save</Button>
          </form>
        </CardContent>
      </Card>

      {/* History */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Movement history</CardTitle>
        </CardHeader>
        <CardContent>
          {movements.length === 0 ? (
            <p className="text-sm text-muted-foreground">No movements yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {movements.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <span className="font-medium">
                      {STOCK_MOVEMENT_LABELS[m.kind as StockMovementKind] ?? m.kind}
                    </span>
                    {m.note ? <span className="text-muted-foreground"> — {m.note}</span> : null}
                    <div className="text-xs text-muted-foreground">{formatDate(m.created_at)}</div>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 font-medium tabular-nums",
                      m.qty >= 0 ? "text-emerald-600" : "text-destructive",
                    )}
                  >
                    {m.qty >= 0 ? "+" : ""}
                    {m.qty} {product.unit}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ActionCard({
  title,
  action,
  id,
  field,
  label,
  cta,
  jobField,
}: {
  title: string;
  action: (formData: FormData) => void | Promise<void>;
  id: string;
  field: string;
  label: string;
  cta: string;
  jobField?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-2">
          <input type="hidden" name="product_id" value={id} />
          <div>
            <Label htmlFor={`${title}-${field}`}>{label}</Label>
            <Input id={`${title}-${field}`} name={field} type="number" step="0.01" min="0" />
          </div>
          {jobField ? (
            <div>
              <Label htmlFor={`${title}-job`}>Job ID (optional)</Label>
              <Input id={`${title}-job`} name="job_id" placeholder="link to a job" />
            </div>
          ) : null}
          <Input name="note" placeholder="Note (optional)" />
          <Button type="submit" className="w-full">{cta}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
