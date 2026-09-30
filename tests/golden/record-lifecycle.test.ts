import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  archiveState,
  assessLifecycle,
  auditDetail,
  canArchiveRole,
  canDeleteForeverRole,
  confirmPhrase,
  LIFECYCLE_ARCHIVE_ROLES,
  LIFECYCLE_DELETE_ROLES,
  phraseMatches,
  restoreState,
  type LifecycleFacts,
} from "@/lib/record-lifecycle";

const root = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

function facts(partial: Partial<LifecycleFacts> & Pick<LifecycleFacts, "recordType">): LifecycleFacts {
  return {
    recordId: "11111111-1111-4111-8111-111111111111",
    exists: true,
    archivedAt: null,
    publicCode: "CUS-ABC123",
    status: null,
    counts: {},
    flags: {},
    ...partial,
  };
}

describe("record lifecycle decisions", () => {
  it("archives and restores without treating closed as archived", () => {
    const open = facts({ recordType: "customer" });
    const impact = assessLifecycle(open);
    expect(impact.canArchive).toBe(true);
    expect(impact.canRestore).toBe(false);
    expect(archiveState(null)).toBe("archive");
    expect(archiveState("2026-01-01")).toBe("already_archived");
    expect(restoreState(null)).toBe("already_active");
    expect(restoreState("2026-01-01")).toBe("restore");
  });

  it("lets an administrator delete a customer that only has a draft estimate", () => {
    const impact = assessLifecycle(
      facts({
        recordType: "customer",
        counts: { draft_estimates: 1, documents: 2, activities: 1 },
      }),
    );
    expect(impact.canDeleteForever).toBe(true);
    expect(impact.willDelete.map((line) => line.key)).toEqual(
      expect.arrayContaining(["draft_estimates", "documents", "customer"]),
    );
    expect(impact.blockingReasons).toEqual([]);
    expect(impact.confirmPhrase).toBe("DELETE CUS-ABC123");
    expect(phraseMatches(impact.confirmPhrase, "delete cus-abc123")).toBe(true);
    expect(phraseMatches(impact.confirmPhrase, "DELETE")).toBe(false);
  });

  it("blocks customer deletion when an invoice, payment, or order exists", () => {
    for (const key of ["invoices", "payments", "orders", "credit_memos", "deposits", "purchase_orders"]) {
      const impact = assessLifecycle(facts({ recordType: "customer", counts: { [key]: 1 } }));
      expect(impact.canDeleteForever).toBe(false);
      expect(impact.willDelete).toEqual([]);
      expect(impact.willPreserve.length).toBeGreaterThan(0);
    }
  });

  it("blocks customer deletion when a job has history and keeps orphan orders", () => {
    const impact = assessLifecycle(
      facts({
        recordType: "customer",
        counts: { protected_jobs: 1, orders: 1, safe_jobs: 0 },
      }),
    );
    expect(impact.canDeleteForever).toBe(false);
    expect(impact.blockingReasons.join(" ")).toMatch(/orders|jobs/);
  });

  it("allows a draft estimate delete and blocks approved or converted estimates", () => {
    const draft = assessLifecycle(facts({ recordType: "estimate", status: "draft", publicCode: "EST-1" }));
    expect(draft.canDeleteForever).toBe(true);
    const approved = assessLifecycle(
      facts({ recordType: "estimate", status: "approved", publicCode: "EST-1", counts: { approval_snapshots: 1, jobs: 1 } }),
    );
    expect(approved.canDeleteForever).toBe(false);
    expect(approved.willPreserve.map((line) => line.key)).toEqual(
      expect.arrayContaining(["status", "jobs", "approval_snapshots"]),
    );
  });

  it("allows only an unstarted job with no history", () => {
    const clean = assessLifecycle(facts({ recordType: "job", status: "unscheduled", flags: { scheduled: false } }));
    expect(clean.canDeleteForever).toBe(true);
    const done = assessLifecycle(
      facts({
        recordType: "job",
        status: "completed",
        counts: { signatures: 1, invoices: 1, files: 2 },
      }),
    );
    expect(done.canDeleteForever).toBe(false);
  });

  it("allows a draft invoice and blocks paid, credited, or written-off invoices", () => {
    const draft = assessLifecycle(
      facts({ recordType: "invoice", status: "draft", publicCode: "1042", counts: { items: 3 } }),
    );
    expect(draft.canDeleteForever).toBe(true);
    expect(draft.confirmPhrase).toBe("DELETE 1042");
    for (const key of ["payments", "credit_applications", "write_offs", "deposit_applications"]) {
      const blocked = assessLifecycle(
        facts({ recordType: "invoice", status: "draft", counts: { [key]: 1 } }),
      );
      expect(blocked.canDeleteForever).toBe(false);
    }
    const sent = assessLifecycle(facts({ recordType: "invoice", status: "sent" }));
    expect(sent.canDeleteForever).toBe(false);
  });

  it("never permanently deletes a payment", () => {
    const impact = assessLifecycle(facts({ recordType: "payment", publicCode: "PAY-1" }));
    expect(impact.canDeleteForever).toBe(false);
    expect(impact.canArchive).toBe(false);
    expect(impact.blockingReasons[0]).toMatch(/voided/i);
  });

  it("archives referenced products, vendors, and installers instead of deleting them", () => {
    const usedProduct = assessLifecycle(
      facts({ recordType: "product", counts: { estimate_lines: 2, stock_movements: 1 } }),
    );
    expect(usedProduct.canArchive).toBe(true);
    expect(usedProduct.canDeleteForever).toBe(false);
    const freshProduct = assessLifecycle(facts({ recordType: "product", counts: { product_vendors: 1 } }));
    expect(freshProduct.canDeleteForever).toBe(true);
    const vendor = assessLifecycle(facts({ recordType: "supplier", counts: { purchase_orders: 1 } }));
    expect(vendor.canDeleteForever).toBe(false);
    expect(vendor.canArchive).toBe(true);
    const installer = assessLifecycle(facts({ recordType: "installer", counts: { jobs: 1 } }));
    expect(installer.canDeleteForever).toBe(false);
    const unusedInstaller = assessLifecycle(facts({ recordType: "installer" }));
    expect(unusedInstaller.canDeleteForever).toBe(true);
  });

  it("treats a missing record as already gone and does not invent a delete list", () => {
    const impact = assessLifecycle(facts({ recordType: "customer", exists: false }));
    expect(impact.exists).toBe(false);
    expect(impact.canDeleteForever).toBe(false);
    expect(impact.willDelete).toEqual([]);
  });

  it("recalculates when a dependency appears after the first preview", () => {
    const before = assessLifecycle(facts({ recordType: "customer", counts: { draft_estimates: 1 } }));
    const after = assessLifecycle(
      facts({ recordType: "customer", counts: { draft_estimates: 1, invoices: 1 } }),
    );
    expect(before.canDeleteForever).toBe(true);
    expect(after.canDeleteForever).toBe(false);
  });

  it("stores only counts on the audit detail", () => {
    const impact = assessLifecycle(
      facts({ recordType: "customer", counts: { documents: 2 } }),
    );
    const detail = auditDetail(impact);
    expect(detail.documents).toBe(2);
    expect(JSON.stringify(detail)).not.toMatch(/@|phone|street/i);
  });

  it("blocks sample checkouts, tasks, and portal logins on a customer", () => {
    for (const key of ["sample_checkouts", "office_tasks", "portal_profiles", "referrals"]) {
      const impact = assessLifecycle(facts({ recordType: "customer", counts: { [key]: 1 } }));
      expect(impact.canDeleteForever).toBe(false);
      expect(impact.willDelete).toEqual([]);
    }
  });

  it("names ephemeral customer children in the delete list", () => {
    const impact = assessLifecycle(
      facts({ recordType: "customer", counts: { handoffs: 2, service_addresses: 1, estimate_drafts: 1 } }),
    );
    expect(impact.canDeleteForever).toBe(true);
    expect(impact.willDelete.map((line) => line.key)).toEqual(
      expect.arrayContaining(["handoffs", "service_addresses", "estimate_drafts", "customer"]),
    );
  });

  it("does not confirm with a customer name", () => {
    expect(confirmPhrase("Pat Customer")).toBe("DELETE Pat Customer");
    expect(confirmPhrase("CUS-ABC123")).toBe("DELETE CUS-ABC123");
    expect(phraseMatches("DELETE CUS-ABC123", "Pat Customer")).toBe(false);
  });
});

describe("lifecycle authorization and schema guards", () => {
  const actions = read("src/app/(app)/lifecycle/actions.ts");
  const sql = read("supabase/migrations/0480_record_lifecycle.sql");
  const customers = read("src/app/(app)/customers/actions.ts");
  const estimates = read("src/app/(app)/estimates/actions.ts");
  const jobs = read("src/app/(app)/jobs/actions.ts");
  const invoices = read("src/app/(app)/invoices/actions.ts");
  const orders = read("src/app/(app)/orders/actions.ts");

  it("requires an administrator on the server before delete forever", () => {
    expect(actions).toContain("assertRole([...LIFECYCLE_DELETE_ROLES])");
    expect(actions).toContain('if (profile.role !== "admin")');
    expect(actions).toContain("lifecycle_commit_delete");
    expect(actions).toContain("phraseMatches");
    expect(sql).toContain("if not public.is_admin()");
    expect(sql).toContain("for update");
    expect(LIFECYCLE_DELETE_ROLES).toEqual(["admin"]);
  });

  it("refuses the old blind customer, estimate, job, and invoice deletes", () => {
    expect(customers).not.toContain('.from("customers").delete()');
    expect(customers).toContain("Nothing was deleted");
    expect(estimates).not.toContain("deleteEstimateRemoved");
    expect(estimates).toContain("Nothing was deleted");
    expect(estimates).toContain("Bulk permanent deletion is disabled");
    expect(jobs).toContain("Nothing was deleted");
    expect(invoices).toContain("Nothing was deleted");
    expect(invoices).not.toContain('.from("invoices").delete()');
  });

  it("tightens dangerous foreign keys and keeps an audit row", () => {
    expect(sql).toContain("ON DELETE RESTRICT");
    expect(sql).toContain("record_lifecycle_events");
    expect(sql).toContain("delete_forever");
    expect(sql).toContain("delete_blocked");
    expect(sql).toContain("record_lifecycle_storage_outbox");
    expect(sql).toContain("permanent delete must use the lifecycle confirmation");
    expect(sql).not.toContain("backup_pitr_confirmed_at");
    expect(sql).not.toContain("books_of_record");
  });

  it("hides archived rows from the active queues after the migration", () => {
    expect(sql).toContain("e.archived_at is null");
    expect(sql).toContain("i.archived_at is null");
    expect(sql).toContain("p.archived_at is null");
  });

  it("requires the exact confirmation code and deletes ephemeral children explicitly", () => {
    expect(sql).toContain("lifecycle_phrase_ok");
    expect(sql).toContain("lifecycle_public_code");
    expect(sql).not.toContain("not like 'DELETE %'");
    expect(sql).toContain("delete from public.handoffs");
    expect(sql).toContain("delete from public.service_addresses");
    expect(sql).toContain("delete from public.customer_areas");
    expect(sql).toContain("delete from public.estimate_drafts");
    expect(sql).toContain("delete from public.step_overrides");
    expect(sql).toContain("invoice_write_offs");
    const auditAt = sql.indexOf("values ('delete_forever', 'customer'");
    const deleteAt = sql.indexOf("delete from public.customers where id = p_id");
    expect(auditAt).toBeGreaterThan(-1);
    expect(deleteAt).toBeGreaterThan(auditAt);
  });

  it("does not let an order delete erase invoices or the order itself", () => {
    expect(orders).toContain("Orders are not permanently deleted from this screen. Nothing was deleted.");
    expect(orders).not.toContain('.from("invoices").delete()');
    expect(orders).not.toContain('.from("orders").delete()');
    expect(orders).not.toContain('.from("purchase_orders").delete()');
  });

  it("puts archive and administrator delete on installer crews", () => {
    const manager = read("src/app/(app)/settings/install-crews/install-crews-manager.tsx");
    const team = read("src/app/(app)/settings/team/page.tsx");
    const member = read("src/app/(app)/settings/team/team-member-row.tsx");
    const crews = read("src/lib/data/install-crews.ts");
    expect(manager).toContain('recordType="installer"');
    expect(manager).toContain("allowDelete={allowDelete}");
    expect(team).toContain("LifecycleFilter");
    expect(team).toContain("canDeleteForeverRole(me.role)");
    expect(team).toContain("allowDelete={mayDeleteForever}");
    expect(team).toContain('if (me.role !== "admin") redirect');
    expect(member).toContain('recordType="installer"');
    expect(member).toContain("allowDelete={allowDelete}");
    expect(crews).toContain('q.is("archived_at", null)');
    expect(crews).toContain('q.not("archived_at", "is", null)');
    expect(actions).toContain('revalidatePath("/settings/team")');
    expect(sql).toContain("'install_crews'");
    expect(sql).toContain("from public.job_labor where crew_id = p_id");
    expect(sql).toContain("from public.jobs where assigned_crew_id = p_id");
    expect(sql).toContain("from public.installer_bills where crew_id = p_id");
  });

  it("does not delete existing rows when the migration is applied", () => {
    const commitAt = sql.indexOf("create or replace function public.lifecycle_commit_delete");
    const firstDelete = sql.toLowerCase().indexOf("delete from");
    expect(commitAt).toBeGreaterThan(-1);
    expect(firstDelete).toBeGreaterThan(commitAt);
    expect(sql.toLowerCase()).not.toContain("truncate");
    expect(sql.toLowerCase()).not.toContain("drop table");
    expect(sql).not.toContain("delete from public.orders");
    expect(sql).toContain("add column if not exists archived_at timestamptz");
    expect(sql.toLowerCase()).not.toContain("archived_at timestamptz not null");
    expect(sql).not.toContain("books_of_record");
    expect(sql).not.toContain("backup_pitr_confirmed_at");
  });

  it("records a storage failure without storing a file name", () => {
    const db = read("src/lib/record-lifecycle-db.ts");
    expect(db).toContain("storage_remove_failed");
    expect(db).not.toContain("file_name");
  });

  it("lets only administrator and office archive or restore", () => {
    expect(LIFECYCLE_ARCHIVE_ROLES).toEqual(["admin", "office"]);
    expect(canArchiveRole("admin")).toBe(true);
    expect(canArchiveRole("office")).toBe(true);
    for (const role of [
      "scheduler",
      "sales_manager",
      "salesman",
      "warehouse",
      "crew",
      "customer",
      null,
      undefined,
      "",
    ]) {
      expect(canArchiveRole(role)).toBe(false);
    }
    expect(actions).toContain("assertRole([...LIFECYCLE_ARCHIVE_ROLES])");
    expect(actions).not.toContain("is_staff()");
    expect(sql).toContain("public.my_role() in ('admin', 'office')");
    expect(sql).toContain("if not public.lifecycle_may_archive()");
    expect(sql).toContain("archive requires an administrator or office role");
    expect(sql).toContain("lifecycle_archive_column_guard");
    expect(sql).toContain(
      "create trigger lifecycle_archive_column_guard before insert or update on public.%I",
    );
    expect(sql).not.toContain("is_admin() or public.is_staff()");
    expect(sql).not.toContain("create or replace function public.is_staff");
    expect(sql).toContain(
      "'customers', 'estimates', 'jobs', 'invoices', 'products', 'suppliers', 'install_crews'",
    );
    for (const file of [
      "src/app/(app)/customers/[id]/page.tsx",
      "src/app/(app)/estimates/page.tsx",
      "src/app/(app)/estimates/[id]/page.tsx",
      "src/app/(app)/invoices/page.tsx",
      "src/app/(app)/invoices/[id]/page.tsx",
      "src/app/(app)/jobs/[id]/page.tsx",
      "src/app/(app)/catalog/[id]/page.tsx",
      "src/app/(app)/settings/suppliers/[id]/page.tsx",
      "src/app/(app)/settings/team/page.tsx",
    ]) {
      expect(read(file)).toContain("canArchiveRole(");
    }
    expect(read("src/app/(app)/estimates/estimate-list-actions.tsx")).toContain(
      "allowArchive={canArchive}",
    );
    expect(read("src/app/(app)/invoices/delete-invoice-button.tsx")).toContain(
      "allowArchive={canArchive}",
    );
    expect(read("src/app/(app)/customers/[id]/job-roll-up.tsx")).toContain(
      "allowArchive={canArchive}",
    );
  });

  it("keeps delete forever on the administrator when the record is otherwise eligible", () => {
    const eligible = assessLifecycle(facts({ recordType: "customer", counts: {} }));
    expect(eligible.canDeleteForever).toBe(true);
    expect(canDeleteForeverRole("admin") && eligible.canDeleteForever).toBe(true);
    for (const role of ["office", "scheduler", "sales_manager", "salesman", "warehouse", "crew", "customer"]) {
      expect(canDeleteForeverRole(role)).toBe(false);
      expect(canDeleteForeverRole(role) && eligible.canDeleteForever).toBe(false);
    }
  });
});
