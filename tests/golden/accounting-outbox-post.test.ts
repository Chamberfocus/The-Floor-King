/**
 * Accounting outbox rows become balanced journals when posting is already on.
 * The migration must not turn posting on or mark the CRM as the official books.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/0492_accounting_outbox_posts_journals.sql",
  "utf8",
);

function body(name: string): string {
  const marker = `create or replace function public.${name}`;
  const start = sql.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, start + 8000);
}

describe("accounting outbox posts journals", () => {
  it("does not enable posting or official books", () => {
    expect(sql).not.toMatch(/books_of_record\s*=/);
    expect(sql).not.toContain("posting_enabled = true");
    expect(sql).not.toContain("update public.accounting_settings");
  });

  it("freezes balanced vendor-bill lines before enqueue", () => {
    const payload = body("acct_vendor_bill_posting_payload");
    expect(payload).toContain("'frozenLines', v_frozen");
    expect(payload).toContain("when 'material_purchase' then 'material_cogs'");
    expect(payload).toContain("mapping_key = 'accounts_payable'");
    const recorder = body("installer_labor_record_vendor_event");
    expect(recorder).toContain("acct_vendor_bill_posting_payload");
    expect(recorder.indexOf("acct_vendor_bill_posting_payload")).toBeLessThan(
      recorder.indexOf("enqueue_accounting_outbox_safe"),
    );
  });

  it("posts a pending outbox row in the same transaction and leaves review items queued", () => {
    const enqueue = body("enqueue_accounting_outbox_safe");
    expect(enqueue).toContain("if not found or not coalesce(v_settings.posting_enabled, false) then");
    expect(enqueue).toContain("return null;");
    const call = enqueue.indexOf("acct_post_outbox_item_safe");
    const guard = enqueue.indexOf("not coalesce(p_review_required, false)");
    expect(guard).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(guard);
    expect(enqueue).toContain("ACCOUNTING_POST_FAILED");
    const poster = body("acct_post_outbox_item_safe");
    expect(poster).toContain("post_journal_entry_safe");
    expect(poster).toContain("PAYLOAD_INVALID");
  });

  it("keeps the poster off the authenticated API", () => {
    expect(sql).toContain(
      "revoke all on function public.acct_post_outbox_item_safe(uuid) from authenticated",
    );
    expect(sql).toContain(
      "grant execute on function public.acct_post_outbox_item_safe(uuid) to service_role",
    );
    expect(sql).not.toContain(
      "grant execute on function public.acct_post_outbox_item_safe(uuid) to authenticated",
    );
  });

  it("uses the same void idempotency key as the TypeScript worker", () => {
    const keys = body("acct_outbox_idempotency_key");
    expect(keys).toContain(
      "when 'bill_payment_void' then 'bill_payment:' || (p_payload->>'sourceId') || ':void'",
    );
    expect(keys).toContain(
      "when 'vendor_bill' then 'vendor_bill:' || (p_payload->>'sourceId') || ':post'",
    );
  });
});
