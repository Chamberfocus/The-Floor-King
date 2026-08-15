import { redirect } from "next/navigation";

/**
 * Pipeline is now Client status.
 *
 * Same customers, same stages, folded into six lanes instead of thirteen
 * headings. Kept as a redirect so bookmarks, saved links and anything still
 * pointing here land in the right place rather than 404ing.
 */
export default function PipelineRedirect() {
  redirect("/client-status");
}
