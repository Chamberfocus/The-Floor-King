"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Users, UserPlus, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { SearchPicker } from "@/components/ui/search-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import {
  QuickLines,
  emptyQuickLine,
  lineTotal,
  type QuickLineState,
  type QuickProduct,
} from "@/components/quick-lines";
import { createQuickInvoice } from "./actions";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/types";

const METHODS: PaymentMethod[] = ["cash", "card", "check", "link", "other"];
const num = (v: string) => {
  const n = parseFloat(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export function QuickInvoiceForm({
  customers,
  products,
  defaultTaxRate,
}: {
  customers: { id: string; full_name: string }[];
  products: QuickProduct[];
  defaultTaxRate: number;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"existing" | "new">("new");
  const [customerId, setCustomerId] = useState("");
  const [walkIn, setWalkIn] = useState({ full_name: "", phone: "", email: "" });
  const [lines, setLines] = useState<QuickLineState[]>([emptyQuickLine("k0")]);
  const [taxRate, setTaxRate] = useState(String(defaultTaxRate ?? 0));
  const [notes, setNotes] = useState("");
  const [takePayment, setTakePayment] = useState(true);
  const [method, setMethod] = useState<PaymentMethod>("card");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [pullFromStock, setPullFromStock] = useState(true);
  const [saving, start] = useTransition();

  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const tax = subtotal * (num(taxRate) / 100);
  const total = subtotal + tax;
  // Paying in full is the normal counter case, so that's what's pre-filled.
  const payAmount = amount.trim() === "" ? total : num(amount);
  const balance = total - (takePayment ? payAmount : 0);

  const submit = () =>
    start(async () => {
      const res = await createQuickInvoice({
        customerId: mode === "existing" ? customerId || null : null,
        newCustomer: mode === "new" ? walkIn : null,
        lines: lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          rate: l.rate,
          productId: l.productId,
        })),
        taxRate,
        notes,
        payment: takePayment && payAmount > 0
          ? { amount: payAmount, method, reference }
          : null,
        pullFromStock,
      });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(
        balance <= 0.005 ? "Sale recorded and paid" : "Invoice created",
      );
      router.push(res.invoiceId ? `/invoices/${res.invoiceId}` : "/invoices");
    });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Who&apos;s buying</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            {(
              [
                ["new", "Walk-in", UserPlus],
                ["existing", "Existing customer", Users],
              ] as const
            ).map(([m, label, Icon]) => (
              <Button
                key={m}
                type="button"
                variant={mode === m ? "default" : "outline"}
                size="sm"
                onClick={() => setMode(m)}
              >
                <Icon className="size-4" />
                {label}
              </Button>
            ))}
          </div>

          {mode === "existing" ? (
            <SearchPicker
              options={customers.map((c) => ({ value: c.id, label: c.full_name }))}
              value={customerId}
              onChange={setCustomerId}
              placeholder="Search customers…"
              allowClear
            />
          ) : (
            <div className="grid gap-2 sm:grid-cols-3">
              <Input
                value={walkIn.full_name}
                onChange={(e) => setWalkIn({ ...walkIn, full_name: e.target.value })}
                placeholder="Name"
                aria-label="Customer name"
              />
              <PhoneInput
                value={walkIn.phone}
                onChange={(e) => setWalkIn({ ...walkIn, phone: e.target.value })}
                placeholder="Phone (optional)"
              />
              <Input
                value={walkIn.email}
                onChange={(e) => setWalkIn({ ...walkIn, email: e.target.value })}
                placeholder="Email (optional)"
                type="email"
                aria-label="Customer email"
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">What they&apos;re taking</CardTitle>
        </CardHeader>
        <CardContent>
          <QuickLines
            lines={lines}
            products={products}
            onChange={setLines}
            showStock
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Money</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Tax %</label>
              <Input
                inputMode="decimal"
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
                className="w-24"
              />
            </div>
            <div className="ml-auto text-right tabular-nums">
              <div className="text-sm text-muted-foreground">
                {formatMoney(subtotal)} + {formatMoney(tax)} tax
              </div>
              <div className="text-2xl font-semibold">{formatMoney(total)}</div>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={takePayment}
              onChange={(e) => setTakePayment(e.target.checked)}
              className="size-4"
            />
            Taking payment now
          </label>

          {takePayment ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">How</label>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
                  aria-label="Payment method"
                >
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABELS[m]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Amount
                </label>
                <Input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={total.toFixed(2)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Reference
                </label>
                <Input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Check no., last 4…"
                />
              </div>
            </div>
          ) : null}

          {/* Say what will happen before it happens. */}
          <div
            className={cn(
              "rounded-md border p-2 text-sm",
              balance <= 0.005
                ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40"
                : "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40",
            )}
          >
            {balance <= 0.005
              ? `Paid in full — the invoice saves as PAID.`
              : `Leaves ${formatMoney(balance)} owing — the invoice saves as ${
                  takePayment && payAmount > 0 ? "partially paid" : "unpaid"
                }.`}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={pullFromStock}
              onChange={(e) => setPullFromStock(e.target.checked)}
              className="size-4"
            />
            Take it out of inventory (catalog items only)
          </label>

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Notes for the invoice (optional)"
            aria-label="Invoice notes"
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={saving} size="lg">
          <Receipt className="size-4" />
          {saving ? "Saving…" : "Create invoice"}
        </Button>
        <span className="text-sm text-muted-foreground">
          {formatMoney(total)} · {lines.filter((l) => l.description.trim()).length}{" "}
          {lines.filter((l) => l.description.trim()).length === 1 ? "line" : "lines"}
        </span>
      </div>
    </div>
  );
}
