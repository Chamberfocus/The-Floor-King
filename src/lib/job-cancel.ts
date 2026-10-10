/**
 * Job cancellation and reservation release.
 * A cancel is successful only when every outstanding reservation is released
 * and the job status changes in the same database transaction. A repeated
 * cancel releases nothing further and leaves an already-cancelled job cancelled.
 * Completed jobs, invoices, labor, installer bills, and commissions are not touched.
 */

export const JOB_CANCEL_RELEASE_FAILED =
  "This job was not cancelled. Reserved material could not be released, so the job status was left unchanged.";

export const JOB_CANCEL_UNAVAILABLE =
  "This job was not cancelled. The reservation guard is not installed, so the job status was left unchanged.";

export const JOB_CANCEL_COMPLETED =
  "Completed jobs stay on the books. Cancel was not applied.";

export type JobCancelResult =
  | { ok: true; alreadyCancelled: boolean }
  | { ok: false; error: string };

type RpcPayload = {
  ok?: boolean;
  code?: string;
  already_cancelled?: boolean;
  error?: string;
};

export function cancelJobRpcOutcome(args: {
  errorMessage: string | null | undefined;
  payload: unknown;
}): JobCancelResult {
  const message = args.errorMessage ?? "";
  if (message) {
    if (
      /cancel_job_with_reservations|schema cache|could not find the function/i.test(message)
    ) {
      return { ok: false, error: JOB_CANCEL_UNAVAILABLE };
    }
    return { ok: false, error: JOB_CANCEL_RELEASE_FAILED };
  }

  const payload = (args.payload ?? null) as RpcPayload | null;
  if (!payload || payload.ok !== true) {
    if (payload?.code === "JOB_COMPLETED") return { ok: false, error: JOB_CANCEL_COMPLETED };
    return { ok: false, error: JOB_CANCEL_RELEASE_FAILED };
  }
  return { ok: true, alreadyCancelled: payload.already_cancelled === true };
}

type JobCancelClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export async function cancelJobWithReservations(
  db: JobCancelClient,
  jobId: string,
): Promise<JobCancelResult> {
  const { data, error } = await db.rpc("cancel_job_with_reservations", {
    p_job_id: jobId,
  });
  return cancelJobRpcOutcome({ errorMessage: error?.message ?? null, payload: data });
}
