import { Check } from "lucide-react";
import { SubmitButton } from "@/components/ui/submit-button";
import { markContacted } from "../actions";

/**
 * Step one, in one click.
 *
 * "Talk to the customer" was only ever provable by going to the Activity tab
 * and typing something — a whole detour to record a fact you already knew. This
 * ticks it where you're standing. It still writes a real activity row (see
 * `markContacted`), so the log, the checklist and the pipeline stay one story;
 * the Activity tab is still there when the call is worth more than a tick.
 */
export function MarkContacted({ customerId }: { customerId: string }) {
  return (
    <form action={markContacted} className="inline">
      <input type="hidden" name="customer_id" value={customerId} />
      <SubmitButton size="sm" confirm="Marked as contacted" pendingText="Saving…">
        <Check className="size-3.5" /> Mark contacted
      </SubmitButton>
    </form>
  );
}
