"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { dedupeProducts, clearCatalog } from "./actions";

export function CatalogCleanup({ total }: { total: number }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [confirmClear, setConfirmClear] = useState(false);

  const dedupe = () =>
    start(async () => {
      const res = await dedupeProducts();
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.removed
          ? `Removed ${res.removed} duplicate${res.removed === 1 ? "" : "s"}` +
              (res.groups ? ` across ${res.groups} product${res.groups === 1 ? "" : "s"}` : "")
          : "No duplicates found — your catalog is clean",
      );
      router.refresh();
    });

  const clearAll = () =>
    start(async () => {
      const res = await clearCatalog();
      setConfirmClear(false);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(`Cleared ${res.removed} products`);
      router.refresh();
    });

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3">
      <span className="mr-auto text-sm text-muted-foreground">
        Catalog cleanup
      </span>
      <Button type="button" variant="outline" size="sm" onClick={dedupe} disabled={busy}>
        <Copy className="size-4" /> Remove duplicates
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setConfirmClear(true)}
        disabled={busy}
        className="text-destructive hover:text-destructive"
      >
        <Trash2 className="size-4" /> Clear all
      </Button>

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Clear the entire catalog?</DialogTitle>
            <DialogDescription>
              This permanently deletes all <strong>{total}</strong> products.
              Existing estimates keep their prices (they store their own copy),
              but you&apos;ll need to re-import your catalog. This can&apos;t be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
            <Button
              onClick={clearAll}
              disabled={busy}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {busy ? "Clearing…" : `Delete all ${total}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
