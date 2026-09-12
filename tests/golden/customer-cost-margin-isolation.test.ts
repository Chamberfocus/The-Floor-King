import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CUSTOMER_HIDDEN_SNAPSHOT_LINE_KEYS,
  CUSTOMER_SAFE_SNAPSHOT_LINE_KEYS,
  portalMayMutateEstimateField,
  sanitizeApprovalPayloadForCustomer,
  type ApprovalSnapshotPayload,
} from "@/lib/estimate-approval";

const ROOT = join(import.meta.dirname, "../..");
const sql0181 = readFileSync(
  join(ROOT, "supabase/migrations/0181_customer_cost_margin_isolation.sql"),
  "utf8",
);
const portalCommercial = readFileSync(
  join(ROOT, "src/lib/data/portal-commercial.ts"),
  "utf8",
);
const portalPage = readFileSync(
  join(ROOT, "src/app/portal/estimates/[id]/page.tsx"),
  "utf8",
);
const portalHome = readFileSync(
  join(ROOT, "src/app/portal/page.tsx"),
  "utf8",
);
const portalActions = readFileSync(
  join(ROOT, "src/app/portal/actions.ts"),
  "utf8",
);
const staffEstimates = readFileSync(
  join(ROOT, "src/lib/data/estimates.ts"),
  "utf8",
);
const printDoc = readFileSync(
  join(ROOT, "src/app/(app)/estimates/[id]/estimate-print.tsx"),
  "utf8",
);
const declineFn = readFileSync(
  join(ROOT, "src/app/(app)/estimates/actions.ts"),
  "utf8",
);

const HIDDEN_LINE_COLS = [
  "material_cost",
  "labor_cost",
  "margin_pct",
  "from_stock",
];
const HIDDEN_ESTIMATE_COLS = [
  "target_margin",
  "created_by",
  "migrated",
];
const CUSTOMER_SELL_COLS = [
  "material_rate",
  "labor_rate",
  "installed_rate",
  "flat_amount",
  "quantity",
  "waste_pct",
];

describe("0181 customer cost/margin isolation (SQL)", () => {
  it("drops customer SELECT on cost-bearing base tables", () => {
    expect(sql0181).toContain(
      "drop policy if exists estimate_line_items_customer_read",
    );
    expect(sql0181).toContain("drop policy if exists estimates_customer_read");
    expect(sql0181).toContain("drop policy if exists jobs_customer_read");
    expect(sql0181).toContain(
      "drop policy if exists estimate_options_customer_read",
    );
    expect(sql0181).not.toContain("drop policy if exists estimates_customer_update");
  });

  it("customer line view omits cost/margin and keeps sell rates", () => {
    const view = sql0181.slice(
      sql0181.indexOf("create view public.estimate_line_items_customer"),
      sql0181.indexOf("comment on view public.estimate_line_items_customer"),
    );
    for (const col of HIDDEN_LINE_COLS) {
      expect(view).not.toContain(`l.${col}`);
    }
    for (const col of CUSTOMER_SELL_COLS) {
      expect(view).toContain(`l.${col}`);
    }
    expect(view).toContain("e.customer_id = public.my_customer_id()");
    expect(view).not.toContain("l.product_id");
    expect(view).not.toContain("l.measurements");
    expect(view).not.toContain("l.prep_key");
  });

  it("customer estimate view omits target_margin and internal notes", () => {
    const view = sql0181.slice(
      sql0181.indexOf("create view public.estimates_customer"),
      sql0181.indexOf("comment on view public.estimates_customer"),
    );
    for (const col of HIDDEN_ESTIMATE_COLS) {
      expect(view).not.toContain(`e.${col}`);
    }
    expect(view).not.toContain("e.notes");
    expect(view).toContain("e.tax_rate");
    expect(view).toContain("e.discount_kind");
    expect(view).toContain("e.discount_value");
    expect(view).toContain("e.job_description");
  });

  it("jobs_customer omits estimated/actual cost and assigned_to", () => {
    const view = sql0181.slice(
      sql0181.indexOf("create view public.jobs_customer"),
      sql0181.indexOf("comment on view public.jobs_customer"),
    );
    expect(view).not.toContain("estimated_material_cost");
    expect(view).not.toContain("actual_material_cost");
    expect(view).not.toContain("closeout_notes");
    expect(view).not.toContain("j.assigned_to");
    expect(view).toContain("j.scheduled_date");
  });

  it("does not grant customer views to anon", () => {
    expect(sql0181).toContain(
      "revoke all on public.estimate_line_items_customer from anon, public",
    );
  });

  it("job_costing excludes customer role", () => {
    expect(sql0181).toContain("create or replace view public.job_costing");
    expect(sql0181).toContain(
      "coalesce(public.user_role(auth.uid())::text, '') is distinct from 'customer'",
    );
  });

  it("products_inventory_ops excludes customer JWT", () => {
    const view = sql0181.slice(
      sql0181.indexOf("create or replace view public.products_inventory_ops"),
      sql0181.indexOf("comment on view public.products_inventory_ops"),
    );
    expect(view).not.toContain("material_rate");
    expect(view).not.toContain("labor_rate");
    expect(view).not.toContain("avg_unit_cost");
    expect(view).toContain("is distinct from 'customer'");
  });

  it("org_settings customer view omits freight markup", () => {
    const view = sql0181.slice(
      sql0181.indexOf("create view public.org_settings_customer"),
      sql0181.indexOf("comment on view public.org_settings_customer"),
    );
    expect(view).not.toContain("freight_markup_pct");
    expect(view).not.toContain("fuel_surcharge_pct");
    expect(view).toContain("o.company_name");
    expect(sql0181).toContain("org_settings_internal_read");
  });

  it("does not mutate stored approval snapshots", () => {
    expect(sql0181).toContain("customer_safe_approval_payload");
    expect(sql0181).not.toContain("update public.estimate_approval_snapshots");
  });

  it("does not enable accounting", () => {
    expect(sql0181).toContain("Do NOT set posting_enabled");
    expect(sql0181).toContain("P0_0181_PRECHECK");
    expect(sql0181).not.toMatch(/set posting_enabled\s*=\s*true/i);
  });

  it("uses an allowlist sanitizer, not a denylist copy", () => {
    expect(sql0181).toContain("customer_safe_line_json");
    expect(sql0181).toContain("jsonb_build_object");
    expect(sql0181).not.toContain("p - 'notes'");
    expect(sql0181).not.toContain("- 'material_cost'");
    expect(sql0181).not.toMatch(/drop view if exists[\s\S]* cascade/i);
  });

  it("creates estimate_options_customer without option notes", () => {
    const view = sql0181.slice(
      sql0181.indexOf("create view public.estimate_options_customer"),
      sql0181.indexOf("comment on view public.estimate_options_customer"),
    );
    expect(view).toContain("o.name");
    expect(view).not.toContain("o.notes");
    expect(view).toContain("e.customer_id = public.my_customer_id()");
  });
});

describe("0181 portal data contract", () => {
  it("portal estimate page uses customer-safe loaders", () => {
    expect(portalPage).toContain("getPortalEstimate");
    expect(portalPage).toContain("getPortalOrgSettings");
    expect(portalPage).not.toContain('from "@/lib/data/estimates"');
    expect(portalPage).not.toContain("getOrgSettings");
  });

  it("portal home uses customer-safe estimate/job lists", () => {
    expect(portalHome).toContain("listPortalEstimates");
    expect(portalHome).toContain("listPortalJobs");
    expect(portalHome).not.toContain("listEstimatesForCustomer");
    expect(portalHome).not.toContain("listJobsForCustomer");
    expect(portalHome).toContain("listPortalInstallerNames");
    expect(portalHome).not.toContain("j.assigned_to");
  });

  it("portal commercial module never queries cost-bearing base tables as the customer", () => {
    expect(portalCommercial).toContain("estimate_line_items_customer");
    expect(portalCommercial).toContain("estimates_customer");
    expect(portalCommercial).toContain("jobs_customer");
    expect(portalCommercial).toContain("estimate_options_customer");
    expect(portalCommercial).not.toMatch(
      /\.from\("estimate_line_items"\)/,
    );
    expect(portalCommercial).not.toMatch(/\.from\("estimate_options"\)/);
    expect(portalCommercial).toContain("material_cost: null");
    expect(portalCommercial).toContain("target_margin: null");
    expect(portalCommercial).toContain("listPortalInstallerNames");
  });

  it("portal decline/request-changes still UPDATE the estimates base table", () => {
    expect(portalActions).toContain('.from("estimates")');
    expect(portalActions).toContain('status: "declined"');
    expect(portalActions).toContain('status: "changes_requested"');
    expect(portalMayMutateEstimateField("status")).toBe(true);
    expect(portalMayMutateEstimateField("target_margin")).toBe(false);
  });

  it("portal decline follow-through can read estimates_customer", () => {
    expect(declineFn).toContain("export async function onEstimateDeclined");
    expect(declineFn).toContain("estimates_customer");
  });

  it("staff estimate loader still reads the base table", () => {
    expect(staffEstimates).toContain('.from("estimate_line_items")');
    expect(staffEstimates).toContain('.select("*")');
  });

  it("customer print copy uses job_description, not internal notes", () => {
    expect(printDoc).toContain("estimate.job_description");
    expect(printDoc).not.toContain("estimate.notes ??");
    expect(portalPage).toContain("currentSnap.payload.job_description");
    expect(portalPage).not.toContain("currentSnap.payload.notes");
  });
});

describe("customer-safe approval payload", () => {
  const payload: ApprovalSnapshotPayload = {
    schema_version: 1,
    estimate_id: "est-1",
    customer_id: "cust-1",
    title: "Kitchen",
    presentation: "detailed",
    show_project_details: true,
    job_description: "Install LVP",
    notes: "internal: 32% margin",
    accepted_option_id: "opt-1",
    option: {
      id: "opt-1",
      name: "Good",
      notes: "internal option note",
      lines: [
        {
          id: "line-1",
          position: 0,
          room: "Kitchen",
          description: "LVP",
          note: null,
          line_type: "mat_labor",
          category: "lvp",
          sqft: 100,
          length_in: null,
          width_in: null,
          measure_unit: "sqft",
          material_rate: 5,
          labor_rate: 2,
          installed_rate: null,
          flat_amount: null,
          waste_pct: 10,
          product_id: null,
          manufacturer: null,
          style: null,
          color: null,
          item_no: null,
          quantity: 100,
          unit: "sq ft",
          measurements: null,
          line_total: 770,
          material_cost: 2.1,
          labor_cost: 0.5,
          margin_pct: 40,
        } as ApprovalSnapshotPayload["option"]["lines"][0] & {
          material_cost: number;
          labor_cost: number;
          margin_pct: number;
        },
      ],
    },
    tax_rate: 8,
    discount_kind: "amount",
    discount_value: 0,
    discount_amount: 0,
    subtotal: 770,
    tax_amount: 61.6,
    total: 831.6,
  };

  it("strips internal notes and cost/margin keys, keeps sell totals", () => {
    const safe = sanitizeApprovalPayloadForCustomer(payload);
    expect(safe.notes).toBeNull();
    expect(safe.option.notes).toBeNull();
    expect(safe.total).toBe(831.6);
    expect(safe.option.lines[0].material_rate).toBe(5);
    expect(safe.option.lines[0].line_total).toBe(770);
    const line = safe.option.lines[0] as unknown as Record<string, unknown>;
    for (const k of CUSTOMER_HIDDEN_SNAPSHOT_LINE_KEYS) {
      expect(line[k], k).toBeUndefined();
    }
    const lineKeys = Object.keys(line);
    for (const k of lineKeys) {
      expect(CUSTOMER_SAFE_SNAPSHOT_LINE_KEYS as readonly string[]).toContain(k);
    }
  });

  it("drops unknown future internal fields instead of passing them through", () => {
    const dirty = {
      ...payload,
      internal_new_cost_metric: 12.5,
      vendor_rebate: 40,
      commission_basis: 0.08,
      option: {
        ...payload.option,
        lines: [
          {
            ...payload.option.lines[0],
            internal_new_cost_metric: 99,
            vendor_rebate: 1,
            commission_basis: 0.2,
          },
        ],
      },
    } as unknown as ApprovalSnapshotPayload;
    const safe = sanitizeApprovalPayloadForCustomer(dirty);
    const top = safe as unknown as Record<string, unknown>;
    expect(top.internal_new_cost_metric).toBeUndefined();
    expect(top.vendor_rebate).toBeUndefined();
    expect(top.commission_basis).toBeUndefined();
    const line = safe.option.lines[0] as unknown as Record<string, unknown>;
    expect(line.internal_new_cost_metric).toBeUndefined();
    expect(line.vendor_rebate).toBeUndefined();
    expect(line.commission_basis).toBeUndefined();
    expect(safe.total).toBe(831.6);
  });
});
