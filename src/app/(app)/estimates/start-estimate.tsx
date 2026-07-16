"use client";

import { useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
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

      <form action={createEstimate}>
        <input type="hidden" name="customer_id" value={id} />
        <Button type="submit" size="lg">
          <Sparkles className="size-4" /> Build estimate
        </Button>
      </form>

      <p className="text-sm text-muted-foreground">
        Opens the estimate builder — measure rooms, add materials, and price it,
        all in one place. Or{" "}
        <Link href="/customers/new" className="underline">
          add a new customer
        </Link>{" "}
        first.
      </p>
    </div>
  );
}
