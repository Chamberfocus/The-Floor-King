"use client";

import { useState } from "react";
import Link from "next/link";
import { Sparkles, Plus } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SearchPicker } from "@/components/ui/search-picker";
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
        <Label>Customer</Label>
        <SearchPicker
          value={id}
          onChange={setId}
          placeholder="Search a customer…"
          options={customers.map((c) => ({ value: c.id, label: c.full_name }))}
        />
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
