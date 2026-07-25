import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { listCancelReasons } from "@/lib/data/cancel-reasons";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import {
  addCancelReason,
  updateCancelReason,
  toggleCancelReason,
  deleteCancelReason,
} from "./actions";

export const metadata: Metadata = { title: "Cancellation reasons" };
export const dynamic = "force-dynamic";

export default async function CancelReasonsSettingsPage() {
  const profile = await requireProfile();
  if (!["admin", "office"].includes(profile.role)) redirect("/settings");
  const reasons = await listCancelReasons();

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/settings"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Settings
      </Link>
      <PageHeader
        title="Cancellation reasons"
        description="The pick-list shown when a job is cancelled. Keeping it tidy makes your win/loss-by-reason report meaningful."
      />

      <Card className="mt-4">
        <CardContent className="space-y-2 pt-6">
          {reasons.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No reasons yet — add your first one below.
            </p>
          ) : (
            reasons.map((r) => (
              <form
                key={r.id}
                action={updateCancelReason}
                className="flex flex-wrap items-center gap-2 rounded-md border p-2"
              >
                <input type="hidden" name="id" value={r.id} />
                <Input
                  name="label"
                  defaultValue={r.label}
                  className={`min-w-0 flex-1 ${r.active ? "" : "line-through opacity-60"}`}
                />
                <Input
                  name="position"
                  type="number"
                  defaultValue={r.position}
                  className="w-20"
                  aria-label="Order"
                />
                <SubmitButton size="sm" variant="outline" pendingText="Saving…" confirm="Saved">
                  Save
                </SubmitButton>
                <Button
                  type="submit"
                  size="sm"
                  variant="ghost"
                  formAction={toggleCancelReason}
                  name="active"
                  value={String(r.active)}
                >
                  {r.active ? "Hide" : "Show"}
                </Button>
                <ConfirmButton
                  size="icon-sm"
                  variant="ghost"
                  formAction={deleteCancelReason}
                  aria-label="Delete reason"
                  title={`Delete "${r.label}"?`}
                  description="Removes it from the pick-list. Past cancellations keep the reason text already recorded."
                  confirmLabel="Delete"
                  destructive
                >
                  <Trash2 className="size-4 text-destructive" />
                </ConfirmButton>
              </form>
            ))
          )}

          {/* Add a reason */}
          <form action={addCancelReason} className="mt-3 flex items-center gap-2 border-t pt-4">
            <Input name="label" placeholder="e.g. Job postponed indefinitely" className="flex-1" />
            <Input name="position" type="number" defaultValue={500} className="w-20" aria-label="Order" />
            <SubmitButton size="sm" pendingText="Adding…" confirm="Reason added">
              <Plus className="size-4" /> Add
            </SubmitButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
