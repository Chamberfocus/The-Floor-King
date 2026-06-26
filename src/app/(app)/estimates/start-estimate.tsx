"use client";

import { useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SearchPicker } from "@/components/ui/search-picker";

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

      <Link
        href={`/estimates/smart?customer=${id}`}
        className={buttonVariants({ size: "lg" })}
      >
        <Sparkles className="size-4" /> Build estimate
      </Link>

      <p className="text-sm text-muted-foreground">
        You&apos;ll pick the Wizard (step-by-step) or Quick estimate on the next
        screen. Or{" "}
        <Link href="/customers/new" className="underline">
          add a new customer
        </Link>{" "}
        first.
      </p>
    </div>
  );
}
