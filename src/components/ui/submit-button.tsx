"use client";

import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Variant = React.ComponentProps<typeof Button>["variant"];
type Size = React.ComponentProps<typeof Button>["size"];

/**
 * Drop-in submit button for server-action forms. While the form is submitting
 * it disables itself (no double-clicks → no duplicate records) and shows a
 * spinner; when it finishes it pops a confirmation toast.
 *
 * Usage: <form action={save}><SubmitButton>Save</SubmitButton></form>
 */
export function SubmitButton({
  children,
  pendingText,
  confirm = "Saved",
  variant,
  size,
  className,
}: {
  children: React.ReactNode;
  pendingText?: string;
  /** Toast shown when the submit completes. Pass null to show none. */
  confirm?: string | null;
  variant?: Variant;
  size?: Size;
  className?: string;
}) {
  const { pending } = useFormStatus();
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && confirm) toast.success(confirm);
    wasPending.current = pending;
  }, [pending, confirm]);

  return (
    <Button
      type="submit"
      disabled={pending}
      variant={variant}
      size={size}
      className={className}
    >
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" />
          {pendingText ?? "Saving…"}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
