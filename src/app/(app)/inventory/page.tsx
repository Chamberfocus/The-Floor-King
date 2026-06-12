import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Boxes, AlertTriangle, DollarSign, Tag } from "lucide-react";
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
  listUntracked,
  inventorySummary,
  listAgedStock,
  daysIdle,
  AGED_DAYS,
} from "@/lib/data/inventory";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  receiveStock,
  adjustStock,
  startTracking,
  setClearance,
} from "./actions";

export const metadata: Metadata = { title: "Inventory" };

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

  const [items, summary, untracked, aged] = await Promise.all([
    listInventory(q),
    inventorySummary(),
    listUntracked(),
    listAgedStock(),
  ]);

  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Track what's in stock, receive deliveries, and pull material for jobs."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <SummaryCard icon={Boxes} tint="bg-zinc-200 text-zinc-700" label="Tracked items" value={summary.trackedCount} />
        <SummaryCard
          icon={AlertTriangle}
          tint="bg-red-100 text-red-600"
          label="Low / out of stock"
          value={summary.lowStockCount}
        />
        <SummaryCard
          icon={DollarSign}
          tint="bg-emerald-100 text-emerald-600"
          label="Inventory value (at cost)"
          value={formatMoney(summary.totalValue)}
        />
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
                      <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
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
        <Input name="q" defaultValue={q} placeholder="Search stock…" />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {q ? `No tracked stock matches "${q}".` : "No tracked stock yet — add a product below."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Product</th>
                <th className="px-3 py-2 text-left">Bin</th>
                <th className="px-3 py-2 text-right">On hand</th>
                <th className="px-3 py-2 text-right">Reorder</th>
                <th className="px-3 py-2 text-right">Value</th>
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
                          <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
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
                        <span className="ml-1 text-[11px] font-medium text-destructive">low</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {p.reorder_point || "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {formatMoney(p.on_hand * (p.material_rate || 0))}
                    </td>
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
      )}

      {/* Start tracking a catalog product */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Add a product to inventory</CardTitle>
        </CardHeader>
        <CardContent>
          {untracked.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Every catalog product is already tracked.
            </p>
          ) : (
            <form action={startTracking} className="flex flex-wrap items-end gap-2">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Product</label>
                <select name="product_id" required className="h-9 w-64 rounded-md border border-input bg-transparent px-2 text-sm">
                  {untracked.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.sku ? ` (#${p.sku})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Opening count</label>
                <Input name="on_hand" type="number" step="0.01" min="0" defaultValue="0" className="w-24" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Reorder at</label>
                <Input name="reorder_point" type="number" step="0.01" min="0" defaultValue="0" className="w-24" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Bin</label>
                <Input name="bin_location" placeholder="A-12" className="w-28" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">In stock since</label>
                <Input name="stocked_since" type="date" className="w-36" />
              </div>
              <Button type="submit">Track</Button>
            </form>
          )}
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
