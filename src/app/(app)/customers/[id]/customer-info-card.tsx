"use client";

import { useState } from "react";
import { Phone, Mail, MapPin, Pencil, Building2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LEAD_SOURCE_LABELS, type Customer } from "@/lib/types";
import { CustomerForm } from "../customer-form";

function cityLine(c: Customer) {
  return [c.city, c.state, c.zip].filter(Boolean).join(", ").replace(/, (\S+)$/, " $1");
}

export function CustomerInfoCard({ customer }: { customer: Customer }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Edit details</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </CardHeader>
        <CardContent>
          <CustomerForm customer={customer} onSaved={() => setEditing(false)} />
        </CardContent>
      </Card>
    );
  }

  const hasAddress = customer.street || customer.city;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Contact details</CardTitle>
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          <Pencil className="size-3.5" /> Edit
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {customer.phone ? (
          <div className="flex items-center gap-2">
            <Phone className="size-4 text-muted-foreground" />
            <a href={`tel:${customer.phone}`} className="hover:underline">
              {customer.phone}
            </a>
          </div>
        ) : null}
        {customer.email ? (
          <div className="flex items-center gap-2">
            <Mail className="size-4 text-muted-foreground" />
            <a href={`mailto:${customer.email}`} className="hover:underline">
              {customer.email}
            </a>
          </div>
        ) : null}
        {customer.company ? (
          <div className="flex items-center gap-2">
            <Building2 className="size-4 text-muted-foreground" />
            {customer.company}
          </div>
        ) : null}
        {hasAddress ? (
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div>
              {customer.street ? <div>{customer.street}</div> : null}
              {cityLine(customer) ? <div>{cityLine(customer)}</div> : null}
            </div>
          </div>
        ) : null}

        {!customer.phone && !customer.email && !customer.company && !hasAddress ? (
          <p className="text-muted-foreground">
            No contact details yet — click Edit to add them.
          </p>
        ) : null}

        {customer.source ? (
          <p className="border-t pt-3 text-muted-foreground">
            Lead source:{" "}
            <span className="text-foreground">
              {LEAD_SOURCE_LABELS[customer.source]}
            </span>
          </p>
        ) : null}

        {customer.notes ? (
          <div className="border-t pt-3">
            <p className="mb-1 font-medium">Notes</p>
            <p className="whitespace-pre-wrap text-muted-foreground">
              {customer.notes}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
