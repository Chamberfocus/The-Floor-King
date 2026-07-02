"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Opens the browser print dialog (which also does "Save as PDF"). Drop it on any
 * page that renders a `print:block` document so there's always a clear way to
 * print or download it. The page's on-screen UI should be wrapped in
 * `print:hidden` so only the document prints.
 */
export function PrintButton({
  label = "Print / Download PDF",
  variant = "outline",
  size = "default",
  className,
}: {
  label?: string;
  variant?: "outline" | "default" | "ghost" | "secondary";
  size?: "sm" | "default" | "lg";
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={() => window.print()}
    >
      <Printer className="size-4" /> {label}
    </Button>
  );
}
