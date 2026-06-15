"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg p-6">
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <p className="font-medium text-destructive">Something went wrong.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {error.message || "An unexpected error occurred."}
          {error.digest ? ` (ref: ${error.digest})` : ""}
        </p>
        <Button className="mt-3" size="sm" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}
