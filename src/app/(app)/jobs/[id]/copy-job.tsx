"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchPicker } from "@/components/ui/search-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { copyJob } from "@/app/(app)/jobs/copy-actions";

/**
 * "Same again, different unit."
 *
 * A property manager's building is one account with a job per unit, and every
 * one of them is the same scope at a different door. This copies the whole
 * thing — the quote with its rooms, options and costed material, and a fresh
 * work order pointed at the new unit — instead of rebuilding it by hand.
 */
export function CopyJob({
  jobId,
  jobTitle,
  addresses,
  hasEstimate,
}: {
  jobId: string;
  jobTitle: string | null;
  /** The account's saved units. */
  addresses: { id: string; label: string }[];
  hasEstimate: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"saved" | "new">(
    addresses.length ? "saved" : "new",
  );
  const [addrId, setAddrId] = useState("");
  const [addr, setAddr] = useState({ label: "", street: "", city: "", state: "", zip: "" });
  const [title, setTitle] = useState("");
  const [saving, start] = useTransition();

  const ready =
    mode === "saved" ? !!addrId : !!(addr.street.trim() || addr.label.trim());

  const submit = () =>
    start(async () => {
      const res = await copyJob({
        jobId,
        serviceAddressId: mode === "saved" ? addrId || null : null,
        newAddress: mode === "new" ? addr : null,
        title,
      });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Job copied");
      router.push(`/jobs/${res.jobId}?created=1`);
    });

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Copy className="size-3.5" /> Copy to another unit
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Copy this job</DialogTitle>
            <DialogDescription>
              {hasEstimate
                ? "Brings the whole quote across — every room, option and price — as a fresh draft, plus a new work order for the unit you pick."
                : "This job has no estimate behind it, so the copy carries its title, notes and site across."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Which unit is it for?
              </label>
              {addresses.length ? (
                <div className="mb-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setMode("saved")}
                    className={cn(
                      "flex-1 rounded-md border px-3 py-1.5 text-sm",
                      mode === "saved"
                        ? "border-primary bg-primary/5 font-medium"
                        : "hover:bg-muted",
                    )}
                  >
                    A unit on file
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("new")}
                    className={cn(
                      "flex-1 rounded-md border px-3 py-1.5 text-sm",
                      mode === "new"
                        ? "border-primary bg-primary/5 font-medium"
                        : "hover:bg-muted",
                    )}
                  >
                    A new one
                  </button>
                </div>
              ) : null}

              {mode === "saved" && addresses.length ? (
                <SearchPicker
                  value={addrId}
                  onChange={setAddrId}
                  placeholder="Pick the unit…"
                  allowClear
                  options={addresses.map((a) => ({ value: a.id, label: a.label }))}
                />
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    placeholder="Unit / label — e.g. Unit 814"
                    value={addr.label}
                    onChange={(e) => setAddr({ ...addr, label: e.target.value })}
                    className="sm:col-span-2"
                  />
                  <Input
                    placeholder="Street"
                    value={addr.street}
                    onChange={(e) => setAddr({ ...addr, street: e.target.value })}
                    className="sm:col-span-2"
                  />
                  <Input
                    placeholder="City"
                    value={addr.city}
                    onChange={(e) => setAddr({ ...addr, city: e.target.value })}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      placeholder="State"
                      value={addr.state}
                      onChange={(e) => setAddr({ ...addr, state: e.target.value })}
                    />
                    <Input
                      placeholder="ZIP"
                      value={addr.zip}
                      onChange={(e) => setAddr({ ...addr, zip: e.target.value })}
                    />
                  </div>
                </div>
              )}
              <p className="mt-1.5 text-xs text-muted-foreground">
                Saved against the customer, so the next unit in the same building
                is already in the list.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Name the copy (optional)
              </label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={jobTitle ?? "Job"}
              />
            </div>

            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              The copy isn&apos;t scheduled — the same work at another unit
              happens on its own day, and inheriting this one&apos;s date would
              put two crews in two places on one morning.
            </p>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={submit} disabled={saving || !ready}>
                <Copy className="size-3.5" /> {saving ? "Copying…" : "Copy the job"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
