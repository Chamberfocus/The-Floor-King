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
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { getProduct, listMovements } from "@/lib/data/inventory";
import { listRolls } from "@/lib/data/stock-rolls";
import { STOCK_MOVEMENT_LABELS } from "@/lib/types";
import { formatMoney, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  receiveStock,
  pullStock,
  adjustStock,
  setStockSettings,
  setClearance,
  receiveRoll,
  pullRoll,
  shelveRoll,
  setRemnantUsable,
  countRoll,
} from "../actions";

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
  const rolled = product.stock_kind === "rolled";
  const rolls = rolled ? await listRolls(id) : [];
  const liveRolls = rolls.filter((r) => r.status === "available");
  const onOrder = product.on_order ?? 0;
  const reserved = Number(product.reserved) || 0;
  const available = Math.max(0, product.on_hand - reserved);
  const showCost = profile.role === "admin" || profile.role === "office";
  const avgCost = product.avg_unit_cost != null ? Number(product.avg_unit_cost) : null;
  const inventoryValue =
    avgCost != null
      ? product.on_hand * avgCost
      : product.on_hand * (product.material_rate || 0);

  return (
    <div className="mx-auto max-w-4xl">
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
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              In stock {rolled ? <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">rolled</span> : null}
            </div>
            <div className={cn("text-2xl font-bold", low && "text-destructive")}>
              {product.on_hand} {product.unit}
            </div>
            <div className="text-xs text-muted-foreground">
              reserved {reserved} · available {available}
            </div>
            {rolled ? (
              <div className="text-xs text-muted-foreground">
                {liveRolls.filter((r) => r.kind === "roll").length} roll(s) · {liveRolls.filter((r) => r.kind === "remnant").length} remnant(s)
              </div>
            ) : null}
            {low ? <div className="text-xs font-medium text-destructive">Low — reorder</div> : null}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-xs text-muted-foreground">On order</div>
            <div className="text-2xl font-bold">
              {onOrder} {onOrder ? product.unit : ""}
            </div>
            {showCost ? (
              <div className="text-xs text-muted-foreground">
                value {formatMoney(inventoryValue)}
                {avgCost != null ? ` · avg ${formatMoney(avgCost)}` : ""}
              </div>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-xs text-muted-foreground">Bin / location</div>
            <div className="text-2xl font-bold">{product.bin_location ?? "—"}</div>
          </CardContent>
        </Card>
      </div>

      {/* Actions — discrete items count in whole units; rolled goods are per-roll. */}
      {!rolled ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <ActionCard title="Receive" action={receiveStock} id={product.id} field="qty" label="Quantity received" cta="Receive"
            confirmTitle={`Receive stock for ${product.name}?`}
            confirmDescription="Adds the entered quantity to on-hand inventory." />
          <ActionCard title="Pull for job" action={pullStock} id={product.id} field="qty" label="Quantity pulled" cta="Pull" jobField />
          <ActionCard title="Set counted total" action={adjustStock} id={product.id} field="counted" label="Counted on hand" cta="Set"
            confirmTitle={`Adjust on-hand for ${product.name}?`}
            confirmDescription="Overwrites the on-hand quantity to the counted total you entered." />
        </div>
      ) : (
        <Card className="mt-4">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Rolls &amp; remnants</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Receive a new roll */}
            <form action={receiveRoll} className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-2.5">
              <input type="hidden" name="product_id" value={product.id} />
              <div>
                <Label htmlFor="rr-qty">Receive roll</Label>
                <Input id="rr-qty" name="qty" type="number" step="0.01" min="0" placeholder="yardage" className="w-28" />
              </div>
              <div>
                <Label htmlFor="rr-unit">Unit</Label>
                <select id="rr-unit" name="unit" defaultValue={product.unit?.includes("yd") ? "sqyd" : product.unit === "lnft" ? "lnft" : "sqyd"} className="h-10 rounded-md border border-input bg-transparent px-2 text-sm">
                  <option value="sqyd">sq yd</option>
                  <option value="lnft">ln ft</option>
                </select>
              </div>
              <div>
                <Label htmlFor="rr-w">Width (ft)</Label>
                <Input id="rr-w" name="width_ft" type="number" step="0.01" min="0" placeholder="12" className="w-20" />
              </div>
              <div>
                <Label htmlFor="rr-loc">Location</Label>
                <Input id="rr-loc" name="location" placeholder="Rack 3, Bay B" className="w-36" />
              </div>
              <Button type="submit" variant="outline">Add roll</Button>
            </form>

            {liveRolls.length === 0 ? (
              <p className="text-sm text-muted-foreground">No rolls or remnants on hand.</p>
            ) : (
              <ul className="space-y-2">
                {liveRolls.map((r) => (
                  <li key={r.id} className={cn("rounded-md border p-2.5", r.kind === "remnant" && "border-amber-300 bg-amber-50/40 dark:bg-amber-500/5")}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm">
                        <span className="font-semibold tabular-nums">{r.remaining_qty} {r.unit}</span>{" "}
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">{r.kind === "remnant" ? "Remnant" : "Roll"}</span>
                        {r.needs_shelving ? <span className="ml-1 rounded-full bg-amber-200 px-2 py-0.5 text-xs font-medium text-amber-800">needs shelving</span> : null}
                        {r.width_ft ? <span className="ml-1 text-xs text-muted-foreground">{r.width_ft}ft wide</span> : null}
                        <span className="ml-1 text-xs text-muted-foreground">📍 {r.location || "no location"}</span>
                        {r.kind === "remnant" && r.usable === true ? <span className="ml-1 text-xs font-medium text-emerald-600">usable</span> : null}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      {/* Cut / pull */}
                      <form action={pullRoll} className="flex items-end gap-1">
                        <input type="hidden" name="roll_id" value={r.id} />
                        <div>
                          <Label className="text-[11px]">Cut</Label>
                          <Input name="cut" type="number" step="0.01" min="0" placeholder="0" className="h-9 w-20 text-sm" />
                        </div>
                        <div>
                          <Label className="text-[11px]">Offcut→remnant</Label>
                          <Input name="offcut" type="number" step="0.01" min="0" placeholder="0" className="h-9 w-24 text-sm" />
                        </div>
                        <Input name="job_id" placeholder="job id" className="h-9 w-24 text-sm" />
                        <Button type="submit" size="sm" variant="outline">Cut</Button>
                      </form>
                      {/* Location / shelve */}
                      <form action={shelveRoll} className="flex items-end gap-1">
                        <input type="hidden" name="roll_id" value={r.id} />
                        <Input name="location" defaultValue={r.location ?? ""} placeholder="location" className="h-9 w-32 text-sm" />
                        <Button type="submit" size="sm" variant="ghost">Locate</Button>
                      </form>
                      {/* Count */}
                      <form action={countRoll} className="flex items-end gap-1">
                        <input type="hidden" name="roll_id" value={r.id} />
                        <Input name="counted" type="number" step="0.01" min="0" placeholder="count" className="h-9 w-20 text-sm" />
                        <Button type="submit" size="sm" variant="ghost">Set</Button>
                      </form>
                      {/* Reusability (remnants) */}
                      {r.kind === "remnant" ? (
                        <div className="flex items-end gap-1">
                          {(["usable", "not", "scrap"] as const).map((call) => (
                            <form key={call} action={setRemnantUsable}>
                              <input type="hidden" name="roll_id" value={r.id} />
                              <input type="hidden" name="call" value={call} />
                              {call === "scrap" ? <input type="hidden" name="reason" value="Not worth keeping" /> : null}
                              {call === "scrap" ? (
                                <ConfirmButton
                                  size="sm"
                                  variant="ghost"
                                  title="Scrap this remnant?"
                                  description="Marks the remnant scrapped and removes its remaining yardage from on-hand stock. This can't be undone."
                                  confirmLabel="Scrap"
                                  destructive
                                >
                                  Scrap
                                </ConfirmButton>
                              ) : (
                                <Button type="submit" size="sm" variant={call === "usable" ? "outline" : "ghost"}>
                                  {call === "usable" ? "Usable" : "Not usable"}
                                </Button>
                              )}
                            </form>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

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
              <Label htmlFor="stock_kind">Type</Label>
              <select id="stock_kind" name="stock_kind" defaultValue={product.stock_kind ?? "discrete"} className="h-10 rounded-md border border-input bg-transparent px-2 text-sm">
                <option value="discrete">Discrete (count units)</option>
                <option value="rolled">Rolled / measured (yardage)</option>
              </select>
            </div>
            <div>
              <Label htmlFor="reorder_point">Reorder at</Label>
              <Input id="reorder_point" name="reorder_point" type="number" step="0.01" min="0" defaultValue={product.reorder_point} className="w-24" />
            </div>
            <div>
              <Label htmlFor="bin_location">Bin</Label>
              <Input id="bin_location" name="bin_location" defaultValue={product.bin_location ?? ""} className="w-28" />
            </div>
            <div>
              <Label htmlFor="stocked_since">In stock since</Label>
              <DateField
                id="stocked_since"
                name="stocked_since"
                defaultValue={product.last_movement_at?.slice(0, 10) ?? ""}
                className="w-36"
              />
            </div>
            <Button type="submit" variant="outline">Save</Button>
          </form>
        </CardContent>
      </Card>

      {/* Clearance */}
      <Card className="mt-4 border-amber-300 bg-amber-50/40 dark:bg-amber-500/5">
        <CardHeader>
          <CardTitle className="text-base">Clearance deal</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={setClearance} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="product_id" value={product.id} />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="clearance"
                defaultChecked={product.clearance}
                className="size-4"
              />
              On clearance
            </label>
            <div>
              <Label htmlFor="clearance_price">Deal price (per {product.unit})</Label>
              <Input
                id="clearance_price"
                name="clearance_price"
                type="number"
                step="0.01"
                min="0"
                defaultValue={product.clearance_price ?? ""}
                className="w-28"
              />
            </div>
            <Button type="submit" variant="outline">Save deal</Button>
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
                      {STOCK_MOVEMENT_LABELS[m.kind] ?? m.kind}
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
  confirmTitle,
  confirmDescription,
}: {
  title: string;
  action: (formData: FormData) => void | Promise<void>;
  id: string;
  field: string;
  label: string;
  cta: string;
  jobField?: boolean;
  /** When set, the CTA opens an "are you sure?" gate before submitting. */
  confirmTitle?: string;
  confirmDescription?: string;
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
          {confirmTitle ? (
            <ConfirmButton
              className="w-full"
              title={confirmTitle}
              description={confirmDescription}
              confirmLabel={cta}
            >
              {cta}
            </ConfirmButton>
          ) : (
            <Button type="submit" className="w-full">{cta}</Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
