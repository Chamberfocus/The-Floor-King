/**
 * 0180 RLS adversarial contracts — crew visibility without generic jobs UPDATE.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installerSeesJob } from "@/lib/installer-assignment";

const ROOT = join(__dirname, "../..");
const sql0180 = readFileSync(
  join(ROOT, "supabase/migrations/0180_crew_my_work_visibility.sql"),
  "utf8",
);
const woActions = readFileSync(
  join(ROOT, "src/app/(app)/jobs/[id]/wo-actions.ts"),
  "utf8",
);
const jobPage = readFileSync(
  join(ROOT, "src/app/(app)/jobs/[id]/page.tsx"),
  "utf8",
);
const jobs0005 = readFileSync(
  join(ROOT, "supabase/migrations/0005_jobs.sql"),
  "utf8",
);
const files0008 = readFileSync(
  join(ROOT, "supabase/migrations/0008_job_files.sql"),
  "utf8",
);
const jobs0010 = readFileSync(
  join(ROOT, "supabase/migrations/0010_installer_warehouse.sql"),
  "utf8",
);

describe("0180 least-privilege SQL", () => {
  it("does not DROP/replace jobs_crew_update (assigned_to write path stays)", () => {
    expect(sql0180).not.toMatch(/drop policy if exists jobs_crew_update/i);
    expect(sql0180).toContain("jobs_crew_update remains assigned_to only");
    expect(jobs0005).toMatch(
      /jobs_crew_update[\s\S]*using \(assigned_to = auth\.uid\(\)\)/,
    );
  });

  it("does not DROP/replace job_files_access FOR ALL", () => {
    expect(sql0180).not.toMatch(/drop policy if exists job_files_access/i);
    expect(files0008).toMatch(/job_files_access[\s\S]*for all to authenticated/);
  });

  it("jobs_crew_read is SELECT-only and keeps assigned_to + open_for_claim", () => {
    expect(sql0180).toMatch(/jobs_crew_read[\s\S]*for select to authenticated/);
    expect(sql0180).toContain("assigned_to = auth.uid()");
    expect(sql0180).toContain("open_for_claim = true");
    expect(jobs0010).toContain("assigned_to = auth.uid() or open_for_claim = true");
  });

  it("crew-linked SELECT uses active profile_id crews only", () => {
    expect(sql0180).toContain("c.profile_id = auth.uid()");
    expect(sql0180).toContain("c.active = true");
    expect(sql0180).toContain("assigned_crew_id in (select public.installer_linked_crew_ids())");
  });

  it("helper is SECURITY INVOKER with fixed search_path; not DEFINER", () => {
    const fn = sql0180.slice(sql0180.indexOf("create or replace function public.installer_linked_crew_ids()"));
    expect(fn).toMatch(/security invoker/i);
    expect(fn).not.toMatch(/security definer/i);
    expect(sql0180).toContain("set search_path = public");
    expect(sql0180).toContain(
      "revoke all on function public.installer_linked_crew_ids() from public, anon",
    );
  });

  it("job_files crew-linked policy is SELECT only", () => {
    expect(sql0180).toContain("job_files_linked_crew_read");
    const start = sql0180.indexOf("job_files_linked_crew_read");
    const block = sql0180.slice(start, start + 500);
    expect(block).toMatch(/for select to authenticated/);
    expect(block).not.toMatch(/for all/i);
    expect(block).not.toMatch(/for insert/i);
    expect(block).not.toMatch(/for update/i);
    expect(block).not.toMatch(/for delete/i);
  });

  it("job_line_items crew policy remains SELECT", () => {
    const start = sql0180.indexOf("job_line_items_crew_read");
    const block = sql0180.slice(start, start + 400);
    expect(block).toMatch(/for select to authenticated/);
  });
});

describe("0180 authorization semantics (helpers + app gates)", () => {
  const user = "user-a";
  const crewA = "crew-a";
  const crewB = "crew-b";

  it("crew-linked user reads assigned job conceptually", () => {
    expect(
      installerSeesJob({
        assignedTo: null,
        assignedCrewId: crewA,
        userId: user,
        memberCrewIds: [crewA],
      }),
    ).toBe(true);
  });

  it("unrelated crew cannot read job", () => {
    expect(
      installerSeesJob({
        assignedTo: null,
        assignedCrewId: crewB,
        userId: user,
        memberCrewIds: [crewA],
      }),
    ).toBe(false);
  });

  it("direct-assigned installer still works", () => {
    expect(
      installerSeesJob({
        assignedTo: user,
        assignedCrewId: null,
        userId: user,
        memberCrewIds: [],
      }),
    ).toBe(true);
  });

  it("inactive crew is not in memberCrewIds → no access", () => {
    expect(
      installerSeesJob({
        assignedTo: null,
        assignedCrewId: crewA,
        userId: user,
        memberCrewIds: [],
      }),
    ).toBe(false);
  });

  it("jobWriter crew-linked path requires active crew + profile_id", () => {
    expect(woActions).toContain("assigned_crew_id");
    expect(woActions).toContain('.eq("profile_id", user.id)');
    expect(woActions).toContain('.eq("active", true)');
    expect(woActions).toContain('return { error: "Not your job."');
  });

  it("crew-linked users do not get Start/Complete (jobs UPDATE) or schedule picker", () => {
    expect(jobPage).toContain("canDirectFieldActions");
    expect(jobPage).toContain("isStaff || isDirectAssignee");
    expect(jobPage).toContain("canDirectFieldActions && job.status !== \"completed\"");
  });

  it("0180 does not grant jobs UPDATE to crew-linked users", () => {
    expect(sql0180).not.toMatch(/create policy jobs_crew_update/i);
  });
});
