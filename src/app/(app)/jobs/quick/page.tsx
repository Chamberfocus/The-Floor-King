import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";

/**
 * "Quick install" was a third way to make a job, and you had to know which of
 * the three you were meant to be in before you started typing. It could do two
 * things /jobs/new couldn't — add the customer on the spot, and book the date —
 * so both moved there rather than the page surviving beside it.
 *
 * It also stamped every job it made `migrated: true`, a marker meaning "billed
 * in the old system", which permanently hides a job from Business Pulse profit
 * (src/lib/data/finance.ts). Right for a go-live carry-over, wrong for work sold
 * this morning. /jobs/new doesn't set it; /carry-over still does, correctly.
 */
export default async function QuickInstallRedirect() {
  await requireProfile();
  redirect("/jobs/new");
}
