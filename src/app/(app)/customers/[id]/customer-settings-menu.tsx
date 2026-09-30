"use client";

import { useState } from "react";
import { Settings2, Pencil, UserPlus, Trash2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Customer } from "@/lib/types";
import type { LucideIcon } from "lucide-react";
import { CustomerForm } from "../customer-form";
import { InvitePortalForm } from "./invite-portal-form";
import { deleteCustomer } from "../actions";

type View = "menu" | "edit" | "portal" | "delete";

/**
 * One place to manage the customer record itself — edit their information, set
 * up their portal login, or delete them. Built as a single dialog that swaps
 * between a small menu and each action (no nested menus/popovers), so it's rock
 * solid on phone and tablet.
 */
export function CustomerSettingsMenu({
  customer,
  canDelete,
  portalUser,
  defaultEmail,
  sources = [],
}: {
  customer: Customer;
  canDelete: boolean;
  portalUser: { email: string } | null;
  defaultEmail: string;
  sources?: import("@/lib/types").LeadSourceRow[];
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("menu");
  const [confirmText, setConfirmText] = useState("");
  const canConfirmDelete = confirmText.trim().toUpperCase() === "DELETE";

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (!o) {
      // Reset for next time once the dialog is closed.
      setView("menu");
      setConfirmText("");
    }
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Settings2 className="size-4" /> Settings
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          {view === "menu" ? (
            <>
              <DialogHeader>
                <DialogTitle>Customer settings</DialogTitle>
                <DialogDescription>
                  Manage {customer.full_name}&apos;s record.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-2">
                <SettingRow
                  icon={Pencil}
                  title="Edit information"
                  desc="Name, contact, address & lead source"
                  onClick={() => setView("edit")}
                />
                <SettingRow
                  icon={UserPlus}
                  title="Customer portal"
                  desc={
                    portalUser
                      ? `Active — ${portalUser.email}`
                      : "Invite them to view estimates, jobs & invoices"
                  }
                  onClick={() => setView("portal")}
                />
                {canDelete ? (
                  <SettingRow
                    icon={Trash2}
                    title="Delete customer"
                    desc="Permanently remove this customer & everything attached"
                    destructive
                    onClick={() => setView("delete")}
                  />
                ) : null}
              </div>
            </>
          ) : view === "edit" ? (
            <>
              <DialogHeader>
                <BackButton onClick={() => setView("menu")} />
                <DialogTitle>Edit {customer.full_name}</DialogTitle>
                <DialogDescription>
                  Update contact details, address and lead source.
                </DialogDescription>
              </DialogHeader>
              <CustomerForm customer={customer} sources={sources} onSaved={() => onOpenChange(false)} />
            </>
          ) : view === "portal" ? (
            <>
              <DialogHeader>
                <BackButton onClick={() => setView("menu")} />
                <DialogTitle>Customer portal</DialogTitle>
                <DialogDescription>
                  A login lets {customer.full_name} view their estimates, jobs and
                  invoices online.
                </DialogDescription>
              </DialogHeader>
              {portalUser ? (
                <p className="text-sm text-muted-foreground">
                  Portal access is enabled for{" "}
                  <span className="font-medium text-foreground">
                    {portalUser.email}
                  </span>
                  .
                </p>
              ) : (
                <InvitePortalForm
                  customerId={customer.id}
                  defaultEmail={defaultEmail}
                />
              )}
            </>
          ) : (
            <>
              <DialogHeader>
                <BackButton onClick={() => setView("menu")} />
                <DialogTitle>Delete {customer.full_name}?</DialogTitle>
                <DialogDescription>
                  This permanently deletes the customer <strong>and everything
                  attached</strong> — estimates, jobs, invoices, payments,
                  messages, and history. This <strong>cannot be undone</strong>.
                  If you just want them out of your pipeline, use{" "}
                  <em>Cancel</em> instead.
                </DialogDescription>
              </DialogHeader>
              <form action={deleteCustomer} className="space-y-3">
                <input type="hidden" name="id" value={customer.id} />
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    Type{" "}
                    <span className="font-mono text-destructive">DELETE</span> to
                    confirm
                  </label>
                  <Input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="DELETE"
                    autoComplete="off"
                  />
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setView("menu")}
                  >
                    Keep customer
                  </Button>
                  {canConfirmDelete ? (
                    <SubmitButton
                      pendingText="Deleting…"
                      confirm={null}
                      className="bg-destructive text-white hover:bg-destructive/90"
                    >
                      Delete forever
                    </SubmitButton>
                  ) : (
                    <Button type="button" disabled className="opacity-50">
                      Delete forever
                    </Button>
                  )}
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function SettingRow({
  icon: Icon,
  title,
  desc,
  onClick,
  destructive,
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted",
        destructive && "hover:bg-destructive/10",
      )}
    >
      <Icon
        className={cn(
          "size-4 shrink-0",
          destructive ? "text-destructive" : "text-muted-foreground",
        )}
      />
      <div className="min-w-0">
        <div
          className={cn(
            "text-sm font-medium",
            destructive && "text-destructive",
          )}
        >
          {title}
        </div>
        <div className="truncate text-xs text-muted-foreground">{desc}</div>
      </div>
    </button>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-1 inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-3.5" /> Settings
    </button>
  );
}
