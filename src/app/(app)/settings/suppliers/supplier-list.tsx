"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Pencil, EyeOff, Eye, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { Supplier } from "@/lib/types";
import { SUPPLIER_KIND_LABELS } from "@/lib/types";
import {
  addSupplier,
  updateSupplier,
  setSupplierActive,
  type VendorState,
} from "./actions";

const cell =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const TERMS = ["Due on receipt", "NET 15", "NET 30", "NET 45", "NET 60", "Prepaid"];
const initial: VendorState = { error: null };

/** The shared field set for adding / editing a vendor record. */
function VendorFields({ s }: { s?: Supplier }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="space-y-1 sm:col-span-2">
        <span className="text-xs font-medium text-muted-foreground">Company name</span>
        <Input name="name" defaultValue={s?.name ?? ""} required />
      </label>
      <label className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Type</span>
        <select name="kind" defaultValue={s?.kind ?? "distributor"} className={`${cell} w-full`}>
          <option value="manufacturer">Manufacturer</option>
          <option value="distributor">Distributor</option>
        </select>
      </label>
      <label className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Payment terms</span>
        <Input name="payment_terms" defaultValue={s?.payment_terms ?? ""} placeholder="NET 30" list="vendor-terms" />
        <datalist id="vendor-terms">
          {TERMS.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </label>
      <label className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Contact name</span>
        <Input name="contact_name" defaultValue={s?.contact_name ?? ""} placeholder="Rep / AP contact" />
      </label>
      <label className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Our account #</span>
        <Input name="account_number" defaultValue={s?.account_number ?? ""} placeholder="e.g. FK-2231" />
      </label>
      <label className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Phone</span>
        <Input name="phone" defaultValue={s?.phone ?? ""} type="tel" />
      </label>
      <label className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Email</span>
        <Input name="email" defaultValue={s?.email ?? ""} type="email" />
      </label>
      <label className="space-y-1 sm:col-span-2">
        <span className="text-xs font-medium text-muted-foreground">Address</span>
        <Input name="address" defaultValue={s?.address ?? ""} placeholder="Street, City, ST ZIP" />
      </label>
      <div className="flex items-end gap-2">
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Freight %</span>
          <Input name="freight_pct" type="number" step="0.1" min="0" defaultValue={s?.freight_pct ?? 0} className="w-24" />
        </label>
      </div>
      <label className="space-y-1 sm:col-span-2">
        <span className="text-xs font-medium text-muted-foreground">Notes</span>
        <Input name="notes" defaultValue={s?.notes ?? ""} placeholder="Anything worth remembering about this vendor" />
      </label>
    </div>
  );
}

export function SupplierList({ suppliers }: { suppliers: Supplier[] }) {
  const active = suppliers.filter((s) => s.active !== false);
  const inactive = suppliers.filter((s) => s.active === false);
  const [adding, setAdding] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Vendors</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
          <Plus className="size-4" /> Add vendor
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Real vendor records — purchase orders link to these by ID, never by typed name. Set{" "}
          <strong>type</strong>, <strong>payment terms</strong>, account #, and contact once and every PO pulls
          them through. Deactivate a vendor to hide it from new POs; its history stays intact.
        </p>

        {adding ? <AddVendor onDone={() => setAdding(false)} /> : null}

        {active.length ? (
          <div className="divide-y">
            {active.map((s) => (
              <VendorRow key={s.id} s={s} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No vendors yet — add your first above.</p>
        )}

        {inactive.length ? (
          <details className="pt-2">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Deactivated ({inactive.length})
            </summary>
            <div className="mt-2 divide-y opacity-70">
              {inactive.map((s) => (
                <VendorRow key={s.id} s={s} />
              ))}
            </div>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AddVendor({ onDone }: { onDone: () => void }) {
  const [state, formAction, pending] = useActionState(addSupplier, initial);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) {
      toast.success("Vendor added");
      ref.current?.reset();
      onDone();
    }
    if (state.error) toast.error(state.error);
  }, [state, onDone]);
  return (
    <form ref={ref} action={formAction} className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <VendorFields />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          Add vendor
        </Button>
      </div>
    </form>
  );
}

function VendorRow({ s }: { s: Supplier }) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const terms = s.payment_terms ? ` · ${s.payment_terms}` : "";
  return (
    <div className="flex items-center gap-2 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Link href={`/settings/suppliers/${s.id}`} className="font-medium hover:underline">
            {s.name}
          </Link>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {SUPPLIER_KIND_LABELS[s.kind]}
          </span>
          {s.active === false ? (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Inactive
            </span>
          ) : null}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {[s.account_number ? `Acct ${s.account_number}` : null, s.contact_name, s.phone]
            .filter(Boolean)
            .join(" · ") || "No contact on file"}
          {terms}
        </div>
      </div>
      <Link
        href={`/settings/suppliers/${s.id}`}
        className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
        aria-label="View vendor & spend"
        title="View vendor & spend"
      >
        <ExternalLink className="size-4" />
      </Link>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-muted-foreground hover:text-foreground"
        aria-label="Edit vendor"
      >
        <Pencil className="size-4" />
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(() => setSupplierActive(s.id, s.active === false))}
        className="text-muted-foreground hover:text-foreground disabled:opacity-40"
        aria-label={s.active === false ? "Reactivate" : "Deactivate"}
        title={s.active === false ? "Reactivate" : "Deactivate (keeps history)"}
      >
        {s.active === false ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
      </button>
      {editing ? <EditVendor s={s} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}

function EditVendor({ s, onClose }: { s: Supplier; onClose: () => void }) {
  const [state, formAction, pending] = useActionState(updateSupplier, initial);
  useEffect(() => {
    if (state.ok) {
      toast.success("Vendor saved");
      onClose();
    }
    if (state.error) toast.error(state.error);
  }, [state, onClose]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit vendor</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="id" value={s.id} />
          <VendorFields s={s} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
