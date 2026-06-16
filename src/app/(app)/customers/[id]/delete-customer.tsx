"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
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
import { deleteCustomer } from "../actions";

export function DeleteCustomer({
  customerId,
  name,
}: {
  customerId: string;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const ok = confirmText.trim().toUpperCase() === "DELETE";

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-4" /> Delete permanently
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {name}?</DialogTitle>
            <DialogDescription>
              This permanently deletes the customer <strong>and everything
              attached</strong> — estimates, jobs, invoices, payments, messages,
              and history. This <strong>cannot be undone</strong>. If you just
              want them out of your pipeline, use <em>Cancel</em> instead.
            </DialogDescription>
          </DialogHeader>
          <form action={deleteCustomer} className="space-y-3">
            <input type="hidden" name="id" value={customerId} />
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Type <span className="font-mono text-destructive">DELETE</span> to
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
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Keep customer
              </Button>
              {ok ? (
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
