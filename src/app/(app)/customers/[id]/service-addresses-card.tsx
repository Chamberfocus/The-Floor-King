import { MapPin, Plus, Trash2, Pencil } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatServiceAddress, type ServiceAddress } from "@/lib/types";
import { AddressFields } from "../address-fields";
import {
  addServiceAddress,
  updateServiceAddress,
  deleteServiceAddress,
} from "./service-address-actions";

/**
 * Manage extra service addresses for an account (property managers / commercial
 * clients). The account's own address stays the primary; these are additional
 * job sites you can pick when building an estimate or a job.
 */
export function ServiceAddressesCard({
  customerId,
  addresses,
}: {
  customerId: string;
  addresses: ServiceAddress[];
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-1.5 text-base">
          <MapPin className="size-4" /> Service addresses
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Extra properties for this account. The main address on file stays the
          primary; pick one of these when the work is at a different site.
        </p>

        {addresses.length > 0 ? (
          <ul className="space-y-2">
            {addresses.map((a) => (
              <li key={a.id} className="rounded-md border p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 text-sm">
                    <div className="font-medium">
                      {a.label || "Service address"}
                    </div>
                    <div className="text-muted-foreground">
                      {formatServiceAddress({ ...a, label: null })}
                    </div>
                    {a.notes ? (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {a.notes}
                      </div>
                    ) : null}
                  </div>
                  <form action={deleteServiceAddress}>
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="customer_id" value={customerId} />
                    <ConfirmButton
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Delete address"
                      title="Delete this service address?"
                      description="Removes the saved address. Jobs and estimates that used it keep their own copy of the address."
                      confirmLabel="Delete address"
                      destructive
                    >
                      <Trash2 className="size-3.5" />
                    </ConfirmButton>
                  </form>
                </div>
                <details className="mt-1.5">
                  <summary className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    <Pencil className="size-3" /> Edit
                  </summary>
                  <form action={updateServiceAddress} className="mt-2 space-y-2">
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="customer_id" value={customerId} />
                    <div>
                      <Label className="text-xs">Label</Label>
                      <Input
                        name="label"
                        defaultValue={a.label ?? ""}
                        placeholder="e.g. Unit 4B"
                        className="h-9"
                      />
                    </div>
                    <AddressFields defaults={a} />
                    <div>
                      <Label className="text-xs">Notes</Label>
                      <Input
                        name="notes"
                        defaultValue={a.notes ?? ""}
                        placeholder="Gate code, contact on site…"
                        className="h-9"
                      />
                    </div>
                    <Button type="submit" size="sm">
                      Save changes
                    </Button>
                  </form>
                </details>
              </li>
            ))}
          </ul>
        ) : null}

        <details>
          <summary className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-primary">
            <Plus className="size-4" /> Add a service address
          </summary>
          <form action={addServiceAddress} className="mt-3 space-y-2">
            <input type="hidden" name="customer_id" value={customerId} />
            <div>
              <Label className="text-xs">Label</Label>
              <Input
                name="label"
                placeholder="e.g. Maple Duplex, Unit 4B"
                className="h-9"
              />
            </div>
            <AddressFields />
            <div>
              <Label className="text-xs">Notes (optional)</Label>
              <Input
                name="notes"
                placeholder="Gate code, contact on site…"
                className="h-9"
              />
            </div>
            <Button type="submit" size="sm">
              <Plus className="size-3.5" /> Add address
            </Button>
          </form>
        </details>
      </CardContent>
    </Card>
  );
}
