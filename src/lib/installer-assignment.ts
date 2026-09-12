/**
 * Who may see a job on My Work / crew-scoped lists.
 *
 * A. assigned_to = this user, OR
 * B. assigned_crew_id is an active crew whose profile_id is this user.
 *
 * Crew membership is install_crews.profile_id (one login per crew) — there is
 * no separate membership table.
 */

export function installerSeesJob(args: {
  assignedTo: string | null | undefined;
  assignedCrewId: string | null | undefined;
  userId: string;
  memberCrewIds: readonly string[];
}): boolean {
  if (!args.userId) return false;
  if (args.assignedTo === args.userId) return true;
  const crewId = args.assignedCrewId ?? null;
  return Boolean(crewId && args.memberCrewIds.includes(crewId));
}

export function dedupeJobsById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

/** PostgREST `.or()` filter: direct assignment and/or linked crews. */
export function installerAssignmentOrFilter(
  userId: string,
  memberCrewIds: readonly string[],
): string {
  if (!memberCrewIds.length) return `assigned_to.eq.${userId}`;
  return `assigned_to.eq.${userId},assigned_crew_id.in.(${memberCrewIds.join(",")})`;
}
