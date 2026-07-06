"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Print the current month calendar (the page's print styles do the rest). */
export function PrintButton() {
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
      <Printer className="size-4" /> Print
    </Button>
  );
}
