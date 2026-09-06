/**
 * F6-P5 — Financial reporting + accounting control center (0177).
 * Unapplied until owner review. Pure formulas + migration markers.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  ACCT_COA_RPCS,
  ACCT_CONTROL_IDEMPOTENCY_TABLE,
  ACCT_FINANCE_GATE,
  ACCT_INTERNAL_HELPERS,
  ACCT_PERIOD_LOCK_PROTOCOL,
  ACCT_PERIOD_RPCS,
  ACCT_REPORT_RPCS,
  accountingPeriodDatesValid,
  accountingPeriodsOverlap,
  agingBucketForDays,
  assessControlIdempotency,
  assessP5CutoverVerdict,
  assessPeriodCloseOutboxReadiness,
  balanceSheetEquityReported,
  balanceSheetEquationHolds,
  balanceSheetFromNaturalBalances,
  booksOfRecordNotEnabledInP5,
  classifyHistoricalArInvoice,
  controlContextHashPayload,
  currentYearNetIncomeWindow,
  financeReportRoles,
  HISTORICAL_COMMERCIAL_UNSUPPORTED,
  historicalApRemainingAsOf,
  historicalArCommercialSupported,
  historicalOpenArAsOf,
  OUTBOX_EVENT_DATE_UNRESOLVED,
  outboxRowCloseReadinessImpact,
  parseOutboxEconomicEventDate,
  periodCloseContextPayload,
  periodReopenContextPayload,
  postingRemainsOffInP5,
  trialBalanceEndingFromPeriod,
  trialBalanceEquationHolds,
  unclosedEarningsFromNaturalBalances,
  warehouseMayAccessFinancialReports,
} from "@/lib/accounting/control-center";
import {
  accountNaturalBalance,
  buildAccountingPnL,
  buildApAging,
  buildArAging,
  buildBalanceSheet,
  buildGeneralLedger,
  buildTrialBalance,
  isDebitNormal,
  type PostedLineForReport,
} from "@/lib/accounting/reports";
import {
  assessJournalBalance,
  assessPeriodPosting,
  sumCredits,
  sumDebits,
} from "@/lib/accounting/journal";
import { ledgerAccountBalance, toPostedLines } from "@/lib/accounting/integrity";
import type { GlAccountLike } from "@/lib/accounting/types";

const ROOT = join(process.cwd());
const MIG_DIR = join(ROOT, "supabase/migrations");
const MIG_NAME = "0177_f6_p5_financial_reporting_control_center.sql";
const MIG_PATH = join(MIG_DIR, MIG_NAME);
const sql177 = readFileSync(MIG_PATH, "utf8");
const archDoc = join(ROOT, "FLOOR_KING_F6_P5_ACCOUNTING_ARCHITECTURE.md");

const cash: GlAccountLike = {
  id: "cash",
  code: "1000",
  name: "Cash",
  account_type: "asset",
};
const ar: GlAccountLike = {
  id: "ar",
  code: "1100",
  name: "AR",
  account_type: "asset",
};
const ap: GlAccountLike = {
  id: "ap",
  code: "2000",
  name: "AP",
  account_type: "liability",
};
const equity: GlAccountLike = {
  id: "eq",
  code: "3000",
  name: "Equity",
  account_type: "equity",
};
const revenue: GlAccountLike = {
  id: "rev",
  code: "4000",
  name: "Sales",
  account_type: "revenue",
};
const cogs: GlAccountLike = {
  id: "cogs",
  code: "5000",
  name: "COGS",
  account_type: "expense",
  subtype: "cogs",
};
const opex: GlAccountLike = {
  id: "opex",
  code: "6000",
  name: "OpEx",
  account_type: "expense",
};
const accounts = [cash, ar, ap, equity, revenue, cogs, opex];

function line(
  accountId: string,
  debit: number,
  credit: number,
  entryDate: string,
  extra?: Partial<PostedLineForReport> & {
    journalEntryId?: string;
    memo?: string | null;
  },
): PostedLineForReport & {
  journalEntryId: string;
  memo?: string | null;
} {
  return {
    accountId,
    debit,
    credit,
    entryDate,
    entryStatus: "posted",
    journalEntryId: extra?.journalEntryId ?? `je-${entryDate}-${accountId}`,
    memo: extra?.memo ?? null,
    ...extra,
  };
}

describe("F6-P5 migration file + markers", () => {
  it("1. 0177 migration file exists", () => {
    expect(existsSync(MIG_PATH)).toBe(true);
  });

  it("2. accounting_control_idempotency table", () => {
    expect(sql177).toContain(ACCT_CONTROL_IDEMPOTENCY_TABLE);
    expect(sql177).toContain(
      "create table if not exists public.accounting_control_idempotency",
    );
  });

  it("3. finance gate acct_report_require_finance", () => {
    expect(sql177).toContain(ACCT_FINANCE_GATE);
    expect(sql177).toContain("array['admin', 'office']");
  });

  for (const rpc of ACCT_REPORT_RPCS) {
    it(`4. report/control RPC present: ${rpc}`, () => {
      expect(sql177).toContain(`create or replace function public.${rpc}`);
    });
  }

  for (const rpc of ACCT_PERIOD_RPCS) {
    it(`5. period RPC present: ${rpc}`, () => {
      expect(sql177).toContain(`create or replace function public.${rpc}`);
    });
  }

  for (const rpc of ACCT_COA_RPCS) {
    it(`6. CoA RPC present: ${rpc}`, () => {
      expect(sql177).toContain(`create or replace function public.${rpc}`);
    });
  }

  for (const h of ACCT_INTERNAL_HELPERS) {
    it(`7. internal helper present: ${h}`, () => {
      expect(sql177).toContain(h);
    });
  }

  it("8. warehouse blocked via acct_report_require_finance", () => {
    expect(sql177).toContain("Warehouse and crew fail role check");
    expect(sql177).toMatch(/acct_report_require_finance/);
    expect(sql177).toContain("admin', 'office'");
    expect(warehouseMayAccessFinancialReports()).toBe(false);
  });

  it("9. no posting_enabled=true assignment", () => {
    expect(sql177).not.toMatch(/posting_enabled\s*=\s*true/i);
    expect(sql177).not.toMatch(/inventory_posting_enabled\s*=\s*true/i);
    expect(sql177).not.toMatch(/installer_posting_enabled\s*=\s*true/i);
    expect(postingRemainsOffInP5()).toBe(true);
  });

  it("10. books_of_record not set true", () => {
    expect(sql177).not.toMatch(/books_of_record\s*=\s*true/i);
    expect(booksOfRecordNotEnabledInP5()).toBe(true);
  });

  it("11. posting stays OFF comments", () => {
    expect(sql177).toContain("Posting stays OFF");
    expect(sql177).toContain("Do NOT set posting_enabled");
    expect(sql177).toContain("External books remain official");
  });

  it("12. SECURITY DEFINER functions set search_path = public", () => {
    const definerBlocks = sql177.split(/security definer/i);
    // First split piece is preamble; every subsequent block should soon set search_path
    expect(definerBlocks.length).toBeGreaterThan(10);
    for (let i = 1; i < definerBlocks.length; i++) {
      const head = definerBlocks[i].slice(0, 220);
      expect(head).toMatch(/set\s+search_path\s*=\s*public/i);
    }
  });

  it("13. revoke authenticated from internal helpers", () => {
    expect(sql177).toContain("v_internal text[]");
    expect(sql177).toContain(
      "revoke all on function %s from authenticated",
    );
    expect(sql177).toContain("acct_control_begin_action");
    expect(sql177).toContain("acct_period_close_readiness");
  });

  it("14. actor trust uses accounting_actor_id", () => {
    expect(sql177).toContain("accounting_actor_id(p_created_by)");
    const actorCount = (sql177.match(/accounting_actor_id\(/g) ?? []).length;
    expect(actorCount).toBeGreaterThanOrEqual(3);
  });

  it("15. 0178 F7 hardening migration exists (after F6-P5)", () => {
    const files = readdirSync(MIG_DIR).filter((f) => /^0178_/.test(f));
    expect(files).toEqual(["0178_f7_launch_integrity_hardening.sql"]);
    expect(existsSync(join(MIG_DIR, "0178_f6_p6.sql"))).toBe(false);
  });

  it("16. architecture doc exists", () => {
    expect(existsSync(archDoc)).toBe(true);
    const body = readFileSync(archDoc, "utf8");
    expect(body).toContain("F6-P5");
    expect(body).toContain("0177");
    expect(body).toContain("verify-f6-p5-production.mjs");
  });

  it("17. period close/reopen reason columns", () => {
    expect(sql177).toContain("close_reason");
    expect(sql177).toContain("reopen_reason");
    expect(sql177).toContain("reopened_at");
    expect(sql177).toContain("reopened_by");
  });

  it("18. IDEMPOTENCY_CONFLICT on control context mismatch", () => {
    expect(sql177).toContain(
      "IDEMPOTENCY_CONFLICT: key reused with different control context.",
    );
  });

  it("19. advisory lock namespace 179 for control idempotency", () => {
    expect(sql177).toContain("pg_advisory_xact_lock(\n    179,");
  });

  it("20. financeReportRoles are admin/office only", () => {
    expect(financeReportRoles()).toEqual(["admin", "office"]);
    expect(financeReportRoles()).not.toContain("warehouse");
    expect(financeReportRoles()).not.toContain("crew");
  });
});

describe("F6-P5 trial balance formulas", () => {
  it("21. balanced TB: cash debit + revenue credit", () => {
    const lines = [
      line("cash", 1000, 0, "2026-06-01"),
      line("rev", 0, 1000, "2026-06-01"),
    ];
    const tb = buildTrialBalance({ accounts, lines, asOfDate: "2026-06-30" });
    expect(tb.balanced).toBe(true);
    expect(trialBalanceEquationHolds(tb.totalDebits, tb.totalCredits)).toBe(
      true,
    );
    expect(tb.criticalError).toBeNull();
  });

  it("22. unbalanced TB flagged critical", () => {
    const lines = [line("cash", 100, 0, "2026-06-01")];
    const tb = buildTrialBalance({ accounts, lines });
    expect(tb.balanced).toBe(false);
    expect(tb.criticalError).toMatch(/CRITICAL: Trial Balance out of balance/);
  });

  it("23. as-of excludes later entries", () => {
    const lines = [
      line("cash", 500, 0, "2026-05-01"),
      line("rev", 0, 500, "2026-05-01"),
      line("cash", 200, 0, "2026-07-01"),
      line("rev", 0, 200, "2026-07-01"),
    ];
    const tb = buildTrialBalance({ accounts, lines, asOfDate: "2026-06-15" });
    expect(tb.totalDebits).toBe(500);
    expect(tb.balanced).toBe(true);
  });

  it("24. draft lines ignored", () => {
    const lines = [
      line("cash", 50, 0, "2026-06-01", { entryStatus: "draft" }),
      line("rev", 0, 50, "2026-06-01", { entryStatus: "draft" }),
    ];
    const tb = buildTrialBalance({ accounts, lines });
    expect(tb.rows).toHaveLength(0);
    expect(tb.balanced).toBe(true);
  });

  it("25. isDebitNormal for asset/expense", () => {
    expect(isDebitNormal("asset")).toBe(true);
    expect(isDebitNormal("expense")).toBe(true);
    expect(isDebitNormal("liability")).toBe(false);
    expect(isDebitNormal("equity")).toBe(false);
    expect(isDebitNormal("revenue")).toBe(false);
  });

  it("26. accountNaturalBalance debit-normal", () => {
    expect(accountNaturalBalance("asset", 100, 40)).toBe(60);
    expect(accountNaturalBalance("liability", 40, 100)).toBe(60);
  });

  it("27. TB rows sorted by code", () => {
    const lines = [
      line("rev", 0, 100, "2026-06-01"),
      line("cash", 100, 0, "2026-06-01"),
    ];
    const tb = buildTrialBalance({ accounts, lines });
    expect(tb.rows.map((r) => r.code)).toEqual(["1000", "4000"]);
  });

  it("28. inactive accounts with history remain on TB", () => {
    const inactive = { ...cash, is_active: false };
    const lines = [
      line("cash", 10, 0, "2026-06-01"),
      line("rev", 0, 10, "2026-06-01"),
    ];
    const tb = buildTrialBalance({
      accounts: [inactive, revenue],
      lines,
    });
    expect(tb.rows.some((r) => r.accountId === "cash")).toBe(true);
    expect(tb.rows.find((r) => r.accountId === "cash")?.isActive).toBe(false);
    expect(tb.balanced).toBe(true);
  });
});

describe("F6-P5 P&L formulas", () => {
  it("29. P&L revenue − cogs − opex", () => {
    const lines = [
      line("rev", 0, 1000, "2026-06-10"),
      line("cogs", 400, 0, "2026-06-10"),
      line("opex", 150, 0, "2026-06-10"),
      line("cash", 450, 0, "2026-06-10"),
    ];
    const pnl = buildAccountingPnL({
      accounts,
      lines,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });
    expect(pnl.revenue).toBe(1000);
    expect(pnl.cogs).toBe(400);
    expect(pnl.grossProfit).toBe(600);
    expect(pnl.operatingExpenses).toBe(150);
    expect(pnl.netIncome).toBe(450);
    expect(pnl.label).toBe("ACCOUNTING_PNL");
  });

  it("30. P&L date window excludes outside period", () => {
    const lines = [
      line("rev", 0, 200, "2026-05-31"),
      line("rev", 0, 300, "2026-06-15"),
      line("rev", 0, 400, "2026-07-01"),
    ];
    const pnl = buildAccountingPnL({
      accounts,
      lines,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });
    expect(pnl.revenue).toBe(300);
  });

  it("31. contra-revenue debit reduces revenue", () => {
    const disc: GlAccountLike = {
      id: "disc",
      code: "4100",
      name: "Discounts",
      account_type: "revenue",
    };
    const lines = [
      line("rev", 0, 500, "2026-06-01"),
      line("disc", 50, 0, "2026-06-01"),
    ];
    const pnl = buildAccountingPnL({
      accounts: [...accounts, disc],
      lines,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });
    expect(pnl.revenue).toBe(450);
  });
});

describe("F6-P5 balance sheet equation", () => {
  it("32. Assets = L + E + NI", () => {
    const lines = [
      line("cash", 1000, 0, "2026-06-01"),
      line("ap", 0, 200, "2026-06-01"),
      line("eq", 0, 300, "2026-06-01"),
      line("rev", 0, 500, "2026-06-01"),
    ];
    const bs = buildBalanceSheet({
      accounts,
      lines,
      asOfDate: "2026-06-30",
      netIncomeToDate: 500,
    });
    expect(bs.assets).toBe(1000);
    expect(bs.liabilities).toBe(200);
    expect(bs.equity).toBe(300);
    expect(bs.equityWithIncome).toBe(800);
    expect(bs.balanced).toBe(true);
    expect(
      balanceSheetEquationHolds({
        assets: bs.assets,
        liabilities: bs.liabilities,
        equityWithIncome: bs.equityWithIncome,
      }),
    ).toBe(true);
  });

  it("33. unbalanced BS when NI omitted", () => {
    const lines = [
      line("cash", 1000, 0, "2026-06-01"),
      line("ap", 0, 200, "2026-06-01"),
      line("eq", 0, 300, "2026-06-01"),
      line("rev", 0, 500, "2026-06-01"),
    ];
    const bs = buildBalanceSheet({
      accounts,
      lines,
      asOfDate: "2026-06-30",
      netIncomeToDate: 0,
    });
    expect(bs.balanced).toBe(false);
    expect(bs.criticalError).toMatch(/CRITICAL: Balance Sheet out of balance/);
  });

  it("34. BS label", () => {
    const bs = buildBalanceSheet({
      accounts,
      lines: [],
      asOfDate: "2026-06-30",
      netIncomeToDate: 0,
    });
    expect(bs.label).toBe("ACCOUNTING_BALANCE_SHEET");
    expect(bs.balanced).toBe(true);
  });
});

describe("F6-P5 general ledger ordering", () => {
  it("35. GL sorted by date then account code", () => {
    const lines = [
      line("rev", 0, 10, "2026-06-02", { journalEntryId: "b" }),
      line("cash", 10, 0, "2026-06-01", { journalEntryId: "a" }),
      line("ar", 5, 0, "2026-06-01", { journalEntryId: "c" }),
    ];
    const gl = buildGeneralLedger({ accounts, lines });
    expect(gl.map((r) => `${r.entryDate}:${r.accountCode}`)).toEqual([
      "2026-06-01:1000",
      "2026-06-01:1100",
      "2026-06-02:4000",
    ]);
  });

  it("36. GL date filter", () => {
    const lines = [
      line("cash", 1, 0, "2026-05-01"),
      line("cash", 2, 0, "2026-06-15"),
      line("cash", 3, 0, "2026-07-01"),
    ];
    const gl = buildGeneralLedger({
      accounts,
      lines,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });
    expect(gl).toHaveLength(1);
    expect(gl[0].debit).toBe(2);
  });

  it("37. GL account filter", () => {
    const lines = [
      line("cash", 1, 0, "2026-06-01"),
      line("ar", 2, 0, "2026-06-01"),
    ];
    const gl = buildGeneralLedger({
      accounts,
      lines,
      accountId: "ar",
    });
    expect(gl).toHaveLength(1);
    expect(gl[0].accountId).toBe("ar");
  });

  it("38. GL ignores non-posted", () => {
    const lines = [
      line("cash", 9, 0, "2026-06-01", { entryStatus: "void" }),
    ];
    expect(buildGeneralLedger({ accounts, lines })).toHaveLength(0);
  });
});

describe("F6-P5 AR/AP aging buckets", () => {
  it("39. AR aging current bucket", () => {
    const aging = buildArAging({
      asOfDate: "2026-06-30",
      invoices: [
        {
          id: "i1",
          number: "INV-1",
          due_date: "2026-07-15",
          issue_date: "2026-06-01",
          status: "sent",
          balance: 100,
        },
      ],
    });
    expect(aging.rows[0].bucket).toBe("current");
    expect(aging.totals.current).toBe(100);
    expect(aging.label).toBe("AR_AGING");
  });

  it("40. AR aging 1-30", () => {
    expect(agingBucketForDays(15)).toBe("1-30");
    const aging = buildArAging({
      asOfDate: "2026-06-30",
      invoices: [
        {
          id: "i2",
          number: "INV-2",
          due_date: "2026-06-15",
          issue_date: "2026-06-01",
          status: "sent",
          balance: 50,
        },
      ],
    });
    expect(aging.rows[0].bucket).toBe("1-30");
  });

  it("41. AR aging 31-60 / 61-90 / 90+", () => {
    expect(agingBucketForDays(45)).toBe("31-60");
    expect(agingBucketForDays(75)).toBe("61-90");
    expect(agingBucketForDays(120)).toBe("90+");
    const aging = buildArAging({
      asOfDate: "2026-09-30",
      invoices: [
        {
          id: "a",
          due_date: "2026-08-15",
          issue_date: "2026-07-01",
          status: "sent",
          balance: 10,
        },
        {
          id: "b",
          due_date: "2026-07-15",
          issue_date: "2026-06-01",
          status: "sent",
          balance: 20,
        },
        {
          id: "c",
          due_date: "2026-05-01",
          issue_date: "2026-04-01",
          status: "sent",
          balance: 30,
        },
      ],
    });
    expect(aging.totals["31-60"]).toBe(10);
    expect(aging.totals["61-90"]).toBe(20);
    expect(aging.totals["90+"]).toBe(30);
  });

  it("42. void invoices excluded from AR aging", () => {
    const aging = buildArAging({
      asOfDate: "2026-06-30",
      invoices: [
        {
          id: "v",
          due_date: "2026-01-01",
          issue_date: "2026-01-01",
          status: "void",
          balance: 999,
        },
      ],
    });
    expect(aging.total).toBe(0);
  });

  it("43. zero balance skipped", () => {
    const aging = buildArAging({
      asOfDate: "2026-06-30",
      invoices: [
        {
          id: "z",
          due_date: "2026-01-01",
          issue_date: "2026-01-01",
          status: "sent",
          balance: 0,
        },
      ],
    });
    expect(aging.rows).toHaveLength(0);
  });

  it("44. AP aging buckets", () => {
    const aging = buildApAging({
      asOfDate: "2026-06-30",
      bills: [
        {
          id: "b1",
          bill_number: "B-1",
          due_date: "2026-06-01",
          bill_date: "2026-05-01",
          status: "open",
          balance: 75,
        },
      ],
    });
    expect(aging.rows[0].bucket).toBe("1-30");
    expect(aging.total).toBe(75);
    expect(aging.label).toBe("AP_AGING");
  });

  it("45. AP void excluded", () => {
    const aging = buildApAging({
      asOfDate: "2026-06-30",
      bills: [
        {
          id: "bv",
          bill_number: null,
          due_date: null,
          bill_date: "2026-01-01",
          status: "void",
          balance: 40,
        },
      ],
    });
    expect(aging.total).toBe(0);
  });
});

describe("F6-P5 historical as-of AR/AP reductions", () => {
  it("46. payment after as-of ignored", () => {
    const bal = historicalOpenArAsOf({
      commercialTotal: 1000,
      asOfDate: "2026-06-30",
      payments: [
        { amount: 200, date: "2026-06-15" },
        { amount: 300, date: "2026-07-05" },
      ],
    });
    expect(bal).toBe(800);
  });

  it("47. credit after as-of ignored", () => {
    expect(
      historicalOpenArAsOf({
        commercialTotal: 500,
        asOfDate: "2026-06-30",
        credits: [
          { amount: 50, date: "2026-06-01" },
          { amount: 100, date: "2026-08-01" },
        ],
      }),
    ).toBe(450);
  });

  it("48. deposit and write-off as-of filters", () => {
    expect(
      historicalOpenArAsOf({
        commercialTotal: 1000,
        asOfDate: "2026-06-30",
        deposits: [{ amount: 100, date: "2026-06-20" }],
        writeOffs: [
          { amount: 50, date: "2026-06-25" },
          { amount: 25, date: "2026-07-01" },
        ],
      }),
    ).toBe(850);
  });

  it("49. voided payment ignored even if dated before as-of", () => {
    expect(
      historicalOpenArAsOf({
        commercialTotal: 400,
        asOfDate: "2026-06-30",
        payments: [{ amount: 100, date: "2026-06-01", voided: true }],
      }),
    ).toBe(400);
  });

  it("50. payment on as-of date counts", () => {
    expect(
      historicalOpenArAsOf({
        commercialTotal: 200,
        asOfDate: "2026-06-30",
        payments: [{ amount: 25, date: "2026-06-30" }],
      }),
    ).toBe(175);
  });

  it("51. historical AP ignores payment after as-of", () => {
    expect(
      historicalApRemainingAsOf({
        billTotal: 800,
        billDate: "2026-05-01",
        asOfDate: "2026-06-30",
        payments: [
          { amount: 100, date: "2026-06-10" },
          { amount: 200, date: "2026-07-01" },
        ],
      }),
    ).toBe(700);
  });

  it("52. bill dated after as-of is zero", () => {
    expect(
      historicalApRemainingAsOf({
        billTotal: 500,
        billDate: "2026-07-01",
        asOfDate: "2026-06-30",
      }),
    ).toBe(0);
  });

  it("53. bill voided on/before as-of is zero", () => {
    expect(
      historicalApRemainingAsOf({
        billTotal: 500,
        billDate: "2026-05-01",
        asOfDate: "2026-06-30",
        voidedAt: "2026-06-15",
      }),
    ).toBe(0);
  });

  it("54. bill voided after as-of still included historically", () => {
    expect(
      historicalApRemainingAsOf({
        billTotal: 500,
        billDate: "2026-05-01",
        asOfDate: "2026-06-30",
        voidedAt: "2026-07-10",
        payments: [{ amount: 50, date: "2026-06-01" }],
      }),
    ).toBe(450);
  });
});

describe("F6-P5 period close/reopen context hash + idempotency", () => {
  it("55. close context payload shape", () => {
    expect(
      periodCloseContextPayload({
        periodId: "p1",
        reason: "Month end",
      }),
    ).toEqual({ period_id: "p1", reason: "Month end" });
  });

  it("56. reopen context payload shape", () => {
    expect(
      periodReopenContextPayload({
        periodId: "p1",
        reason: "Correction",
      }),
    ).toEqual({ period_id: "p1", reason: "Correction" });
  });

  it("57. context hash stable for same payload", () => {
    const a = controlContextHashPayload("period_close", {
      period_id: "p1",
      reason: "done",
    });
    const b = controlContextHashPayload("period_close", {
      period_id: "p1",
      reason: "done",
    });
    expect(a).toBe(b);
    expect(a).toContain("period_close");
    expect(a).toContain("\u001f");
  });

  it("58. different reason → different hash", () => {
    const a = controlContextHashPayload(
      "period_close",
      periodCloseContextPayload({ periodId: "p1", reason: "A" }),
    );
    const b = controlContextHashPayload(
      "period_close",
      periodCloseContextPayload({ periodId: "p1", reason: "B" }),
    );
    expect(a).not.toBe(b);
  });

  it("59. idempotency miss on first use", () => {
    expect(
      assessControlIdempotency({
        existing: null,
        action: "period_close",
        contextHash: "h1",
      }),
    ).toBe("miss");
  });

  it("60. idempotency hit on exact replay", () => {
    expect(
      assessControlIdempotency({
        existing: {
          action: "period_close",
          contextHash: "h1",
          status: "completed",
        },
        action: "period_close",
        contextHash: "h1",
      }),
    ).toBe("hit");
  });

  it("61. idempotency conflict on action mismatch", () => {
    expect(
      assessControlIdempotency({
        existing: {
          action: "period_close",
          contextHash: "h1",
          status: "completed",
        },
        action: "period_reopen",
        contextHash: "h1",
      }),
    ).toBe("conflict");
  });

  it("62. idempotency conflict on hash mismatch", () => {
    expect(
      assessControlIdempotency({
        existing: {
          action: "period_close",
          contextHash: "h1",
          status: "completed",
        },
        action: "period_close",
        contextHash: "h2",
      }),
    ).toBe("conflict");
  });

  it("63. idempotency pending when status pending", () => {
    expect(
      assessControlIdempotency({
        existing: {
          action: "period_lock",
          contextHash: "h",
          status: "pending",
        },
        action: "period_lock",
        contextHash: "h",
      }),
    ).toBe("pending");
  });

  it("64. SQL close uses period_close action key", () => {
    expect(sql177).toContain("'period_close'");
    expect(sql177).toContain("'period_reopen'");
    expect(sql177).toContain("'period_lock'");
  });

  it("65. SQL close preserves reopen history fields on close", () => {
    expect(sql177).toContain("reopen_reason = null");
    expect(sql177).toContain("reopened_at = null");
    expect(sql177).toContain("prior_close_preserved");
  });

  it("66. closed period blocks new posts (pure)", () => {
    expect(assessPeriodPosting({ periodStatus: "closed", entryKind: "post" }).ok).toBe(
      false,
    );
    expect(assessPeriodPosting({ periodStatus: "locked", entryKind: "post" }).ok).toBe(
      false,
    );
    expect(assessPeriodPosting({ periodStatus: "open", entryKind: "post" }).ok).toBe(
      true,
    );
  });
});

describe("F6-P5 warehouse access denial", () => {
  it("67. warehouseMayAccessFinancialReports is false", () => {
    expect(warehouseMayAccessFinancialReports()).toBe(false);
  });

  it("68. SQL comments warehouse isolation", () => {
    expect(sql177).toContain("admin/office only (warehouse must fail)");
    expect(sql177).toContain("Finance gate: admin/office only");
  });

  it("69. report RPCs call require_finance", () => {
    for (const rpc of [
      "acct_report_trial_balance",
      "acct_report_pnl",
      "acct_report_balance_sheet",
      "acct_report_general_ledger",
      "acct_report_ar_aging",
      "acct_report_ap_aging",
      "acct_exceptions_scan",
      "acct_cutover_readiness_snapshot",
    ]) {
      const idx = sql177.indexOf(`create or replace function public.${rpc}`);
      expect(idx).toBeGreaterThan(-1);
      const slice = sql177.slice(idx, idx + 1200);
      expect(slice).toContain("perform public.acct_report_require_finance()");
    }
  });
});

describe("F6-P5 cutover readiness PITR", () => {
  it("70. PITR null → NOT_READY even with empty blockers", () => {
    expect(
      assessP5CutoverVerdict({
        blockers: [],
        pitrConfirmed: false,
        accountantValidated: true,
      }),
    ).toBe("NOT_READY");
  });

  it("71. blockers alone → NOT_READY", () => {
    expect(
      assessP5CutoverVerdict({
        blockers: ["Cutover date not set."],
        pitrConfirmed: true,
        accountantValidated: true,
      }),
    ).toBe("NOT_READY");
  });

  it("72. PITR confirmed + no blockers + no sign-off → READY_FOR_PILOT", () => {
    expect(
      assessP5CutoverVerdict({
        blockers: [],
        pitrConfirmed: true,
        accountantValidated: false,
      }),
    ).toBe("READY_FOR_PILOT");
  });

  it("73. full gates → READY_FOR_CUTOVER", () => {
    expect(
      assessP5CutoverVerdict({
        blockers: [],
        pitrConfirmed: true,
        accountantValidated: true,
      }),
    ).toBe("READY_FOR_CUTOVER");
  });

  it("74. SQL treats unconfirmed PITR as NOT_READY", () => {
    expect(sql177).toContain("if cardinality(v_blockers) > 0 or not v_pitr_confirmed then");
    expect(sql177).toContain("v_verdict := 'NOT_READY'");
    expect(sql177).toContain("PITR expected NOT CONFIRMED → NOT_READY");
  });

  it("75. snapshot never mutates settings", () => {
    expect(sql177).toContain("'mutated_settings', false");
    expect(sql177).toContain("Evaluates cutover readiness without mutating");
  });
});

describe("F6-P5 double-entry integrity helpers", () => {
  it("76. balanced two-line journal ok", () => {
    const gate = assessJournalBalance([
      { accountId: "cash", debit: 100 },
      { accountId: "rev", credit: 100 },
    ]);
    expect(gate.ok).toBe(true);
    if (gate.ok) {
      expect(gate.debits).toBe(100);
      expect(gate.credits).toBe(100);
    }
  });

  it("77. unbalanced journal rejected", () => {
    const gate = assessJournalBalance([
      { accountId: "cash", debit: 100 },
      { accountId: "rev", credit: 90 },
    ]);
    expect(gate.ok).toBe(false);
  });

  it("78. single-line journal rejected", () => {
    expect(
      assessJournalBalance([{ accountId: "cash", debit: 10 }]).ok,
    ).toBe(false);
  });

  it("79. sumDebits / sumCredits round", () => {
    expect(
      sumDebits([
        { accountId: "a", debit: 10.004 },
        { accountId: "b", debit: 0.004 },
      ]),
    ).toBe(10);
    expect(sumCredits([{ accountId: "c", credit: 10.01 }])).toBe(10.01);
  });

  it("80. ledgerAccountBalance as-of", () => {
    const bal = ledgerAccountBalance({
      accountId: "cash",
      accountType: "asset",
      asOfDate: "2026-06-30",
      lines: [
        line("cash", 100, 0, "2026-06-01"),
        line("cash", 50, 0, "2026-07-01"),
      ],
    });
    expect(bal).toBe(100);
  });

  it("81. toPostedLines flattens built journals", () => {
    const posted = toPostedLines([
      {
        entryDate: "2026-06-01",
        description: "t",
        sourceType: "manual",
        sourceId: "1",
        entryKind: "manual",
        idempotencyKey: "k",
        lines: [
          { accountId: "cash", debit: 5 },
          { accountId: "rev", credit: 5 },
        ],
      },
    ]);
    expect(posted).toHaveLength(2);
    expect(posted.every((l) => l.entryStatus === "posted")).toBe(true);
  });

  it("82. SQL journal integrity scan present", () => {
    expect(sql177).toContain("acct_journal_integrity_scan");
    expect(sql177).toContain("acct_exceptions_scan");
  });
});

describe("F6-P5 security ACL markers", () => {
  it("83. revoke control idempotency from authenticated", () => {
    expect(sql177).toContain(
      "revoke all on public.accounting_control_idempotency from public, anon, authenticated",
    );
  });

  it("84. ACL loop revokes anon on all P5 functions", () => {
    expect(sql177).toContain("revoke all on function %s from anon");
    expect(sql177).toContain("revoke all on function %s from public");
  });

  it("85. staff RPCs granted to authenticated", () => {
    expect(sql177).toContain("grant execute on function %s to authenticated");
    expect(sql177).toContain("v_staff text[]");
  });

  it("86. internal helpers service_role only grant", () => {
    expect(sql177).toContain("grant execute on function %s to service_role");
    expect(sql177).toContain("if r.proname = any (v_internal) then");
  });

  for (const h of [
    "acct_control_begin_action",
    "acct_control_complete_action",
    "acct_control_lock_idempotency",
    "acct_period_close_readiness",
  ] as const) {
    it(`87. internal ACL list includes ${h}`, () => {
      expect(ACCT_INTERNAL_HELPERS).toContain(h);
      expect(sql177).toContain(`'${h}'`);
    });
  }
});

describe("F6-P5 actor trust + non-goals", () => {
  it("88. period close uses accounting_actor_id", () => {
    const idx = sql177.indexOf("create or replace function public.acct_period_close_safe");
    const slice = sql177.slice(idx, idx + 6000);
    expect(slice).toContain("v_actor := public.accounting_actor_id(p_created_by)");
    expect(slice).toContain("closed_by = v_actor");
  });

  it("89. period reopen uses accounting_actor_id", () => {
    const idx = sql177.indexOf(
      "create or replace function public.acct_period_reopen_safe",
    );
    const slice = sql177.slice(idx, idx + 2500);
    expect(slice).toContain("v_actor := public.accounting_actor_id(p_created_by)");
    expect(slice).toContain("reopened_by = v_actor");
  });

  it("90. explicit non-goals documentation", () => {
    expect(sql177).toContain("Do NOT invent fake journal / aging data");
    expect(sql177).toContain("Do NOT update posting_enabled / books_of_record");
  });

  it("91. schema precedes after 0176 comment", () => {
    expect(sql177).toContain("AFTER 0176");
    expect(sql177).toContain("UNAPPLIED");
  });
});

describe("F6-P5 additional formula edge cases", () => {
  it("92. multi-account balanced TB", () => {
    const lines = [
      line("cash", 700, 0, "2026-06-01"),
      line("ar", 300, 0, "2026-06-01"),
      line("ap", 0, 400, "2026-06-01"),
      line("eq", 0, 200, "2026-06-01"),
      line("rev", 0, 400, "2026-06-01"),
    ];
    const tb = buildTrialBalance({ accounts, lines });
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebits).toBe(1000);
  });

  it("93. P&L zero when no activity", () => {
    const pnl = buildAccountingPnL({
      accounts,
      lines: [],
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
    expect(pnl.netIncome).toBe(0);
    expect(pnl.revenue).toBe(0);
  });

  it("94. BS with liability only and matching asset", () => {
    const lines = [
      line("cash", 250, 0, "2026-06-01"),
      line("ap", 0, 250, "2026-06-01"),
    ];
    const bs = buildBalanceSheet({
      accounts,
      lines,
      asOfDate: "2026-06-30",
      netIncomeToDate: 0,
    });
    expect(bs.balanced).toBe(true);
  });

  it("95. AR aging total sums buckets", () => {
    const aging = buildArAging({
      asOfDate: "2026-06-30",
      invoices: [
        {
          id: "1",
          due_date: "2026-07-01",
          issue_date: "2026-06-01",
          status: "sent",
          balance: 10,
        },
        {
          id: "2",
          due_date: "2026-06-01",
          issue_date: "2026-05-01",
          status: "sent",
          balance: 20,
        },
      ],
    });
    expect(aging.total).toBe(30);
  });

  it("96. historical AR never negative", () => {
    expect(
      historicalOpenArAsOf({
        commercialTotal: 100,
        asOfDate: "2026-06-30",
        payments: [{ amount: 150, date: "2026-06-01" }],
      }),
    ).toBe(0);
  });

  it("97. control hash distinguishes actions", () => {
    const payload = { period_id: "p", reason: "r" };
    expect(controlContextHashPayload("period_close", payload)).not.toBe(
      controlContextHashPayload("period_reopen", payload),
    );
  });

  it("98. agingBucketForDays boundaries", () => {
    expect(agingBucketForDays(0)).toBe("current");
    expect(agingBucketForDays(1)).toBe("1-30");
    expect(agingBucketForDays(30)).toBe("1-30");
    expect(agingBucketForDays(31)).toBe("31-60");
    expect(agingBucketForDays(60)).toBe("31-60");
    expect(agingBucketForDays(61)).toBe("61-90");
    expect(agingBucketForDays(90)).toBe("61-90");
    expect(agingBucketForDays(91)).toBe("90+");
  });

  it("99. trialBalanceEquationHolds tolerance", () => {
    expect(trialBalanceEquationHolds(100, 100)).toBe(true);
    expect(trialBalanceEquationHolds(100, 100.004)).toBe(true);
    expect(trialBalanceEquationHolds(100, 100.02)).toBe(false);
  });

  it("100. balanceSheetEquationHolds", () => {
    expect(
      balanceSheetEquationHolds({
        assets: 1000,
        liabilities: 400,
        equityWithIncome: 600,
      }),
    ).toBe(true);
    expect(
      balanceSheetEquationHolds({
        assets: 1000,
        liabilities: 400,
        equityWithIncome: 500,
      }),
    ).toBe(false);
  });
});

describe("F6-P5 report RPC marker matrix", () => {
  const required = [
    "acct_report_trial_balance",
    "acct_report_pnl",
    "acct_report_balance_sheet",
    "acct_report_general_ledger",
    "acct_report_ar_aging",
    "acct_report_ap_aging",
    "acct_period_close_safe",
    "acct_period_reopen_safe",
    "acct_exceptions_scan",
    "acct_cutover_readiness_snapshot",
    "accounting_control_idempotency",
  ] as const;

  for (const marker of required) {
    it(`101. required marker: ${marker}`, () => {
      expect(sql177).toContain(marker);
    });
  }
});

describe("F6-P5 historical AR mirrors invoice_open formula stack", () => {
  it("102. stacked reductions before as-of", () => {
    expect(
      historicalOpenArAsOf({
        commercialTotal: 1000,
        asOfDate: "2026-06-30",
        payments: [{ amount: 100, date: "2026-06-01" }],
        credits: [{ amount: 50, date: "2026-06-05" }],
        deposits: [{ amount: 25, date: "2026-06-10" }],
        writeOffs: [{ amount: 10, date: "2026-06-20" }],
      }),
    ).toBe(815);
  });

  it("103. all reductions after as-of leave full commercial", () => {
    expect(
      historicalOpenArAsOf({
        commercialTotal: 777,
        asOfDate: "2026-06-01",
        payments: [{ amount: 10, date: "2026-06-02" }],
        credits: [{ amount: 10, date: "2026-06-03" }],
        deposits: [{ amount: 10, date: "2026-06-04" }],
        writeOffs: [{ amount: 10, date: "2026-06-05" }],
      }),
    ).toBe(777);
  });

  it("104. SQL historical AR helper present", () => {
    expect(sql177).toContain("acct_invoice_open_ar_as_of");
    expect(sql177).toContain("Exclude if voided on/before as-of");
    expect(sql177).toContain("HISTORICAL_COMMERCIAL_UNSUPPORTED");
    expect(sql177).toContain("never use live invoice_items");
  });

  it("105. SQL historical AP helper present", () => {
    expect(sql177).toContain("acct_bill_remaining_as_of");
    expect(sql177).toContain("voided after as-of: include historically");
    expect(sql177).toContain("ap_bill_original_total");
  });
});

describe("F6-P5 control center constants", () => {
  it("106. ACCT_REPORT_RPCS length", () => {
    expect(ACCT_REPORT_RPCS.length).toBeGreaterThanOrEqual(10);
  });

  it("107. ACCT_PERIOD_RPCS are three", () => {
    expect(ACCT_PERIOD_RPCS).toEqual([
      "acct_period_close_safe",
      "acct_period_reopen_safe",
      "acct_period_lock_safe",
    ]);
  });

  it("108. ACCT_INTERNAL_HELPERS includes hash helper", () => {
    expect(ACCT_INTERNAL_HELPERS).toContain("acct_control_context_hash");
  });

  it("109. ACCT_FINANCE_GATE name", () => {
    expect(ACCT_FINANCE_GATE).toBe("acct_report_require_finance");
  });

  it("110. architecture doc names reporting contract", () => {
    const body = readFileSync(archDoc, "utf8");
    expect(body).toContain("ACCOUNTING SOURCE");
    expect(body).toContain("OPERATIONAL SOURCE");
    expect(body).toContain("Warehouse");
    expect(body).toContain("HISTORICAL AR POLICY");
    expect(body).toContain("HISTORICAL AP POLICY");
    expect(body).toContain("RETAINED EARNINGS / FY POLICY");
    expect(body).toContain("TRIAL BALANCE PERIOD CONTRACT");
  });
});

describe("F6-P5 more TB / GL / period edges", () => {
  it("111. TB penny rounding still balanced", () => {
    const lines = [
      line("cash", 33.33, 0, "2026-06-01"),
      line("cash", 33.33, 0, "2026-06-01"),
      line("cash", 33.34, 0, "2026-06-01"),
      line("rev", 0, 100, "2026-06-01"),
    ];
    expect(buildTrialBalance({ accounts, lines }).balanced).toBe(true);
  });

  it("112. GL memo preserved", () => {
    const gl = buildGeneralLedger({
      accounts,
      lines: [line("cash", 1, 0, "2026-06-01", { memo: "deposit" })],
    });
    expect(gl[0].memo).toBe("deposit");
  });

  it("113. period close readiness RPC is internal", () => {
    expect(ACCT_INTERNAL_HELPERS).toContain("acct_period_close_readiness");
    expect(ACCT_REPORT_RPCS).not.toContain("acct_period_close_readiness");
  });

  it("114. idempotency key required markers", () => {
    expect(sql177).toContain("ACCT_IDEMPOTENCY_KEY_REQUIRED");
    expect(sql177).toContain("ACCT_PERIOD_CLOSE_REASON_REQUIRED");
    expect(sql177).toContain("ACCT_PERIOD_REOPEN_REASON_REQUIRED");
  });

  it("115. locked period cannot close", () => {
    expect(sql177).toContain("ACCT_PERIOD_LOCKED: cannot close a locked period.");
  });

  it("116. already_closed / already_open short-circuit", () => {
    expect(sql177).toContain("'already_closed', true");
    expect(sql177).toContain("'already_open', true");
  });

  it("117. audit keys for period close/reopen", () => {
    expect(sql177).toContain("audit:period_close:");
    expect(sql177).toContain("audit:period_reopen:");
  });

  it("118. books status RPC present", () => {
    expect(sql177).toContain("acct_books_status");
    expect(sql177).toContain("NOT OFFICIAL BOOKS");
  });

  it("119. recon control RPCs present", () => {
    expect(sql177).toContain("acct_recon_ar_control");
    expect(sql177).toContain("acct_recon_ap_control");
    expect(sql177).toContain("acct_recon_inventory_control");
    expect(sql177).toContain("acct_recon_cash_book");
  });

  it("120. CoA upsert/deactivate safe present", () => {
    expect(sql177).toContain("gl_account_upsert_safe");
    expect(sql177).toContain("gl_account_deactivate_safe");
  });

  it("121. overlapping period guard present", () => {
    expect(sql177).toContain("acct_periods_prevent_overlap");
  });

  it("122. no parallel fake ledger tables invented", () => {
    expect(sql177).not.toMatch(/create table if not exists public\.fake_/i);
    expect(sql177).toContain("Does NOT invent fake financial data");
  });

  it("123. historical payment after as-of does not change AR aging input", () => {
    // Pure: as-of open AR for aging should use historicalOpenArAsOf, not current
    const asOfBal = historicalOpenArAsOf({
      commercialTotal: 500,
      asOfDate: "2026-06-30",
      payments: [{ amount: 500, date: "2026-07-15" }],
    });
    expect(asOfBal).toBe(500);
    const aging = buildArAging({
      asOfDate: "2026-06-30",
      invoices: [
        {
          id: "late-pay",
          due_date: "2026-06-01",
          issue_date: "2026-05-01",
          status: "sent",
          balance: asOfBal,
        },
      ],
    });
    expect(aging.total).toBe(500);
  });

  it("124. warehouse constant stays false under rename pressure", () => {
    expect(warehouseMayAccessFinancialReports()).toBe(
      financeReportRoles().includes("warehouse" as never),
    );
  });
});

describe("F6-P5 accuracy correction — adversarial historical AR/AP", () => {
  it("125. invoice created after as-of excluded", () => {
    const c = classifyHistoricalArInvoice({
      issueDate: "2026-07-01",
      asOf: "2026-06-30",
      voidedAtDate: null,
      commercialSupported: true,
    });
    expect(c.includeInAging).toBe(false);
    expect(c.limitationCode).toBe("NOT_ISSUED_YET");
  });

  it("126. invoice revised after as-of does not rewrite prior AR commercial", () => {
    // Prior as-of uses frozen commercial 1000; later revision to 1500 ignored.
    expect(
      historicalOpenArAsOf({
        commercialTotal: 1000,
        asOfDate: "2026-06-30",
        payments: [],
      }),
    ).toBe(1000);
    expect(
      historicalOpenArAsOf({
        commercialTotal: 1500,
        asOfDate: "2026-07-15",
        payments: [],
      }),
    ).toBe(1500);
  });

  it("127. invoice voided after as-of remains visible before void date", () => {
    expect(
      historicalOpenArAsOf({
        commercialTotal: 400,
        asOfDate: "2026-06-30",
        voidedOnOrBeforeAsOf: false,
      }),
    ).toBe(400);
  });

  it("128. invoice voided on/before as-of excluded", () => {
    expect(
      historicalOpenArAsOf({
        commercialTotal: 400,
        asOfDate: "2026-06-30",
        voidedOnOrBeforeAsOf: true,
      }),
    ).toBe(0);
    expect(
      classifyHistoricalArInvoice({
        issueDate: "2026-01-01",
        asOf: "2026-06-30",
        voidedAtDate: "2026-06-15",
        commercialSupported: true,
      }).limitationCode,
    ).toBe("VOIDED_AS_OF");
  });

  it("129. payment after as-of excluded from AR", () => {
    expect(
      historicalOpenArAsOf({
        commercialTotal: 500,
        asOfDate: "2026-06-30",
        payments: [{ amount: 500, date: "2026-07-01" }],
      }),
    ).toBe(500);
  });

  it("130. credit after as-of excluded from AR", () => {
    expect(
      historicalOpenArAsOf({
        commercialTotal: 500,
        asOfDate: "2026-06-30",
        credits: [{ amount: 100, date: "2026-07-01" }],
      }),
    ).toBe(500);
  });

  it("131. writeoff after as-of excluded from AR", () => {
    expect(
      historicalOpenArAsOf({
        commercialTotal: 500,
        asOfDate: "2026-06-30",
        writeOffs: [{ amount: 50, date: "2026-07-01" }],
      }),
    ).toBe(500);
  });

  it("132. deposit after as-of excluded from AR", () => {
    expect(
      historicalOpenArAsOf({
        commercialTotal: 500,
        asOfDate: "2026-06-30",
        deposits: [{ amount: 75, date: "2026-07-01" }],
      }),
    ).toBe(500);
  });

  it("133. legacy invoice without provenance fails closed", () => {
    expect(
      historicalArCommercialSupported({
        hasPostedInvoiceJournalFreeze: false,
        hasOutboxInvoiceIssueFreeze: false,
        hasApprovalSnapshotTotal: false,
        hasFrozenTotalColumn: false,
      }),
    ).toBe(false);
    expect(
      classifyHistoricalArInvoice({
        issueDate: "2025-01-01",
        asOf: "2026-06-30",
        voidedAtDate: null,
        commercialSupported: false,
      }).limitationCode,
    ).toBe(HISTORICAL_COMMERCIAL_UNSUPPORTED);
  });

  it("134. SQL AR uses outbox + approval snapshot + fail closed", () => {
    expect(sql177).toContain("accounting_posting_outbox_invoice_issue");
    expect(sql177).toContain("approval_snapshot_payload_total");
    expect(sql177).toContain("never use live invoice_items");
    expect(sql177).toContain("performance', 'set_based'");
  });

  it("135. bill corrected tomorrow does not change prior AP remaining", () => {
    expect(
      historicalApRemainingAsOf({
        billTotal: 800,
        asOfDate: "2026-06-30",
        billDate: "2026-05-01",
        payments: [{ amount: 100, date: "2026-06-01" }],
      }),
    ).toBe(700);
    // Later correction of bill total is a different as-of commercial input
    expect(
      historicalApRemainingAsOf({
        billTotal: 900,
        asOfDate: "2026-07-31",
        billDate: "2026-05-01",
        payments: [{ amount: 100, date: "2026-06-01" }],
      }),
    ).toBe(800);
  });

  it("136. AP payment after as-of excluded; void after as-of still included", () => {
    expect(
      historicalApRemainingAsOf({
        billTotal: 300,
        asOfDate: "2026-06-30",
        billDate: "2026-05-01",
        payments: [{ amount: 300, date: "2026-07-01" }],
      }),
    ).toBe(300);
    expect(
      historicalApRemainingAsOf({
        billTotal: 300,
        asOfDate: "2026-06-30",
        billDate: "2026-05-01",
        voidedAt: "2026-07-15",
      }),
    ).toBe(300);
  });

  it("137. AP voided on/before as-of excluded", () => {
    expect(
      historicalApRemainingAsOf({
        billTotal: 300,
        asOfDate: "2026-06-30",
        billDate: "2026-05-01",
        voidedAt: "2026-06-15",
      }),
    ).toBe(0);
  });

  it("138. SQL AP fail-closed for non-open/void lifecycle", () => {
    expect(sql177).toContain("HISTORICAL_AP_UNSUPPORTED");
    expect(sql177).toContain("Only open/void have immutable bill_items");
    expect(sql177).toContain("'ledger', 'bills'");
  });
});

describe("F6-P5 accuracy correction — TB / P&L / BS / ACL / errors", () => {
  it("139. TB period beginning + period movement = ending (asset)", () => {
    expect(
      trialBalanceEndingFromPeriod({
        accountType: "asset",
        beginning: 1000,
        periodDebits: 200,
        periodCredits: 50,
      }),
    ).toBe(1150);
  });

  it("140. TB period beginning + period movement = ending (liability)", () => {
    expect(
      trialBalanceEndingFromPeriod({
        accountType: "liability",
        beginning: 500,
        periodDebits: 100,
        periodCredits: 250,
      }),
    ).toBe(650);
  });

  it("141. TB zero movement preserves beginning", () => {
    expect(
      trialBalanceEndingFromPeriod({
        accountType: "equity",
        beginning: 222.22,
        periodDebits: 0,
        periodCredits: 0,
      }),
    ).toBe(222.22);
  });

  it("142. SQL TB returns beginning_balance / period_debits / period_credits", () => {
    expect(sql177).toContain("beginning_balance");
    expect(sql177).toContain("period_debits");
    expect(sql177).toContain("period_credits");
    expect(sql177).toContain("total_period_debits");
    expect(sql177).toContain("ACCT_REPORT_TB_IDENTITY_BROKEN");
  });

  it("143. P&L classifies other income / other expense / operating income", () => {
    expect(sql177).toContain("'other_income'");
    expect(sql177).toContain("'other_expense'");
    expect(sql177).toContain("operating_income");
    expect(sql177).toContain("account_rows");
  });

  it("144. BS uses unclosed_earnings not lifetime income; sign = rev − exp", () => {
    expect(sql177).toContain("unclosed_earnings");
    expect(sql177).toMatch(/never add lifetime income on top of equity blindly/i);
    expect(sql177).toContain("SUM(revenue natural balances) - SUM(expense natural balances)");
    expect(sql177).toContain("v_rev_nat");
    expect(sql177).toContain("v_exp_nat");
    expect(sql177).not.toMatch(/BS equation plug/i);
    expect(
      balanceSheetEquityReported({ equityAccounts: 1000, unclosedEarnings: 250 }),
    ).toBe(1250);
    expect(
      balanceSheetEquationHolds({
        assets: 2000,
        liabilities: 750,
        equityWithIncome: 1250,
      }),
    ).toBe(true);
  });

  it("145. FY window is calendar year start through as-of", () => {
    expect(currentYearNetIncomeWindow("2026-09-04")).toEqual({
      fyStart: "2026-01-01",
      fyEnd: "2026-09-04",
    });
  });

  it("146. open_ar / bill_remaining are internal helpers not staff RPCs", () => {
    expect(ACCT_INTERNAL_HELPERS).toContain("acct_invoice_open_ar_as_of");
    expect(ACCT_INTERNAL_HELPERS).toContain("acct_bill_remaining_as_of");
    expect(ACCT_REPORT_RPCS).not.toContain("acct_invoice_open_ar_as_of");
    expect(ACCT_REPORT_RPCS).not.toContain("acct_bill_remaining_as_of");
    expect(sql177).toContain("'acct_invoice_open_ar_as_of'");
    expect(sql177).toMatch(
      /v_internal text\[] := array\[[\s\S]*acct_invoice_open_ar_as_of/,
    );
  });

  it("147. subtype locked after journal history", () => {
    expect(sql177).toContain("GL_ACCOUNT_SUBTYPE_LOCKED");
    expect(sql177).toContain("cannot change subtype when journal_lines exist");
  });

  it("148. no WHEN OTHERS swallow to zero in 0177", () => {
    expect(sql177).not.toMatch(/exception\s+when\s+others\s+then[\s\S]{0,80}:=\s*0/i);
  });

  it("149. architecture documents RE / historical AR policies", () => {
    const arch = readFileSync(archDoc, "utf8");
    expect(arch).toContain("unclosed_earnings");
    expect(arch).toContain("HISTORICAL_COMMERCIAL_UNSUPPORTED");
    expect(arch).toContain("approval_snapshot");
  });

  it("150. replacement/supplemental flows retain per-invoice commercial", () => {
    // Original invoice commercial stays; supplemental is a second row.
    const original = historicalOpenArAsOf({
      commercialTotal: 1000,
      asOfDate: "2026-06-30",
    });
    const supplemental = historicalOpenArAsOf({
      commercialTotal: 200,
      asOfDate: "2026-06-30",
    });
    expect(original + supplemental).toBe(1200);
  });

  it("151. revenue/expense reversal nets in period TB movement", () => {
    expect(
      trialBalanceEndingFromPeriod({
        accountType: "revenue",
        beginning: 1000,
        periodDebits: 1000,
        periodCredits: 0,
      }),
    ).toBe(0);
  });

  it("152. multi-period TB windows are independent", () => {
    const q1End = trialBalanceEndingFromPeriod({
      accountType: "asset",
      beginning: 0,
      periodDebits: 100,
      periodCredits: 0,
    });
    const q2End = trialBalanceEndingFromPeriod({
      accountType: "asset",
      beginning: q1End,
      periodDebits: 50,
      periodCredits: 20,
    });
    expect(q1End).toBe(100);
    expect(q2End).toBe(130);
  });
});

describe("F6-P5 Balance Sheet sign correction — proof scenarios", () => {
  it("153. TEST A profit: rev 100k / exp 70k → unclosed 30k (not 170k)", () => {
    const revNat = accountNaturalBalance("revenue", 0, 100_000);
    const expNat = accountNaturalBalance("expense", 70_000, 0);
    expect(revNat).toBe(100_000);
    expect(expNat).toBe(70_000);
    const unclosed = unclosedEarningsFromNaturalBalances({
      revenueNaturalBalances: [revNat],
      expenseNaturalBalances: [expNat],
    });
    expect(unclosed).toBe(30_000);
    expect(unclosed).not.toBe(170_000);
    // Cash 30k asset from net profit; BS balances.
    const bs = balanceSheetFromNaturalBalances({
      assets: 30_000,
      liabilities: 0,
      equityAccounts: 0,
      revenueNatural: revNat,
      expenseNatural: expNat,
      currentYearNetIncomeDisclosure: 30_000,
    });
    expect(bs.unclosedEarnings).toBe(30_000);
    expect(bs.equityReported).toBe(30_000);
    expect(bs.balanced).toBe(true);
  });

  it("154. TEST B loss: rev 50k / exp 80k → unclosed -30k reduces equity", () => {
    const revNat = accountNaturalBalance("revenue", 0, 50_000);
    const expNat = accountNaturalBalance("expense", 80_000, 0);
    const unclosed = unclosedEarningsFromNaturalBalances({
      revenueNaturalBalances: [revNat],
      expenseNaturalBalances: [expNat],
    });
    expect(unclosed).toBe(-30_000);
    const bs = balanceSheetFromNaturalBalances({
      assets: 0,
      liabilities: 30_000,
      equityAccounts: 0,
      revenueNatural: revNat,
      expenseNatural: expNat,
    });
    expect(bs.unclosedEarnings).toBe(-30_000);
    expect(bs.equityReported).toBe(-30_000);
    expect(bs.balanced).toBe(true);
  });

  it("155. TEST C prior year unclosed + current year residual = 45k once", () => {
    // 2025: 100k - 70k = 30k still open; 2026: 40k - 25k = 15k
    const unclosed = unclosedEarningsFromNaturalBalances({
      revenueNaturalBalances: [100_000, 40_000],
      expenseNaturalBalances: [70_000, 25_000],
    });
    expect(unclosed).toBe(45_000);
    const bs = balanceSheetFromNaturalBalances({
      assets: 45_000,
      liabilities: 0,
      equityAccounts: 0,
      revenueNatural: 140_000,
      expenseNatural: 95_000,
      currentYearNetIncomeDisclosure: 15_000,
    });
    expect(bs.unclosedEarnings).toBe(45_000);
    expect(bs.equityReported).toBe(45_000);
    // Disclosure must not change equation if wrongly added:
    expect(
      balanceSheetEquityReported({
        equityAccounts: 0,
        unclosedEarnings: bs.unclosedEarnings,
      }),
    ).toBe(45_000);
    expect(bs.currentYearNetIncomeDisclosure).toBe(15_000);
    expect(bs.balanced).toBe(true);
  });

  it("156. TEST D post-close: RE has 30k + unclosed 15k = 45k (not 75k)", () => {
    // After close: 2025 P&L zeroed into RE equity 30k; residual P&L = 2026 only 15k
    const unclosed = unclosedEarningsFromNaturalBalances({
      revenueNaturalBalances: [40_000],
      expenseNaturalBalances: [25_000],
    });
    expect(unclosed).toBe(15_000);
    const equityReported = balanceSheetEquityReported({
      equityAccounts: 30_000,
      unclosedEarnings: unclosed,
    });
    expect(equityReported).toBe(45_000);
    expect(equityReported).not.toBe(75_000);
    expect(equityReported).not.toBe(15_000);
    expect(equityReported).not.toBe(145_000);
    expect(
      balanceSheetEquationHolds({
        assets: 45_000,
        liabilities: 0,
        equityWithIncome: equityReported,
      }),
    ).toBe(true);
  });

  it("157. TEST E historical as-of before close ignores future close journal", () => {
    // As-of 2025-12-31: close dated 2026-01-05 not yet in ledger → unclosed 30k
    const beforeClose = balanceSheetFromNaturalBalances({
      assets: 30_000,
      liabilities: 0,
      equityAccounts: 0,
      revenueNatural: 100_000,
      expenseNatural: 70_000,
    });
    expect(beforeClose.unclosedEarnings).toBe(30_000);
    expect(beforeClose.balanced).toBe(true);
    // As-of 2026-01-05 after close journal: RE 30k, P&L residual 0
    const afterClose = balanceSheetFromNaturalBalances({
      assets: 30_000,
      liabilities: 0,
      equityAccounts: 30_000,
      revenueNatural: 0,
      expenseNatural: 0,
    });
    expect(afterClose.unclosedEarnings).toBe(0);
    expect(afterClose.equityReported).toBe(30_000);
    expect(afterClose.balanced).toBe(true);
    // Future close does not rewrite earlier report amount
    expect(beforeClose.unclosedEarnings).toBe(30_000);
  });

  it("158. TEST F reversal of year-close restores residual P&L on ledger", () => {
    // After close then reverse: RE back to 0, P&L residual restored to 30k
    const afterReversal = balanceSheetFromNaturalBalances({
      assets: 30_000,
      liabilities: 0,
      equityAccounts: 0,
      revenueNatural: 100_000,
      expenseNatural: 70_000,
    });
    expect(afterReversal.unclosedEarnings).toBe(30_000);
    expect(afterReversal.equityReported).toBe(30_000);
    expect(afterReversal.balanced).toBe(true);
    // Follows posted ledger as-of — not close-status metadata (SQL uses entry_date only)
    expect(sql177).toContain("acct_report_trial_balance_as_of(p_as_of)");
    expect(sql177).toMatch(/entry_date\s*<=\s*p_as_of/);
  });

  it("159. CYE disclosure is not added a second time into equity_reported", () => {
    expect(sql177).toContain("disclosure_only");
    expect(sql177).toContain(
      "never also add v_cy_ni (would double-count)",
    );
    const bs = balanceSheetFromNaturalBalances({
      assets: 30_000,
      liabilities: 0,
      equityAccounts: 0,
      revenueNatural: 100_000,
      expenseNatural: 70_000,
      currentYearNetIncomeDisclosure: 30_000,
    });
    // Wrong double-add would be 60k
    expect(bs.equityReported).toBe(30_000);
    expect(bs.equityReported + bs.currentYearNetIncomeDisclosure).toBe(60_000);
  });

  it("160. imbalance is reported — unclosed never force-adjusted to balance", () => {
    const broken = balanceSheetFromNaturalBalances({
      assets: 99_000,
      liabilities: 0,
      equityAccounts: 0,
      revenueNatural: 100_000,
      expenseNatural: 70_000,
    });
    expect(broken.unclosedEarnings).toBe(30_000);
    expect(broken.equityReported).toBe(30_000);
    expect(broken.balanced).toBe(false);
    expect(sql177).toContain("critical_error");
    expect(sql177).toContain("never force-balance");
  });

  it("161. accounting sign audit — natural balance conventions", () => {
    expect(isDebitNormal("asset")).toBe(true);
    expect(isDebitNormal("expense")).toBe(true);
    expect(isDebitNormal("liability")).toBe(false);
    expect(isDebitNormal("equity")).toBe(false);
    expect(isDebitNormal("revenue")).toBe(false);
    expect(accountNaturalBalance("asset", 100, 40)).toBe(60);
    expect(accountNaturalBalance("expense", 70, 10)).toBe(60);
    expect(accountNaturalBalance("liability", 10, 100)).toBe(90);
    expect(accountNaturalBalance("equity", 5, 50)).toBe(45);
    expect(accountNaturalBalance("revenue", 0, 100)).toBe(100);
    expect(sql177).toContain("p_type in ('asset', 'expense')");
    expect(sql177).toContain("p_debit - p_credit");
    expect(sql177).toContain("p_credit - p_debit");
    // Net income = revenue_nat - expense_nat (SQL)
    expect(sql177).toContain(
      "v_unclosed := public.acct_round2(coalesce(v_rev_nat, 0) - coalesce(v_exp_nat, 0))",
    );
  });

  it("162. SQL comment forbids adding expense naturals to earnings", () => {
    expect(sql177).toContain("Do NOT add expense naturals to earnings");
    expect(sql177).toContain("SUBTRACT from earnings");
  });
});

describe("F6-P5 inactive GL account historical lifecycle", () => {
  const inactiveCash = { ...cash, is_active: false as const };
  const inactiveEquity = { ...equity, is_active: false as const };
  const inactiveRev = { ...revenue, is_active: false as const };
  const inactiveOpex = { ...opex, is_active: false as const };
  const inactiveCogs = { ...cogs, is_active: false as const };
  const inactiveAp = { ...ap, is_active: false as const };

  it("163. inactive asset remains in historical TB", () => {
    const lines = [
      line("cash", 50_000, 0, "2026-06-01"),
      line("eq", 0, 50_000, "2026-06-01"),
    ];
    const tb = buildTrialBalance({
      accounts: [inactiveCash, equity],
      lines,
    });
    const row = tb.rows.find((r) => r.accountId === "cash");
    expect(row).toBeTruthy();
    expect(row!.totalDebit).toBe(50_000);
    expect(row!.isActive).toBe(false);
    expect(tb.balanced).toBe(true);
  });

  it("164. inactive liability remains in historical TB", () => {
    // Dr expense / Cr AP
    const lines2 = [
      line("opex", 20_000, 0, "2026-06-01"),
      line("ap", 0, 20_000, "2026-06-01"),
    ];
    const tb = buildTrialBalance({
      accounts: [opex, inactiveAp],
      lines: lines2,
    });
    expect(tb.rows.find((r) => r.accountId === "ap")?.totalCredit).toBe(20_000);
    expect(tb.balanced).toBe(true);
  });

  it("165. inactive equity remains in historical TB", () => {
    const lines = [
      line("cash", 50_000, 0, "2026-06-01"),
      line("eq", 0, 50_000, "2026-06-01"),
    ];
    const tb = buildTrialBalance({
      accounts: [cash, inactiveEquity],
      lines,
    });
    expect(tb.rows.find((r) => r.accountId === "eq")?.totalCredit).toBe(50_000);
    expect(tb.balanced).toBe(true);
  });

  it("166. inactive revenue remains in historical P&L", () => {
    const lines = [
      line("rev", 0, 1000, "2026-06-10"),
      line("cash", 1000, 0, "2026-06-10"),
    ];
    const active = buildAccountingPnL({
      accounts: [revenue, cash],
      lines,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });
    const inactive = buildAccountingPnL({
      accounts: [inactiveRev, cash],
      lines,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });
    expect(inactive.revenue).toBe(1000);
    expect(inactive.revenue).toBe(active.revenue);
    expect(inactive.netIncome).toBe(active.netIncome);
  });

  it("167. inactive expense remains in historical P&L", () => {
    const lines = [
      line("opex", 150, 0, "2026-06-10"),
      line("cash", 0, 150, "2026-06-10"),
    ];
    const active = buildAccountingPnL({
      accounts: [opex, cash],
      lines,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });
    const inactive = buildAccountingPnL({
      accounts: [inactiveOpex, cash],
      lines,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });
    expect(inactive.operatingExpenses).toBe(150);
    expect(inactive.netIncome).toBe(active.netIncome);
  });

  it("168. inactive COGS remains in historical P&L", () => {
    const lines = [
      line("cogs", 400, 0, "2026-06-10"),
      line("cash", 0, 400, "2026-06-10"),
    ];
    const active = buildAccountingPnL({
      accounts: [cogs, cash],
      lines,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });
    const inactive = buildAccountingPnL({
      accounts: [inactiveCogs, cash],
      lines,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });
    expect(inactive.cogs).toBe(400);
    expect(inactive.netIncome).toBe(active.netIncome);
  });

  it("169. SQL GL includes inactive account history (no is_active filter)", () => {
    expect(sql177).toContain(
      "No is_active filter: inactive accounts remain in historical GL drill-down",
    );
    expect(sql177).toContain("account_is_active");
  });

  it("170. inactive accounts still contribute to Balance Sheet / unclosed earnings", () => {
    // Balanced: Dr cash 30k, Dr opex 70k, Cr rev 100k
    const linesBalanced = [
      line("cash", 30_000, 0, "2026-06-01"),
      line("opex", 70_000, 0, "2026-06-01"),
      line("rev", 0, 100_000, "2026-06-01"),
    ];
    const bsActive = buildBalanceSheet({
      accounts: [cash, revenue, opex],
      lines: linesBalanced,
      asOfDate: "2026-06-30",
      netIncomeToDate: 30_000,
    });
    const bsInactive = buildBalanceSheet({
      accounts: [inactiveCash, inactiveRev, inactiveOpex],
      lines: linesBalanced,
      asOfDate: "2026-06-30",
      netIncomeToDate: 30_000,
    });
    expect(bsInactive.assets).toBe(bsActive.assets);
    expect(bsInactive.equityWithIncome).toBe(bsActive.equityWithIncome);
    expect(bsInactive.balanced).toBe(bsActive.balanced);
    const uce = unclosedEarningsFromNaturalBalances({
      revenueNaturalBalances: [100_000],
      expenseNaturalBalances: [70_000],
    });
    expect(uce).toBe(30_000);
  });

  it("171. TB remains balanced after deactivating debit-side account", () => {
    const lines = [
      line("cash", 50_000, 0, "2026-06-01"),
      line("eq", 0, 50_000, "2026-06-01"),
    ];
    const before = buildTrialBalance({ accounts: [cash, equity], lines });
    const after = buildTrialBalance({
      accounts: [inactiveCash, equity],
      lines,
    });
    expect(before.balanced).toBe(true);
    expect(after.balanced).toBe(true);
    expect(after.totalDebits).toBe(50_000);
    expect(after.totalCredits).toBe(50_000);
    expect(after.rows.find((r) => r.accountId === "cash")).toBeTruthy();
  });

  it("172. TB remains balanced after deactivating credit-side account", () => {
    const lines = [
      line("cash", 50_000, 0, "2026-06-01"),
      line("eq", 0, 50_000, "2026-06-01"),
    ];
    const after = buildTrialBalance({
      accounts: [cash, inactiveEquity],
      lines,
    });
    expect(after.balanced).toBe(true);
    expect(after.rows.find((r) => r.accountId === "eq")?.totalCredit).toBe(
      50_000,
    );
  });

  it("173. P&L economically unchanged by account deactivation", () => {
    const lines = [
      line("rev", 0, 1000, "2026-06-10"),
      line("cogs", 400, 0, "2026-06-10"),
      line("opex", 150, 0, "2026-06-10"),
      line("cash", 450, 0, "2026-06-10"),
    ];
    const a = buildAccountingPnL({
      accounts: [revenue, cogs, opex, cash],
      lines,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });
    const b = buildAccountingPnL({
      accounts: [inactiveRev, inactiveCogs, inactiveOpex, inactiveCash],
      lines,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });
    expect(b).toEqual(a);
  });

  it("174. zero-balance suppression still skips empty inactive accounts", () => {
    const dead = { ...cash, id: "dead", code: "1999", is_active: false };
    const lines = [
      line("cash", 10, 0, "2026-06-01"),
      line("rev", 0, 10, "2026-06-01"),
    ];
    const tb = buildTrialBalance({
      accounts: [cash, revenue, dead],
      lines,
    });
    expect(tb.rows.every((r) => r.accountId !== "dead")).toBe(true);
  });

  it("175. SQL TB does not filter economic rows on is_active", () => {
    expect(sql177).toContain(
      "Do NOT filter on is_active — inactive accounts with history must remain",
    );
    expect(sql177).not.toMatch(
      /from acct_ids ids[\s\S]{0,400}where coalesce\(a\.is_active,\s*true\)/,
    );
  });

  it("176. subtype/type lock + deactivate preserve history comments", () => {
    expect(sql177).toContain("GL_ACCOUNT_SUBTYPE_LOCKED");
    expect(sql177).toContain("GL_ACCOUNT_TYPE_LOCKED");
    expect(sql177).toContain(
      "Deactivation preserves the row and ALL journal history",
    );
    expect(sql177).toContain("set is_active = false");
    expect(sql177).not.toMatch(/delete from public\.journal_lines/i);
    expect(sql177).not.toMatch(/delete from public\.journal_entries/i);
  });

  it("177. presentation metadata: is_active returned on TB rows", () => {
    expect(sql177).toContain("'is_active', c.is_active");
  });
});

describe("F6-P5 accounting period concurrency hardening", () => {
  it("178. sequential / identical / contained / containing overlaps rejected", () => {
    expect(
      accountingPeriodsOverlap({
        aStart: "2026-01-01",
        aEnd: "2026-01-31",
        bStart: "2026-01-15",
        bEnd: "2026-02-15",
      }),
    ).toBe(true);
    expect(
      accountingPeriodsOverlap({
        aStart: "2026-01-01",
        aEnd: "2026-01-31",
        bStart: "2026-01-01",
        bEnd: "2026-01-31",
      }),
    ).toBe(true);
    expect(
      accountingPeriodsOverlap({
        aStart: "2026-01-01",
        aEnd: "2026-03-31",
        bStart: "2026-02-01",
        bEnd: "2026-02-28",
      }),
    ).toBe(true);
    expect(
      accountingPeriodsOverlap({
        aStart: "2026-02-01",
        aEnd: "2026-02-28",
        bStart: "2026-01-01",
        bEnd: "2026-03-31",
      }),
    ).toBe(true);
  });

  it("179. inclusive boundary overlap rejected; adjacent accepted", () => {
    expect(
      accountingPeriodsOverlap({
        aStart: "2026-01-01",
        aEnd: "2026-01-31",
        bStart: "2026-01-31",
        bEnd: "2026-02-28",
      }),
    ).toBe(true);
    expect(
      accountingPeriodsOverlap({
        aStart: "2026-01-01",
        aEnd: "2026-01-31",
        bStart: "2026-02-01",
        bEnd: "2026-02-28",
      }),
    ).toBe(false);
  });

  it("180. start_date > end_date invalid", () => {
    expect(accountingPeriodDatesValid("2026-02-01", "2026-01-01")).toBe(false);
    expect(accountingPeriodDatesValid("2026-01-01", "2026-01-31")).toBe(true);
    expect(sql177).toContain("accounting_periods_dates_chk");
    expect(sql177).toContain("ACCT_PERIOD_DATE_ORDER");
  });

  it("181. GiST EXCLUDE + existing-overlap fail-closed present", () => {
    expect(sql177).toContain("create extension if not exists btree_gist");
    expect(sql177).toContain("accounting_periods_daterange_excl");
    expect(sql177).toContain("exclude using gist");
    expect(sql177).toContain("ACCT_PERIOD_OVERLAP_EXISTING");
    expect(sql177).toContain("pg_advisory_xact_lock(178, 1)");
  });

  it("182. concurrent overlap cannot both commit (EXCLUDE marker)", () => {
    // DB-boundary: GiST exclusion serializes conflicting inserts.
    expect(sql177).toContain(
      "Concurrency-safe: overlapping inclusive dateranges cannot both commit",
    );
    expect(sql177).toContain("daterange(start_date, end_date, '[]') with &&");
  });

  it("183. post_journal locks period FOR UPDATE via acct_lock_period_for_posting", () => {
    expect(sql177).toContain("acct_lock_period_for_posting");
    expect(sql177).toContain("v_period_gate := public.acct_lock_period_for_posting");
    expect(sql177).toMatch(
      /from public\.accounting_periods\s+where id = v_period_id\s+for update/i,
    );
    expect(ACCT_INTERNAL_HELPERS).toContain("acct_lock_period_for_posting");
    expect(ACCT_PERIOD_LOCK_PROTOCOL).toContain("for_update_accounting_periods_row");
  });

  it("184. close readiness under FOR UPDATE (authoritative single check)", () => {
    expect(sql177).toContain(
      "Final readiness WHILE holding period FOR UPDATE",
    );
    expect(sql177).toContain(
      "Writers (post_journal + enqueue_accounting_outbox_safe) take the same row",
    );
    const closeIdx = sql177.indexOf(
      "create or replace function public.acct_period_close_safe",
    );
    const closeBody = sql177.slice(closeIdx, closeIdx + 4500);
    // One authoritative readiness call under lock is sufficient once writers share the lock.
    expect(
      (closeBody.match(/acct_period_close_readiness\(p_period_id\)/g) ?? [])
        .length,
    ).toBe(1);
  });

  it("185. locked period cannot be reopened by ordinary reopen path", () => {
    expect(sql177).toContain(
      "ACCT_PERIOD_LOCKED: unlock/admin workflow required before reopen",
    );
  });

  it("186. period close/reopen/lock remain admin-only", () => {
    expect(sql177).toContain("acct_require_admin('close accounting periods')");
    expect(sql177).toContain("acct_require_admin('reopen accounting periods')");
    expect(sql177).toContain("acct_require_admin('lock accounting periods')");
    expect(ACCT_PERIOD_RPCS).toEqual(
      expect.arrayContaining([
        "acct_period_close_safe",
        "acct_period_reopen_safe",
        "acct_period_lock_safe",
      ]),
    );
  });

  it("187. internal period helpers denied to authenticated", () => {
    expect(sql177).toContain("'acct_lock_period_for_posting'");
    expect(sql177).toContain("'acct_period_close_readiness'");
    expect(sql177).toContain("'acct_parse_outbox_economic_date'");
    expect(sql177).toMatch(
      /if r\.proname = any \(v_internal\) then[\s\S]*?revoke all on function %s from authenticated/,
    );
  });

  it("188. accounting flags / posting OFF markers preserved", () => {
    expect(sql177).toContain("Do NOT set posting_enabled");
    expect(sql177).toMatch(/Posting stays OFF|posting remains OFF/i);
    expect(postingRemainsOffInP5()).toBe(true);
    expect(booksOfRecordNotEnabledInP5()).toBe(true);
  });

  it("189. inactive-account + BS sign fixes not regressed", () => {
    expect(sql177).toContain(
      "Do NOT filter on is_active — inactive accounts with history must remain",
    );
    expect(sql177).toContain(
      "v_unclosed := public.acct_round2(coalesce(v_rev_nat, 0) - coalesce(v_exp_nat, 0))",
    );
    expect(
      unclosedEarningsFromNaturalBalances({
        revenueNaturalBalances: [100_000],
        expenseNaturalBalances: [70_000],
      }),
    ).toBe(30_000);
    expect(
      unclosedEarningsFromNaturalBalances({
        revenueNaturalBalances: [50_000],
        expenseNaturalBalances: [80_000],
      }),
    ).toBe(-30_000);
  });

  it("190. no-deadlock lock order documented (period after domain locks on post)", () => {
    expect(sql177).toContain(
      "Lock order: period row lock is taken inside post_journal / enqueue AFTER caller",
    );
  });

  it("191. enqueue locks period FOR UPDATE before outbox insert", () => {
    const enqIdx = sql177.indexOf(
      "create or replace function public.enqueue_accounting_outbox_safe",
    );
    expect(enqIdx).toBeGreaterThan(-1);
    const enqBody = sql177.slice(enqIdx, enqIdx + 5500);
    expect(enqBody).toContain(
      "v_period_gate := public.acct_lock_period_for_posting(v_econ)",
    );
    expect(enqBody).toContain("insert into public.accounting_posting_outbox");
    // Lock precedes insert
    expect(enqBody.indexOf("acct_lock_period_for_posting(v_econ)")).toBeLessThan(
      enqBody.indexOf("insert into public.accounting_posting_outbox"),
    );
    expect(ACCT_PERIOD_LOCK_PROTOCOL).toContain("post_journal_or_enqueue_outbox");
  });

  it("192. close-first race: outbox waits on same period row (protocol markers)", () => {
    // Close holds FOR UPDATE; enqueue calls acct_lock_period_for_posting → waits/fails closed.
    expect(sql177).toContain(
      "Prevents stranded same-period outbox rows after close commits",
    );
    expect(sql177).toContain(
      "no same-period event can become eligible mid-close",
    );
  });

  it("193. outbox-first race: close readiness sees pending after enqueue commits", () => {
    expect(sql177).toContain(
      "Pending accounting events exist for this period.",
    );
    const r = assessPeriodCloseOutboxReadiness({
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      rows: [
        {
          status: "pending",
          payload: { economicEventDate: "2026-01-15" },
        },
      ],
    });
    expect(r.ready).toBe(false);
    expect(r.periodPending).toBe(1);
  });

  it("194. future-period pending does not block earlier-period close", () => {
    const r = assessPeriodCloseOutboxReadiness({
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      rows: [
        {
          status: "pending",
          payload: { economicEventDate: "2026-02-10" },
        },
      ],
    });
    expect(r.ready).toBe(true);
    expect(r.periodPending).toBe(0);
    expect(sql177).toContain("other period; do not block this close");
  });

  it("195. same-period pending blocks close", () => {
    expect(
      outboxRowCloseReadinessImpact({
        status: "pending",
        payload: { economicEventDate: "2026-01-20" },
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
      }).impact,
    ).toBe("pending");
  });

  it("196. same-period error/failed blocks close", () => {
    expect(
      outboxRowCloseReadinessImpact({
        status: "error",
        payload: { economicEventDate: "2026-01-20" },
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
      }).impact,
    ).toBe("error");
    expect(sql177).toContain(
      "Failed accounting events exist for this period.",
    );
  });

  it("197. malformed economic event date fails closed", () => {
    expect(parseOutboxEconomicEventDate({ economicEventDate: "not-a-date" })).toEqual({
      ok: false,
      code: OUTBOX_EVENT_DATE_UNRESOLVED,
    });
    expect(parseOutboxEconomicEventDate({ economicEventDate: "2026-13-99" })).toEqual({
      ok: false,
      code: OUTBOX_EVENT_DATE_UNRESOLVED,
    });
    expect(sql177).toContain("OUTBOX_EVENT_DATE_UNRESOLVED");
    const r = assessPeriodCloseOutboxReadiness({
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      rows: [{ status: "pending", payload: { economicEventDate: "bogus" } }],
    });
    expect(r.ready).toBe(false);
    expect(r.blockers).toContain(OUTBOX_EVENT_DATE_UNRESOLVED);
  });

  it("198. missing economic date / no resolvable period fails closed", () => {
    expect(parseOutboxEconomicEventDate({})).toEqual({
      ok: false,
      code: OUTBOX_EVENT_DATE_UNRESOLVED,
    });
    expect(sql177).toContain("'code', 'ACCT_PERIOD_NONE'");
    // Enqueue raises when period gate fails (no period covering date).
    const enqIdx = sql177.lastIndexOf(
      "create or replace function public.enqueue_accounting_outbox_safe",
    );
    const enqBody = sql177.slice(enqIdx, enqIdx + 5500);
    expect(enqBody).toMatch(
      /raise exception '%: %'[\s\S]*?coalesce\(v_period_gate->>'code'/,
    );
  });

  it("199. journal-posting close race remains protected", () => {
    expect(sql177).toContain(
      "v_period_gate := public.acct_lock_period_for_posting(p_entry_date)",
    );
    expect(sql177).toContain("OPENING_BALANCE_TRUST_REQUIRED");
  });

  it("200. overlapping-period concurrency remains protected", () => {
    expect(sql177).toContain("accounting_periods_daterange_excl");
    expect(sql177).toContain("ACCT_PERIOD_OVERLAP_EXISTING");
  });

  it("201. no deadlock between domain→period and close paths", () => {
    expect(sql177).toContain(
      "so it cannot deadlock with inventory/AP (those wait on period after",
    );
  });

  it("202. accounting flags remain unchanged (markers)", () => {
    expect(sql177).toContain("Do NOT update posting_enabled / books_of_record");
    expect(postingRemainsOffInP5()).toBe(true);
  });

  it("203. audit/idempotency exact-once control markers preserved", () => {
    expect(sql177).toContain("IDEMPOTENCY_CONFLICT: key reused with different control context.");
    expect(sql177).toContain("accounting_control_idempotency");
  });

  it("204. period-scoped readiness uses acct_parse_outbox_economic_date (no silent exclude)", () => {
    expect(sql177).toContain("acct_parse_outbox_economic_date");
    expect(sql177).toContain("Never silent-exclude");
    expect(ACCT_INTERNAL_HELPERS).toContain("acct_parse_outbox_economic_date");
  });
});
