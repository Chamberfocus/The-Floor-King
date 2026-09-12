/**
 * IPv4-reachable dump target. Vercel Functions cannot connect to IPv6-only
 * `db.<ref>.supabase.co` hosts. Session-mode pooler (port 5432) has A records.
 * Never log hosts, IPs, or passwords.
 */

const REGION = /^[a-z0-9-]+$/;
const PROJECT_REF = /^[a-z0-9]{10,40}$/;

export function supabaseProjectRefFromPublicUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    const match = /^([a-z0-9]+)\.supabase\.co$/.exec(host);
    if (!match?.[1] || !PROJECT_REF.test(match[1])) return null;
    return match[1];
  } catch {
    return null;
  }
}

export function sessionPoolerUser(directUser: string, projectRef: string): string {
  const user = directUser.trim();
  if (user.includes(".")) return user;
  return `postgres.${projectRef}`;
}

export function sessionPoolerHost(region: string): string {
  if (!REGION.test(region)) throw new Error("PG_DUMP:pooler_region");
  return `aws-0-${region}.pooler.supabase.com`;
}

/** Cleveland shop: Ohio (us-east-2) then East US (us-east-1). Optional override. */
export function dumpPoolerRegionCandidates(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const out: string[] = [];
  const fromEnv = env.SUPABASE_POOLER_REGION?.trim();
  if (fromEnv && REGION.test(fromEnv)) out.push(fromEnv);
  for (const region of ["us-east-2", "us-east-1"]) {
    if (!out.includes(region)) out.push(region);
  }
  return out;
}

export function isRetryablePoolerFailure(code: string): boolean {
  return (
    code === "PG_DUMP:pooler_tenant" ||
    code === "PG_DUMP:connection" ||
    code === "PG_DUMP:ipv4_required" ||
    code.startsWith("PG_DUMP:exit_")
  );
}
