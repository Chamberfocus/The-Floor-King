"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Home, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import type { Customer } from "@/lib/types";
import { lookupCustomerProperty } from "../property-actions";

export function PropertyCard({
  customer,
  hasMaps,
  hasPropertyApi,
}: {
  customer: Customer;
  hasMaps: boolean;
  hasPropertyApi: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [imgOk, setImgOk] = useState(true);

  if (!customer.street) return null;

  const addr = [customer.street, customer.city, customer.state, customer.zip]
    .filter(Boolean)
    .join(", ");
  const sv =
    customer.latitude && customer.longitude
      ? `/api/property/streetview?lat=${customer.latitude}&lng=${customer.longitude}`
      : `/api/property/streetview?address=${encodeURIComponent(addr)}`;

  const details = [
    customer.property_beds ? `${customer.property_beds} bd` : null,
    customer.property_baths ? `${customer.property_baths} ba` : null,
    customer.property_sqft ? `${customer.property_sqft.toLocaleString()} sq ft` : null,
    customer.property_year ? `built ${customer.property_year}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const lookup = () =>
    start(async () => {
      const res = await lookupCustomerProperty(customer.id);
      if (res.error) toast.error(res.error);
      else {
        toast.success("Property updated");
        router.refresh();
      }
    });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-1.5 text-base">
          <Home className="size-4" /> Property
        </CardTitle>
        {hasPropertyApi ? (
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={lookup}>
            <RefreshCw className={cn("size-3.5", pending && "animate-spin")} />
            {customer.property_checked_at ? "Refresh" : "Look up value"}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {hasMaps && imgOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={sv}
            alt={`Street view of ${addr}`}
            onError={() => setImgOk(false)}
            className="max-h-56 w-full rounded-lg border bg-muted object-cover"
          />
        ) : null}
        {customer.property_value ? (
          <div>
            <div className="text-2xl font-semibold">
              {formatMoney(customer.property_value)}
              <span className="ml-1 text-xs font-normal text-muted-foreground">est. value</span>
            </div>
            {details ? (
              <div className="text-sm text-muted-foreground">
                {details}
                {customer.property_type ? ` · ${customer.property_type}` : ""}
              </div>
            ) : null}
            {customer.property_checked_at ? (
              <div className="mt-0.5 text-xs text-muted-foreground">
                as of {new Date(customer.property_checked_at).toLocaleDateString()}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {hasPropertyApi
              ? "Tap “Look up value” to pull this home’s estimated value & details."
              : "Add a RentCast API key (Settings) to show the home’s value."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
