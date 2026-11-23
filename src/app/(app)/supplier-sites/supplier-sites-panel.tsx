"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink, KeyRound, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SupplierSiteRow } from "@/lib/data/supplier-sites";
import {
  SUPPLIER_SITE_PURPOSE_LABEL,
  type SupplierSitePurpose,
} from "@/lib/supplier-vault";
import {
  deleteSupplierSite,
  openSupplierSite,
  saveSupplierSite,
  type SupplierSiteState,
} from "./actions";

const initial: SupplierSiteState = { error: null };

const fieldClass =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface OpenRecord {
  id: string;
  siteName: string;
  actorName: string;
  when: string;
}

function SiteForm({
  editing,
  suppliers,
  vaultReady,
  presetVendor,
  presetPurpose,
  onCancel,
}: {
  editing: SupplierSiteRow | null;
  suppliers: { id: string; name: string }[];
  vaultReady: boolean;
  presetVendor: string;
  presetPurpose: SupplierSitePurpose | "";
  onCancel: () => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveSupplierSite, initial);

  useEffect(() => {
    if (state.ok) {
      toast.success("Saved");
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state, router]);

  if (state.ok) {
    return (
      <p className="rounded-lg border p-4 text-sm">
        Saved.{" "}
        <button type="button" className="text-primary hover:underline" onClick={onCancel}>
          Close
        </button>
      </p>
    );
  }

  return (
    <form action={action} className="space-y-4 rounded-lg border p-4">
      <input type="hidden" name="id" value={state.id ?? editing?.id ?? ""} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="site-name">Name</Label>
          <Input
            id="site-name"
            name="name"
            required
            defaultValue={editing?.name ?? ""}
            placeholder="Shaw ordering"
            autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="site-purpose">What it is</Label>
          <select
            id="site-purpose"
            name="purpose"
            className={fieldClass}
            defaultValue={editing?.purpose ?? (presetPurpose || "order")}
          >
            <option value="order">{SUPPLIER_SITE_PURPOSE_LABEL.order}</option>
            <option value="pay">{SUPPLIER_SITE_PURPOSE_LABEL.pay}</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="site-vendor">Vendor</Label>
          <select
            id="site-vendor"
            name="supplier_id"
            className={fieldClass}
            defaultValue={editing?.supplierId ?? presetVendor}
          >
            <option value="">Not tied to a vendor</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="site-url">Website</Label>
          <Input
            id="site-url"
            name="site_url"
            required
            defaultValue={editing?.siteUrl ?? ""}
            placeholder="https://"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="site-username">Username</Label>
          <Input
            id="site-username"
            name="username"
            defaultValue={editing?.username ?? ""}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="site-secret">Password</Label>
          <Input
            id="site-secret"
            name="site_secret"
            type="password"
            autoComplete="new-password"
            placeholder={
              !vaultReady
                ? "Vault key is not set"
                : editing?.hasSecret
                  ? "Saved — leave blank to keep it"
                  : ""
            }
            disabled={!vaultReady}
          />
        </div>
      </div>
      {editing?.hasSecret ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="clear_secret" className="size-4" />
          Remove the saved password
        </label>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving" : "Save"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function SupplierSitesPanel({
  sites,
  suppliers,
  canSave,
  vaultReady,
  presetVendor,
  presetPurpose,
  opens,
}: {
  sites: SupplierSiteRow[];
  suppliers: { id: string; name: string }[];
  canSave: boolean;
  vaultReady: boolean;
  presetVendor: string;
  presetPurpose: SupplierSitePurpose | "";
  opens: OpenRecord[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<SupplierSiteRow | null>(null);
  const [opening, startOpen] = useTransition();
  const [heldPassword, setHeldPassword] = useState<string | null>(null);

  useEffect(() => {
    if (!heldPassword) return;
    const timer = window.setTimeout(() => setHeldPassword(null), 45000);
    return () => window.clearTimeout(timer);
  }, [heldPassword]);
  const [last, setLast] = useState<{
    name: string;
    username: string;
    url: string;
    copied: boolean;
    note: string | null;
  } | null>(null);

  const supplierName = (id: string | null) =>
    suppliers.find((supplier) => supplier.id === id)?.name ?? "";

  const onOpen = (site: SupplierSiteRow) => {
    const tab = window.open("", "_blank");
    startOpen(async () => {
      const res = await openSupplierSite(site.id);
      if (res.error || !res.url) {
        tab?.close();
        toast.error(res.error ?? "That site could not be opened.");
        return;
      }
      if (tab) {
        tab.location.href = res.url;
        tab.opener = null;
      }
      let copied = false;
      if (res.password) {
        try {
          await navigator.clipboard.writeText(res.password);
          copied = true;
          setHeldPassword(null);
        } catch {
          setHeldPassword(res.password);
        }
      } else {
        setHeldPassword(null);
      }
      setLast({
        name: res.name ?? site.name,
        username: res.username ?? site.username,
        url: res.url,
        copied,
        note: res.passwordNote ?? null,
      });
      if (!tab) toast.error("Allow pop-ups for this site, then open it again.");
      else if (copied) toast.success("Password copied. Paste it on their sign-in page.");
      else if (res.passwordNote) toast.message(res.passwordNote);
    });
  };

  const showForm = canSave && (adding || editing);

  return (
    <div className="flex flex-col gap-4">
      {canSave ? (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setEditing(null);
              setAdding((open) => !open);
            }}
          >
            <Plus className="size-4" /> Add a site
          </Button>
        </div>
      ) : null}

      {showForm ? (
        <SiteForm
          key={editing?.id ?? "new"}
          editing={editing}
          suppliers={suppliers}
          vaultReady={vaultReady}
          presetVendor={presetVendor}
          presetPurpose={presetPurpose}
          onCancel={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      ) : null}

      {sites.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {canSave
            ? "No sites yet. Add each ordering website and each place you pay them."
            : "No sites yet. The owner adds each ordering website and each place you pay them."}
        </p>
      ) : (
        <div className="divide-y rounded-lg border">
          {sites.map((site) => (
            <div key={site.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="font-medium">{site.name}</div>
                <div className="text-sm text-muted-foreground">
                  {SUPPLIER_SITE_PURPOSE_LABEL[site.purpose]}
                  {supplierName(site.supplierId) ? ` · ${supplierName(site.supplierId)}` : ""}
                  {site.username ? ` · ${site.username}` : ""}
                  {site.hasSecret ? " · Password saved" : " · No password yet"}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" disabled={opening} onClick={() => onOpen(site)}>
                  <ExternalLink className="size-4" /> Open
                </Button>
                {canSave ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setAdding(false);
                        setEditing(site);
                      }}
                    >
                      Edit
                    </Button>
                    <ConfirmButton
                      title={`Remove ${site.name}?`}
                      description="The saved password is deleted with it."
                      confirmLabel="Remove"
                      destructive
                      variant="ghost"
                      size="sm"
                      onConfirm={async () => {
                        const res = await deleteSupplierSite(site.id);
                        if (res.error) toast.error(res.error);
                        else {
                          toast.success("Removed");
                          router.refresh();
                        }
                      }}
                    >
                      <Trash2 className="size-4" /> Remove
                    </ConfirmButton>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {last ? (
        <div className="rounded-lg border bg-muted/40 p-4 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <KeyRound className="size-4" /> {last.name} is open
          </div>
          {last.username ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Username</span>
              <span className="font-mono">{last.username}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(last.username);
                    toast.success("Username copied");
                  } catch {
                    toast.error("Copy the username from the line above.");
                  }
                }}
              >
                Copy username
              </Button>
            </div>
          ) : null}
          <p className="mt-2 text-muted-foreground">
            {last.copied
              ? "The password is on the clipboard. Paste it on their sign-in page. It is not kept in this list."
              : last.note ?? "Paste the username on their sign-in page."}
          </p>
          {heldPassword ? (
            <div className="mt-3">
              <Input
                readOnly
                value={heldPassword}
                className="font-mono"
                aria-label="Password"
                onFocus={(event) => event.currentTarget.select()}
              />
              <p className="mt-1 text-xs text-muted-foreground">This clears from the screen in a moment.</p>
            </div>
          ) : null}
          <a
            href={last.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-primary hover:underline"
          >
            Open the site again
          </a>
        </div>
      ) : null}

      {canSave && opens.length ? (
        <div>
          <h2 className="mb-2 text-sm font-semibold">Recent opens</h2>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {opens.map((open) => (
              <li key={open.id}>
                {open.actorName} opened {open.siteName} · {open.when}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
