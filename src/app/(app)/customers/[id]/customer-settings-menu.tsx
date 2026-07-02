"use client";

import { useState } from "react";
import { Settings2, Pencil, UserPlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Customer } from "@/lib/types";
import { CustomerForm } from "../customer-form";
import { InvitePortalForm } from "./invite-portal-form";
import { deleteCustomer } from "../actions";

type ActiveDialog = null | "edit" | "portal" | "delete";

/**
 * One place to manage the customer record itself: edit their information, set up
 * their portal login, or delete them for good. Keeps these record-level actions
 * out of the day-to-day body of the file. Each item opens its own dialog; the
 * dropdown closes on select (base-ui), so the dialogs live outside the menu.
 */
export function CustomerSettingsMenu({
  customer,
  canDelete,
  portalUser,
  defaultEmail,
}: {
  customer: Customer;
  canDelete: boolean;
  portalUser: { email: string } | null;
  defaultEmail: string;
}) {
  const [dialog, setDialog] = useState<ActiveDialog>(null);
  const [confirmText, setConfirmText] = useState("");
  const canConfirmDelete = confirmText.trim().toUpperCase() === "DELETE";

  const close = () => {
    setDialog(null);
    setConfirmText("");
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm">
              <Settings2 className="size-4" /> Settings
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel>Customer settings</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => setDialog("edit")}>
            <Pencil /> Edit information
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog("portal")}>
            <UserPlus /> Customer portal
            {portalUser ? (
              <span className="ml-auto text-[10px] font-medium text-emerald-600">
                Active
              </span>
            ) : null}
          </DropdownMenuItem>
          {canDelete ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDialog("delete")}
              >
                <Trash2 /> Delete customer
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Edit information */}
      <Dialog
        open={dialog === "edit"}
        onOpenChange={(o) => {
          if (!o) close();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit {customer.full_name}</DialogTitle>
            <DialogDescription>
              Update contact details, address and lead source.
            </DialogDescription>
          </DialogHeader>
          <CustomerForm customer={customer} onSaved={close} />
        </DialogContent>
      </Dialog>

      {/* Customer portal */}
      <Dialog
        open={dialog === "portal"}
        onOpenChange={(o) => {
          if (!o) close();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Customer portal</DialogTitle>
            <DialogDescription>
              A login lets {customer.full_name} view their quotes, jobs and
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
        </DialogContent>
      </Dialog>

      {/* Delete customer */}
      <Dialog
        open={dialog === "delete"}
        onOpenChange={(o) => {
          if (!o) close();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {customer.full_name}?</DialogTitle>
            <DialogDescription>
              This permanently deletes the customer <strong>and everything
              attached</strong> — estimates, jobs, invoices, payments, messages,
              and history. This <strong>cannot be undone</strong>. If you just
              want them out of your pipeline, use <em>Cancel</em> instead.
            </DialogDescription>
          </DialogHeader>
          <form action={deleteCustomer} className="space-y-3">
            <input type="hidden" name="id" value={customer.id} />
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Type <span className="font-mono text-destructive">DELETE</span>{" "}
                to confirm
              </label>
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE"
                autoComplete="off"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
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
        </DialogContent>
      </Dialog>
    </>
  );
}
