import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";

/**
 * "Estimate Schedule" was a second home for the appointments the Booking
 * Calendar already owned — same rows, different page, its own nav entry. Two
 * places to look for one answer is how you end up trusting neither.
 *
 * The list itself was worth keeping, so it moved to the calendar as its Agenda
 * view (`/calendar?view=agenda`), route links and all. This redirect keeps every
 * old link, bookmark and revalidatePath("/schedule") call working.
 */
export default async function EstimateScheduleRedirect() {
  await requireProfile();
  redirect("/calendar?view=agenda");
}
