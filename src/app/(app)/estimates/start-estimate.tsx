"use client";

import { useState } from "react";
import Link from "next/link";
import { Sparkles, Plus } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { createEstimate } from "./actions";

export function StartEstimate({
  customers,
}: {
  customers: { id: string; full_name: string }[];
}) {
  const [id, setId] = useState(customers[0]?.id ?? "");

  if (customers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No customers yet.{" "}
        <Link href="/customers/new" className="underline">
          Add a customer
        </Link>{" "}
        first, then start an estimate.
      </p>
    );
  }

  return (
    <div className="max-w-md space-y-4">
      <div className="space-y-2">
        <Label htmlFor="customer">Customer</Label>
        <select
          id="customer"
          value={id}
          onChange={(e) => setId(e.target.value)}
          className={cn(
            "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.full_name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href={`/estimates/new?customer=${id}`}
          className={buttonVariants({ size: "lg" })}
        >
          <Sparkles className="size-4" /> Continue with Wizard
        </Link>
        <form action={createEstimate}>
          <input type="hidden" name="customer_id" value={id} />
          <Button type="submit" variant="outline" size="lg">
            <Plus className="size-4" /> Blank estimate
          </Button>
        </form>
      </div>

      <p className="text-sm text-muted-foreground">
        or{" "}
        <Link href="/customers/new" className="underline">
          add a new customer
        </Link>{" "}
        first.
      </p>
    </div>
  );
}
