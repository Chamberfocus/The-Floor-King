/** Storage object keys for the private `job-files` bucket.
 *  Canonical: `{jobUuid}/{filename}` — job id is the first path segment. */

const JOB_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseJobFilesStorageJobId(
  objectName: string | null | undefined,
): string | null {
  if (!objectName) return null;
  if (objectName.includes("..")) return null;
  const slash = objectName.indexOf("/");
  if (slash < 1) return null;
  const prefix = objectName.slice(0, slash);
  if (!JOB_UUID_RE.test(prefix)) return null;
  const rest = objectName.slice(slash + 1);
  if (!rest) return null;
  return prefix;
}

export function jobFilesObjectPathError(
  jobId: string,
  path: string,
): string | null {
  const parsed = parseJobFilesStorageJobId(path);
  if (!parsed) return "Invalid job file path.";
  if (parsed.toLowerCase() !== jobId.trim().toLowerCase()) {
    return "File path does not match this job.";
  }
  return null;
}

export function isJobFilesObjectPathForJob(jobId: string, path: string): boolean {
  return jobFilesObjectPathError(jobId, path) === null;
}
