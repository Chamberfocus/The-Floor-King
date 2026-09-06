/** Form contract for warehouse submit — must read `job_id` (not `id`). */
export function warehouseJobIdFromForm(formData: FormData): string | null {
  const id = formData.get("job_id");
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/** Browser JWT roles allowed on storage.objects documents (0179). */
export const DOCUMENTS_STORAGE_JWT_ROLES = [
  "admin",
  "office",
  "sales_manager",
  "scheduler",
  "salesman",
] as const;

export type JobMeasurementUploadAuth =
  | { ok: true; useAdmin: boolean }
  | { ok: false; error: string };

/**
 * Who may attach a measurement/work-order file, and whether the write must use
 * the server-only service_role client (never returned to the browser).
 *
 * Warehouse/crew have no documents-bucket JWT after 0179. Crew must be assigned.
 * Warehouse may upload only when the job is visible under their RLS session.
 */
export function authorizeJobMeasurementUpload(args: {
  role: string | null | undefined;
  userId: string;
  jobAssignedTo: string | null;
  jobVisible: boolean;
}): JobMeasurementUploadAuth {
  const role = args.role ?? "";
  if (!args.userId) return { ok: false, error: "Please sign in again." };
  if (role === "customer") return { ok: false, error: "Not allowed." };
  if (!args.jobVisible) return { ok: false, error: "Not your job." };

  if ((DOCUMENTS_STORAGE_JWT_ROLES as readonly string[]).includes(role)) {
    return { ok: true, useAdmin: false };
  }
  if (role === "crew") {
    if (args.jobAssignedTo !== args.userId) {
      return { ok: false, error: "Not your job." };
    }
    return { ok: true, useAdmin: true };
  }
  if (role === "warehouse") {
    return { ok: true, useAdmin: true };
  }
  return { ok: false, error: "Not allowed." };
}
