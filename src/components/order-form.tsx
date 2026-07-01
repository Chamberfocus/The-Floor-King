"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2, CheckCircle2, Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchPicker } from "@/components/ui/search-picker";
import type {
  OrderSubmission,
  OrderResult,
} from "@/app/order/actions";

interface Line {
  key: string;
  productId: string;
  description: string;
  color: string;
  style: string;
  quantity: string;
  unit: string;
  cuts: string[];
}

const UNITS = ["sq yd", "sq ft", "lnft", "roll", "each"];

export function OrderForm({
  products,
  requireContact,
  action,
}: {
  products: { id: string; name: string; unit: string }[];
  requireContact: boolean;
  action: (input: OrderSubmission) => Promise<OrderResult>;
}) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const counter = useRef(0);
  const newLine = (): Line => ({
    key: `l${counter.current++}`,
    productId: "",
    description: "",
    color: "",
    style: "",
    quantity: "",
    unit: "sq yd",
    cuts: [""],
  });

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);

  const update = (i: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pickProduct = (i: number, productId: string) => {
    const p = products.find((x) => x.id === productId);
    update(i, p ? { productId: p.id, description: p.name, unit: p.unit || "sq yd" } : { productId: "" });
  };

  const submit = () =>
    start(async () => {
      const items = lines
        .filter((l) => l.description.trim() || l.productId)
        .map((l) => ({
          productId: l.productId || null,
          description: l.description.trim(),
          color: l.color.trim(),
          style: l.style.trim(),
          quantity: parseFloat(l.quantity) || 0,
          unit: l.unit,
          cutNotes: l.cuts.map((c) => c.trim()).filter(Boolean).join(" | "),
        }));
      if (requireContact && !name.trim()) return toastErr("Enter your name.");
      if (requireContact && !phone.trim()) return toastErr("Enter a phone number.");
      if (!items.length) return toastErr("Add at least one item.");
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

  const toastErr = (m: string) => {
    toast.error(m);
  };

  if (done) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <CheckCircle2 className="size-10 text-emerald-600" />
          <div className="text-lg font-semibold">Order received!</div>
          <p className="max-w-sm text-sm text-muted-foreground">
            Thanks — we&apos;ll review your order and reach out to confirm pricing
            and let you know when it&apos;s cut and ready for pickup.
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
            <div className="sm:col-span-1">
              <Label>Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Phone *</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" className="mt-1" />
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
          {lines.map((l, i) => (
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
                  placeholder="…or type what you want (style, color)"
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
              <div className="mt-2">
                <label className="mb-0.5 block text-xs text-muted-foreground">Cuts</label>
                <div className="space-y-1.5">
                  {l.cuts.map((c, ci) => (
                    <div key={ci} className="flex items-center gap-2">
                      <Input
                        value={c}
                        onChange={(e) =>
                          update(i, {
                            cuts: l.cuts.map((x, k) => (k === ci ? e.target.value : x)),
                          })
                        }
                        placeholder={`Cut ${ci + 1} — e.g. 12' x 9'`}
                        className="h-9"
                      />
                      {l.cuts.length > 1 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Remove cut"
                          onClick={() =>
                            update(i, { cuts: l.cuts.filter((_, k) => k !== ci) })
                          }
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => update(i, { cuts: [...l.cuts, ""] })}
                  className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary"
                >
                  <Plus className="size-3" /> Add a cut
                </button>
              </div>
              <div className="mt-2 flex justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}>
                  <Trash2 className="size-3.5" /> Remove item
                </Button>
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, newLine()])}>
            <Plus className="size-3.5" /> Add another item
          </Button>
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
    </div>
  );
}
