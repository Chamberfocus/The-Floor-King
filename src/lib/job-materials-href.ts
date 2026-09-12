/** Job page warehouse tab — canonical post-approval materials / PO review. */
export const JOB_MATERIALS_TAB = "warehouse";

export function jobMaterialsHref(jobId: string): string {
  return `/jobs/${jobId}?tab=${JOB_MATERIALS_TAB}`;
}
