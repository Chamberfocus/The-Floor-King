import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Boxes, AlertTriangle, DollarSign, Tag } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import {
  listInventory,
  inventorySummary,
  listAgedStock,
  daysIdle,
  AGED_DAYS,
} from "@/lib/data/inventory";
import { newRemnants, searchStock, listStockPOs } from "@/lib/data/stock-rolls";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMoney, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { receiveStock, adjustStock, setClearance, createStockPO, deleteStockPO } from "./actions";
import { AddToInventoryForm } from "./add-to-inventory";
import { Trash2, FileText } from "lucide-react";

export const metadata: Metadata = { title: "Inventory" };
export const dynamic = "force-dynamic";

const cell =
  "h-8 w-20 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const profile = await requireProfile();
  if (!["admin", "office", "warehouse", "sales_manager"].includes(profile.role))
    redirect("/");
  const q = (await searchParams).q?.trim() ?? "";

  const canStockPO = ["admin", "office", "warehouse"].includes(profile.role);
  const canSeeCost = ["admin", "office", "sales_manager"].includes(profile.role);
  const [items, summary, aged, remnantsToShelve, locHits, stockPOs] = await Promise.all([
    listInventory(q),
    canSeeCost
      ? inventorySummary()
      : Promise.resolve({ trackedCount: 0, lowStockCount: 0, totalValue: 0 }),
    listAgedStock(),
    newRemnants(),
    q ? searchStock(q) : Promise.resolve([]),
    canStockPO ? listStockPOs(createAdminClient()) : Promise.resolve([]),
  ]);

  // Warehouse sees qty ops only — never inventory $ value (F7 / 0176 cost firewall).
  const opsSummary = canSeeCost
    ? summary
    : {
        trackedCount: items.length,
        lowStockCount: items.filter(
          (p) => p.reorder_point > 0 && p.on_hand <= p.reorder_point,
        ).length,
        totalValue: 0,
      };

  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Track what's in stock, receive deliveries, and pull material for jobs."
      >
        <form action={createStockPO}>
          <Button type="submit">
            <Boxes className="size-4" /> New stock PO
          </Button>
        </form>
      </PageHeader>

      {/* New remnants awaiting a location + reusability call */}
      {remnantsToShelve.length > 0 ? (
        <Card className="mb-6 border-amber-400 bg-amber-50 dark:border-amber-500/50 dark:bg-amber-950/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-amber-800 dark:text-amber-300">
              <AlertTriangle className="size-4" /> New remnants to shelve ({remnantsToShelve.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {remnantsToShelve.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium">{r.product_name}</span>{" "}
                    <span className="tabular-nums text-muted-foreground">{r.remaining_qty} {r.unit}</span>
                    <span className="ml-1 text-xs text-muted-foreground">· cut {formatDate(r.created_at)}</span>
                  </span>
                  <Link href={`/inventory/${r.product_id}`} className="text-sm font-medium text-primary hover:underline">
                    Give location & mark usable →
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* Stock replenishment POs — open + recent, with a way to delete them. */}
      {stockPOs.length > 0 ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="size-4 text-muted-foreground" /> Stock replenishment POs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {stockPOs.map((po) => {
                const label =
                  po.status === "draft"
                    ? "Draft"
                    : po.status === "ordered"
                      ? "On order"
                      : po.status === "received"
                        ? "Received"
                        : po.status;
                return (
                  <li key={po.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <Link href={`/inventory/po/${po.id}`} className="min-w-0 hover:underline">
                      <span className="font-medium">{po.supplier || "Stock PO"}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {po.item_count} item{po.item_count === 1 ? "" : "s"}
                        {po.total > 0 ? ` · ${formatMoney(po.total)}` : ""} · {formatDate(po.created_at)}
                      </span>
                    </Link>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-semibold",
                          po.status === "draft"
                            ? "bg-muted"
                            : po.status === "ordered"
                              ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                              : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
                        )}
                      >
                        {label}
                      </span>
                      <form action={deleteStockPO}>
                        <input type="hidden" name="po_id" value={po.id} />
                        <Button type="submit" variant="ghost" size="icon-sm" aria-label="Delete PO">
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <SummaryCard icon={Boxes} tint="bg-zinc-200 text-zinc-700" label="Tracked items" value={opsSummary.trackedCount} />
        <SummaryCard
          icon={AlertTriangle}
          tint="bg-red-100 text-red-600"
          label="Low / out of stock"
          value={opsSummary.lowStockCount}
        />
        {canSeeCost ? (
          <SummaryCard
            icon={DollarSign}
            tint="bg-emerald-100 text-emerald-600"
            label="Inventory value (at cost)"
            value={formatMoney(opsSummary.totalValue)}
          />
        ) : (
          <SummaryCard
            icon={Boxes}
            tint="bg-zinc-200 text-zinc-700"
            label="On-hand focus"
            value="Qty only"
          />
        )}
      </div>

      {aged.length > 0 ? (
        <Card className="mb-6 border-amber-300 bg-amber-50/50 dark:bg-amber-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Tag className="size-4 text-amber-600" />
              Aged stock — sitting {AGED_DAYS}+ days ({aged.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">
              Slow movers. Set a clearance deal price and reps will see it in
              quotes.
            </p>
            <ul className="divide-y">
              {aged.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/inventory/${p.id}`}
                      className="font-medium hover:underline"
                    >
                      {p.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {p.on_hand} {p.unit} · idle {daysIdle(p)} days
                      {p.clearance && p.clearance_price != null
                        ? ` · clearance ${formatMoney(p.clearance_price)}`
                        : ""}
                    </div>
                  </div>
                  {p.clearance ? (
                    <form action={setClearance} className="flex items-center gap-1">
                      <input type="hidden" name="product_id" value={p.id} />
                      <span className="rounded bg-amber-200 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                        On clearance
                      </span>
                      <Button type="submit" size="sm" variant="ghost">
                        Remove
                      </Button>
                    </form>
                  ) : (
                    <form action={setClearance} className="flex items-center gap-1">
                      <input type="hidden" name="product_id" value={p.id} />
                      <input type="hidden" name="clearance" value="on" />
                      <span className="text-xs text-muted-foreground">$</span>
                      <input
                        name="clearance_price"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="deal price"
                        required
                        className={cell.replace("w-20", "w-24")}
                      />
                      <Button type="submit" size="sm" variant="outline">
                        Mark clearance
                      </Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <form method="get" className="mb-4 flex max-w-sm gap-2">
        <Input name="q" defaultValue={q} placeholder="Search product or location…" />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      {/* Location search — rolls/remnants matching the product or a location. */}
      {q && locHits.length > 0 ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-base">Rolls &amp; remnants matching &ldquo;{q}&rdquo; ({locHits.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {locHits.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium">{r.product_name}</span>{" "}
                    <span className="tabular-nums text-muted-foreground">{r.remaining_qty} {r.unit}</span>{" "}
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs">{r.kind}</span>
                    <span className="ml-1 text-xs text-muted-foreground">📍 {r.location || "no location"}</span>
                  </span>
                  <Link href={`/inventory/${r.product_id}`} className="text-primary hover:underline">Open</Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title={q ? `No tracked stock matches "${q}".` : "No tracked stock yet"}
          description={q ? undefined : "Add a product below to start tracking stock."}
        />
      ) : (
        <>
        {/* Phone: cards */}
        <div className="space-y-2 md:hidden">
          {items.map((p) => {
            const low = p.reorder_point > 0 && p.on_hand <= p.reorder_point;
            return (
              <div key={p.id} className={cn("rounded-lg border p-3", low && "bg-destructive/5")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/inventory/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                    {p.clearance ? (
                      <span className="ml-1.5 rounded bg-amber-200 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                        Clearance
                      </span>
                    ) : null}
                    <div className="text-xs text-muted-foreground">
                      {[p.manufacturer, p.sku ? `#${p.sku}` : null, p.bin_location ? `Bin ${p.bin_location}` : null].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={cn("font-medium tabular-nums", low && "text-destructive")}>
                      {p.on_hand} {p.unit}
                    </div>
                    {low ? <div className="text-xs font-medium text-destructive">low</div> : null}
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                  <span>Reorder at {p.reorder_point || "—"}</span>
                  {canSeeCost ? (
                    <span>Value {formatMoney(p.on_hand * (p.material_rate || 0))}</span>
                  ) : null}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <form action={receiveStock} className="flex items-center gap-1">
                    <input type="hidden" name="product_id" value={p.id} />
                    <input name="qty" type="number" step="0.01" min="0" placeholder="+ qty" className={cn(cell, "w-20")} />
                    <Button type="submit" size="sm" variant="outline">Receive</Button>
                  </form>
                  <form action={adjustStock} className="flex items-center gap-1">
                    <input type="hidden" name="product_id" value={p.id} />
                    <input name="counted" type="number" step="0.01" min="0" placeholder="count" className={cn(cell, "w-20")} />
                    <Button type="submit" size="sm" variant="ghost">Set</Button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
        {/* Larger screens: table */}
        <div className="hidden overflow-x-auto rounded-lg border md:block">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Product</th>
                <th className="px-3 py-2 text-left">Bin</th>
                <th className="px-3 py-2 text-right">On hand</th>
                <th className="px-3 py-2 text-right">Reorder</th>
                {canSeeCost ? (
                  <th className="px-3 py-2 text-right">Value</th>
                ) : null}
                <th className="px-3 py-2 text-left">Receive</th>
                <th className="px-3 py-2 text-left">Set count</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((p) => {
                const low = p.reorder_point > 0 && p.on_hand <= p.reorder_point;
                return (
                  <tr key={p.id} className={low ? "bg-destructive/5" : ""}>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5">
                        <Link href={`/inventory/${p.id}`} className="font-medium hover:underline">
                          {p.name}
                        </Link>
                        {p.clearance ? (
                          <span className="rounded bg-amber-200 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                            Clearance
                          </span>
                        ) : null}
                      </span>
                      <div className="text-xs text-muted-foreground">
                        {[p.manufacturer, p.sku ? `#${p.sku}` : null].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{p.bin_location ?? "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <span className={cn("font-medium tabular-nums", low && "text-destructive")}>
                        {p.on_hand} {p.unit}
                      </span>
                      {low ? (
                        <span className="ml-1 text-xs font-medium text-destructive">low</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {p.reorder_point || "—"}
                    </td>
                    {canSeeCost ? (
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {formatMoney(p.on_hand * (p.material_rate || 0))}
                      </td>
                    ) : null}
                    <td className="px-3 py-2">
                      <form action={receiveStock} className="flex items-center gap-1">
                        <input type="hidden" name="product_id" value={p.id} />
                        <input name="qty" type="number" step="0.01" min="0" placeholder="+ qty" className={cell} />
                        <Button type="submit" size="sm" variant="outline">Receive</Button>
                      </form>
                    </td>
                    <td className="px-3 py-2">
                      <form action={adjustStock} className="flex items-center gap-1">
                        <input type="hidden" name="product_id" value={p.id} />
                        <input name="counted" type="number" step="0.01" min="0" placeholder="count" className={cell} />
                        <Button type="submit" size="sm" variant="ghost">Set</Button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      {/* Start tracking a catalog product */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Add a product to inventory</CardTitle>
        </CardHeader>
        <CardContent>
          <AddToInventoryForm />
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  tint,
  label,
  value,
}: {
  icon: typeof Boxes;
  tint: string;
  label: string;
  value: string | number;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <span className={`flex size-9 items-center justify-center rounded-full ${tint}`}>
          <Icon className="size-4" />
        </span>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tracking-tight">{value}</div>
      </CardContent>
    </Card>
  );
}
