"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2, CheckCircle2, Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { SearchPicker } from "@/components/ui/search-picker";
import { formatMoney } from "@/lib/format";
import type { OrderSubmission, OrderResult } from "@/app/order/actions";

interface Cut {
  width: string; // "12" | "15"
  ft: string;
  in: string;
}
interface Line {
  key: string;
  productId: string;
  description: string;
  color: string;
  style: string;
  quantity: string;
  unit: string;
  cuts: Cut[];
  requested: string; // requested unit price
}

export interface OrderProduct {
  id: string;
  name: string;
  unit: string;
  price: number; // retail unit price (0 if unknown)
}

const UNITS = ["sq yd", "sq ft", "lnft", "roll", "each"];

const num = (v: string) => {
  const x = parseFloat(v);
  return Number.isFinite(x) ? x : 0;
};

/** "12' × 14'6"" — only when a length is given. */
function formatCut(c: Cut): string {
  if (!c.ft && !c.in) return "";
  const len = `${c.ft || "0"}'${c.in ? `${c.in}"` : ""}`;
  return `${c.width}' × ${len}`;
}

export function OrderForm({
  products,
  requireContact,
  action,
}: {
  products: OrderProduct[];
  requireContact: boolean;
  action: (input: OrderSubmission) => Promise<OrderResult>;
}) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const counter = useRef(0);
  const newCut = (): Cut => ({ width: "12", ft: "", in: "" });
  const newLine = (): Line => ({
    key: `l${counter.current++}`,
    productId: "",
    description: "",
    color: "",
    style: "",
    quantity: "",
    unit: "sq yd",
    cuts: [newCut()],
    requested: "",
  });

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);

  const update = (i: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const priceOf = (l: Line) =>
    l.productId ? (products.find((p) => p.id === l.productId)?.price ?? 0) : 0;
  const pickProduct = (i: number, productId: string) => {
    const p = products.find((x) => x.id === productId);
    update(
      i,
      p
        ? { productId: p.id, description: p.name, unit: p.unit || "sq yd" }
        : { productId: "" },
    );
  };

  const orderRetail = lines.reduce(
    (s, l) => s + priceOf(l) * num(l.quantity),
    0,
  );

  const submit = () =>
    start(async () => {
      const items = lines
        .filter((l) => l.description.trim() || l.productId)
        .map((l) => ({
          productId: l.productId || null,
          description: l.description.trim(),
          color: l.color.trim(),
          style: l.style.trim(),
          quantity: num(l.quantity),
          unit: l.unit,
          cutNotes: l.cuts.map(formatCut).filter(Boolean).join(" | "),
          retailPrice: priceOf(l),
          requestedPrice: num(l.requested),
        }));
      if (requireContact && !name.trim()) { toast.error("Enter your name."); return; }
      if (requireContact && !phone.trim()) { toast.error("Enter a phone number."); return; }
      if (!items.length) { toast.error("Add at least one item."); return; }
      const res = await action({
        contactName: name,
        contactPhone: phone,
        contactEmail: email,
        notes,
        items,
      });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setDone(true);
    });

  if (done) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <CheckCircle2 className="size-10 text-emerald-600" />
          <div className="text-lg font-semibold">Order received!</div>
          <p className="max-w-sm text-sm text-muted-foreground">
            Thanks — we&apos;ll review it, confirm pricing (including any price
            you requested), and let you know when it&apos;s cut and ready for
            pickup.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4 pb-10">
      {requireContact ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Your info</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label>Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Phone *</Label>
              <PhoneInput value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Email</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" className="mt-1" />
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">What do you need?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {lines.map((l, i) => {
            const retail = priceOf(l);
            const lineTotal = retail * num(l.quantity);
            return (
              <div key={l.key} className="rounded-md border p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  {products.length ? (
                    <SearchPicker
                      value={l.productId}
                      onChange={(v) => pickProduct(i, v)}
                      placeholder="Pick from catalog…"
                      allowClear
                      options={products.map((p) => ({ value: p.id, label: p.name }))}
                    />
                  ) : null}
                  <Input
                    value={l.description}
                    onChange={(e) => update(i, { description: e.target.value, productId: "" })}
                    placeholder="…or type what you want"
                    className={products.length ? "" : "sm:col-span-2"}
                  />
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div>
                    <label className="mb-0.5 block text-xs text-muted-foreground">Qty</label>
                    <Input value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} inputMode="decimal" placeholder="0" className="h-9" />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-xs text-muted-foreground">Unit</label>
                    <select value={l.unit} onChange={(e) => update(i, { unit: e.target.value })} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                      {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-0.5 block text-xs text-muted-foreground">Color</label>
                    <Input value={l.color} onChange={(e) => update(i, { color: e.target.value })} className="h-9" />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-xs text-muted-foreground">Style</label>
                    <Input value={l.style} onChange={(e) => update(i, { style: e.target.value })} className="h-9" />
                  </div>
                </div>

                {/* Retail + request a price */}
                {retail > 0 ? (
                  <div className="mt-2 flex flex-wrap items-end gap-3 rounded-md bg-muted/40 p-2">
                    <div className="text-sm">
                      <span className="text-muted-foreground">Retail: </span>
                      <span className="font-medium">{formatMoney(retail)}/{l.unit}</span>
                      {num(l.quantity) > 0 ? (
                        <span className="text-muted-foreground"> · {formatMoney(lineTotal)}</span>
                      ) : null}
                    </div>
                    <div className="ml-auto">
                      <label className="mb-0.5 block text-xs text-muted-foreground">Request a price ($/{l.unit})</label>
                      <Input value={l.requested} onChange={(e) => update(i, { requested: e.target.value })} inputMode="decimal" placeholder="optional" className="h-9 w-32" />
                    </div>
                  </div>
                ) : null}

                {/* Cuts: width 12'/15' × length ft + in */}
                <div className="mt-2">
                  <label className="mb-0.5 block text-xs text-muted-foreground">Cuts</label>
                  <div className="space-y-1.5">
                    {l.cuts.map((c, ci) => (
                      <div key={ci} className="flex flex-wrap items-center gap-1.5 text-sm">
                        <select
                          value={c.width}
                          onChange={(e) => update(i, { cuts: l.cuts.map((x, k) => (k === ci ? { ...x, width: e.target.value } : x)) })}
                          className="h-9 rounded-md border border-input bg-transparent px-2"
                        >
                          <option value="12">12&apos; wide</option>
                          <option value="15">15&apos; wide</option>
                        </select>
                        <span className="text-muted-foreground">×</span>
                        <Input value={c.ft} onChange={(e) => update(i, { cuts: l.cuts.map((x, k) => (k === ci ? { ...x, ft: e.target.value } : x)) })} inputMode="decimal" placeholder="ft" className="h-9 w-16" />
                        <span className="text-muted-foreground">ft</span>
                        <Input value={c.in} onChange={(e) => update(i, { cuts: l.cuts.map((x, k) => (k === ci ? { ...x, in: e.target.value } : x)) })} inputMode="decimal" placeholder="in" className="h-9 w-16" />
                        <span className="text-muted-foreground">in</span>
                        {l.cuts.length > 1 ? (
                          <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove cut" onClick={() => update(i, { cuts: l.cuts.filter((_, k) => k !== ci) })}>
                            <Trash2 className="size-3.5" />
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={() => update(i, { cuts: [...l.cuts, newCut()] })} className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary">
                    <Plus className="size-3" /> Add a cut
                  </button>
                </div>

                <div className="mt-2 flex justify-end">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}>
                    <Trash2 className="size-3.5" /> Remove item
                  </Button>
                </div>
              </div>
            );
          })}
          <Button type="button" variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, newLine()])}>
            <Plus className="size-3.5" /> Add another item
          </Button>

          {orderRetail > 0 ? (
            <div className="flex items-baseline justify-between border-t pt-3 text-sm">
              <span className="text-muted-foreground">Estimated retail total</span>
              <span className="text-base font-semibold">{formatMoney(orderRetail)}</span>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Final pricing is confirmed when we review your order. Any price you
            request needs our approval.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-6">
          <Label>Anything else? (optional)</Label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Pickup timing, special instructions…" className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="button" size="lg" disabled={pending} onClick={submit}>
          <Send className="size-4" /> {pending ? "Sending…" : "Submit order"}
        </Button>
      </div>
      {requireContact ? (
        <p className="text-[11px] leading-snug text-muted-foreground">
          By providing your phone number and submitting this order, you agree to
          receive text messages from Cleveland Floor King about your order, pickup,
          and installation. Msg &amp; data rates may apply. Msg frequency varies.
          Consent is not a condition of purchase. Reply STOP to opt out, HELP for
          help.
        </p>
      ) : null}
    </div>
  );
}
