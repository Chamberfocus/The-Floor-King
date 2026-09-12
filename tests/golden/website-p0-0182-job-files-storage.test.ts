/**
 * 0182 job-files storage least privilege — SOURCE CONTRACT TESTED.
 * No live JWT harness: do not claim production crew/customer proof.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isJobFilesObjectPathForJob,
  jobFilesObjectPathError,
  parseJobFilesStorageJobId,
} from "@/lib/job-files-path";

const ROOT = join(__dirname, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const sql0182 = read(
  "supabase/migrations/0182_job_files_storage_least_privilege.sql",
);
const sql0008 = read("supabase/migrations/0008_job_files.sql");
const sql0179 = read("supabase/migrations/0179_final_pre_live_readiness.sql");
const sql0180 = read("supabase/migrations/0180_crew_my_work_visibility.sql");
const fileActions = read("src/app/(app)/jobs/file-actions.ts");
const signaturePad = read("src/app/(app)/jobs/signature-pad.tsx");
const jobsData = read("src/lib/data/jobs.ts");
const woActions = read("src/app/(app)/jobs/[id]/wo-actions.ts");
const jobPage = read("src/app/(app)/jobs/[id]/page.tsx");

const JOB_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("0182 source: drop broad storage ALL, split commands", () => {
  it("drops job_files_storage_rw (the 0008 whole-bucket crew grant)", () => {
    expect(sql0008).toContain("job_files_storage_rw");
    expect(sql0008).toMatch(/for all to authenticated/);
    expect(sql0008).toContain("public.user_role(auth.uid()) in ('admin', 'office', 'crew')");
    expect(sql0182).toContain('drop policy if exists "job_files_storage_rw"');
    expect(sql0182).toContain("drop policy if exists job_files_storage_rw");
    expect(sql0182).not.toMatch(/create policy ["']?job_files_storage_rw/i);
  });

  it("creates command-split policies, not a new FOR ALL", () => {
    expect(sql0182).toContain("job_files_storage_select");
    expect(sql0182).toContain("job_files_storage_insert");
    expect(sql0182).toContain("job_files_storage_update");
    expect(sql0182).toContain("job_files_storage_delete");
    const select = sql0182.slice(sql0182.indexOf("create policy job_files_storage_select"));
    expect(select).toMatch(/for select to authenticated/);
    const insert = sql0182.slice(sql0182.indexOf("create policy job_files_storage_insert"));
    expect(insert).toMatch(/for insert to authenticated/);
    const update = sql0182.slice(sql0182.indexOf("create policy job_files_storage_update"));
    expect(update).toMatch(/for update to authenticated/);
    expect(update).toContain("public.is_staff()");
    const del = sql0182.slice(sql0182.indexOf("create policy job_files_storage_delete"));
    expect(del).toMatch(/for delete to authenticated/);
    expect(del).toContain("public.is_staff()");
    expect(sql0182).not.toMatch(
      /create policy job_files_storage_\w+[\s\S]{0,80}for all/i,
    );
  });

  it("does not grant warehouse, customer, or anon on job-files storage", () => {
    expect(sql0182).not.toMatch(/to anon/);
    expect(sql0182).not.toMatch(/to public/);
    expect(sql0182).not.toContain("'warehouse'");
    expect(sql0182).not.toContain("'customer'");
    expect(sql0182).not.toContain("user_role != 'customer'");
    expect(sql0182).not.toContain("my_role() <> 'customer'");
  });

  it("does not undo 0179 documents_storage_rw", () => {
    expect(sql0182).toContain("0179 documents_storage_rw is untouched");
    expect(sql0182).not.toMatch(/drop policy if exists documents_storage_rw/);
    expect(sql0179).toContain("create policy documents_storage_rw on storage.objects");
    expect(sql0179).toContain("'admin', 'office', 'sales_manager', 'scheduler', 'salesman'");
  });

  it("does not grant crew-linked INSERT/UPDATE/DELETE (0180 write parity)", () => {
    expect(sql0180).toContain("grant INSERT/UPDATE/DELETE on job_files to crew-linked users");
    const writeFn = sql0182.slice(
      sql0182.indexOf("create or replace function public.can_write_job_files_object"),
      sql0182.indexOf("revoke all on function public.can_write_job_files_object"),
    );
    expect(writeFn).toContain("public.is_staff()");
    expect(writeFn).toContain("j.assigned_to = auth.uid()");
    expect(writeFn).not.toContain("installer_linked_crew_ids");
    expect(writeFn).not.toContain("assigned_crew_id");
  });

  it("SELECT includes assigned_to, linked crew, staff, sales book — not open_for_claim", () => {
    const readFn = sql0182.slice(
      sql0182.indexOf("create or replace function public.can_read_job_files_object"),
      sql0182.indexOf("revoke all on function public.can_read_job_files_object"),
    );
    expect(readFn).toContain("security definer");
    expect(readFn).toContain("set search_path = public");
    expect(readFn).toContain("public.is_staff()");
    expect(readFn).toContain("j.assigned_to = auth.uid()");
    expect(readFn).toContain("c.profile_id = auth.uid()");
    expect(readFn).toContain("c.active = true");
    expect(readFn).toContain("mine_job");
    expect(readFn).toContain("sales_manager");
    expect(readFn).toContain("salesman");
    expect(readFn).not.toContain("open_for_claim");
  });

  it("helpers revoke anon/public and are not security definer for the path parser", () => {
    const pathFn = sql0182.slice(
      sql0182.indexOf("create or replace function public.job_files_storage_job_id"),
      sql0182.indexOf("revoke all on function public.job_files_storage_job_id"),
    );
    expect(pathFn).not.toMatch(/security definer/i);
    expect(sql0182).toContain(
      "revoke all on function public.job_files_storage_job_id(text) from public, anon",
    );
    expect(sql0182).toContain(
      "revoke all on function public.can_read_job_files_object(uuid) from public, anon",
    );
    expect(sql0182).toContain(
      "revoke all on function public.can_write_job_files_object(uuid) from public, anon",
    );
  });

  it("never writes accounting activation flags", () => {
    expect(sql0182).toContain("Do NOT set posting_enabled");
    expect(sql0182).not.toMatch(/posting_enabled\s*=/);
  });
});

describe("path convention (behavioral unit)", () => {
  it("parses {jobUuid}/filename and rejects traversal / other jobs", () => {
    expect(parseJobFilesStorageJobId(`${JOB_A}/signature-1.png`)).toBe(JOB_A);
    expect(isJobFilesObjectPathForJob(JOB_A, `${JOB_A}/signature-1.png`)).toBe(
      true,
    );
    expect(isJobFilesObjectPathForJob(JOB_A, `${JOB_B}/signature-1.png`)).toBe(
      false,
    );
    expect(parseJobFilesStorageJobId(`${JOB_A}/../${JOB_B}/x.png`)).toBe(null);
    expect(parseJobFilesStorageJobId("not-a-uuid/file.png")).toBe(null);
    expect(parseJobFilesStorageJobId(JOB_A)).toBe(null);
    expect(parseJobFilesStorageJobId(`/${JOB_A}/x.png`)).toBe(null);
    expect(jobFilesObjectPathError(JOB_A, `${JOB_B}/a.png`)).toMatch(/match/i);
  });

  it("ADMIN/OFFICE delete UI stays staff-only; crew cannot call storage remove via UI", () => {
    expect(jobPage).toContain("deleteJobFile");
    expect(jobPage).toContain("{isStaff ? (");
    expect(fileActions).toContain('prof?.role !== "admin" && prof?.role !== "office"');
    expect(fileActions).toContain('.from("job-files").remove');
  });

  it("upload path is server-validated against jobId (client job path is not trusted)", () => {
    expect(fileActions).toContain("jobFilesObjectPathError");
    expect(fileActions).toContain('prof.role === "customer"');
    expect(signaturePad).toContain("upsert: false");
    expect(signaturePad).toContain("${jobId}/signature-");
    expect(signaturePad).toContain("jobFilesObjectPathError");
  });

  it("reads use user-JWT signed URLs (3600s) after storage SELECT — not public URLs", () => {
    expect(jobsData).toContain("supabase.storage");
    expect(jobsData).toContain('.from("job-files")');
    expect(jobsData).toContain("createSignedUrl(f.path, 3600)");
    expect(jobsData).not.toContain("getPublicUrl");
  });

  it("completed-job photos stay on documents via jobWriter — not a second job-files write path", () => {
    expect(woActions).toContain('from("documents")');
    expect(woActions).toContain("kind: \"completed\"");
    expect(woActions).not.toContain("job-files");
  });
});
