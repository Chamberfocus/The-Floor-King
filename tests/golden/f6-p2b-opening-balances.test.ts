/**
 * F6-P2B — Opening balance wizard (owner review revision: no auto equity plug).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUDIT_IDEMPOTENCY_PATTERNS,
  FINANCIAL_AUDIT_ACTION_LABELS,
} from "@/lib/accounting/audit-log";
import {
  classifyRequestIdentity,
  expectedExecuteGrantAfter0172,
  mayInvokeF6P2BRpc,
  mayInvokeF6P2BInternalRpc,
  mayInvokeLegacyMoneyRpc,
  resolveAccountingActorId,
} from "@/lib/accounting/f5-rpc-auth";
import {
  buildOpeningJournalLines,
  imbalanceWarning,
  mergeApAgingBills,
  mergeArAgingInvoices,
  openingBalancePostingExceptionPolicy,
  openingStatusLabel,
  validateOpeningBatchDraft,
} from "@/lib/accounting/opening-balances";
import {
  buildAccountingPnL,
  buildApAging,
  buildArAging,
  buildBalanceSheet,
  buildTrialBalance,
} from "@/lib/accounting/reports";
import { assessAutoPostAllowed } from "@/lib/accounting/posting-policy";
import type { AccountMappingDict } from "@/lib/accounting/types";

const ROOT = join(process.cwd());
const sql172 = readFileSync(
  join(ROOT, "supabase/migrations/0172_f6_p2b_opening_balance_wizard.sql"),
  "utf8",
);
const sql171 = readFileSync(
  join(ROOT, "supabase/migrations/0171_f6_p2a_audit_retrofit.sql"),
  "utf8",
);

const IDS = {
  cash: "cash-1",
  ar: "ar-1",
  inv: "inv-1",
  ap: "ap-1",
  loan: "loan-1",
  obe: "obe-1",
  rev: "rev-1",
};

const mappings: AccountMappingDict = {
  cash_operating: IDS.cash,
  accounts_receivable: IDS.ar,
  accounts_payable: IDS.ap,
  opening_balance_equity: IDS.obe,
  inventory_asset: IDS.inv,
};

const accounts = [
  { id: IDS.cash, accountType: "asset", subtype: "cash", isActive: true },
  { id: IDS.ar, accountType: "asset", subtype: "receivable", isActive: true },
  { id: IDS.inv, accountType: "asset", subtype: "inventory", isActive: true },
  { id: IDS.ap, accountType: "liability", subtype: "payable", isActive: true },
  { id: IDS.loan, accountType: "liability", subtype: "loan", isActive: true },
  { id: IDS.obe, accountType: "equity", subtype: null, isActive: true },
  { id: IDS.rev, accountType: "revenue", subtype: null, isActive: true },
  { id: "inactive", accountType: "asset", subtype: "cash", isActive: false },
];

const glAccounts = [
  {
    id: IDS.cash,
    code: "1000",
    name: "Cash",
    account_type: "asset" as const,
    subtype: "cash",
    is_active: true,
  },
  {
    id: IDS.ar,
    code: "1100",
    name: "AR",
    account_type: "asset" as const,
    subtype: "receivable",
    is_active: true,
  },
  {
    id: IDS.inv,
    code: "1200",
    name: "Inventory",
    account_type: "asset" as const,
    subtype: "inventory",
    is_active: true,
  },
  {
    id: IDS.ap,
    code: "2000",
    name: "AP",
    account_type: "liability" as const,
    subtype: "payable",
    is_active: true,
  },
  {
    id: IDS.loan,
    code: "2500",
    name: "Loan",
    account_type: "liability" as const,
    subtype: "loan",
    is_active: true,
  },
  {
    id: IDS.obe,
    code: "3900",
    name: "Opening Balance Equity",
    account_type: "equity" as const,
    subtype: null,
    is_active: true,
  },
  {
    id: IDS.rev,
    code: "4000",
    name: "Sales",
    account_type: "revenue" as const,
    subtype: null,
    is_active: true,
  },
];

describe("F6-P2B owner review — no silent equity plug", () => {
  it("A/B. $50,000 missing liability fails validation; totals unchanged", () => {
    const built = buildOpeningJournalLines({
      lines: [{ accountId: IDS.cash, signedAmount: 50000 }],
      arTotal: 0,
      apTotal: 0,
      mappings,
    });
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.error).toBe("Opening balances do not balance.");
      expect(built.totalDebits).toBe(50000);
      expect(built.totalCredits).toBe(0);
      expect(built.difference).toBe(50000);
      expect(built.lines?.some((l) => l.accountId === IDS.obe)).toBe(false);
    }
    expect(imbalanceWarning(50000)).toContain("50000.00");
    expect(sql172).toContain("NEVER silently plug");
    expect(sql172).not.toMatch(/Equity plug absorbs/i);
    expect(sql172).not.toContain("Opening balances do not balance after equity plug");
  });

  it("C/D. finalize SQL has no auto OBE line; explicit equity balances package", () => {
    const finalizeStart = sql172.indexOf(
      "create or replace function public.finalize_opening_balances_safe",
    );
    const finalizeEnd = sql172.indexOf(
      "create or replace function public.void_opening_balance_batch_safe",
    );
    const finalizeBody = sql172.slice(finalizeStart, finalizeEnd);
    expect(finalizeBody).not.toContain("'Opening balance equity'");
    expect(finalizeBody).not.toMatch(/v_obe/);

    const balanced = validateOpeningBatchDraft({
      asOfDate: "2026-01-01",
      lines: [
        { accountId: IDS.cash, signedAmount: 10000 },
        { accountId: IDS.inv, signedAmount: 2000 },
        { accountId: IDS.loan, signedAmount: -3000 },
        { accountId: IDS.obe, signedAmount: -7500 },
      ],
      arItems: [{ customerId: "c1", amount: 1500 }],
      apItems: [{ vendorId: "v1", amount: 3000 }],
      accounts,
      mappings,
    });
    // cash 10000 + inv 2000 + AR 1500 = 13500; loan 3000 + AP 3000 + OBE 7500 = 13500
    expect(balanced.ok).toBe(true);
    if (balanced.ok) {
      expect(balanced.preview.difference).toBe(0);
      expect(
        balanced.preview.lines.some((l) => l.accountId === IDS.obe && l.credit === 7500),
      ).toBe(true);
    }
  });

  it("E/F/G. draft finalize blocked; validated required; server revalidation present", () => {
    expect(sql172).toContain(
      "Validate opening balances before finalizing. Draft batches cannot be posted.",
    );
    expect(sql172).toContain(
      "Opening balance batch must be validated before finalization.",
    );
    expect(sql172).toContain(
      "Independently recompute and revalidate (do not trust prior validation alone).",
    );
    expect(sql172).toContain("opening_balance_compute_package(p_batch_id)");
  });

  it("H–K. AR/AP mappings required only when subledger totals > 0", () => {
    const noArApMaps: AccountMappingDict = {
      cash_operating: IDS.cash,
    };
    const cashOnly = buildOpeningJournalLines({
      lines: [
        { accountId: IDS.cash, signedAmount: 100 },
        { accountId: IDS.obe, signedAmount: -100 },
      ],
      arTotal: 0,
      apTotal: 0,
      mappings: noArApMaps,
    });
    expect(cashOnly.ok).toBe(true);

    const needAr = buildOpeningJournalLines({
      lines: [{ accountId: IDS.cash, signedAmount: 100 }],
      arTotal: 50,
      apTotal: 0,
      mappings: noArApMaps,
    });
    expect(needAr.ok).toBe(false);
    if (!needAr.ok) expect(needAr.error).toMatch(/accounts_receivable/);

    const needAp = buildOpeningJournalLines({
      lines: [{ accountId: IDS.cash, signedAmount: 100 }],
      arTotal: 0,
      apTotal: 50,
      mappings: noArApMaps,
    });
    expect(needAp.ok).toBe(false);
    if (!needAp.ok) expect(needAp.error).toMatch(/accounts_payable/);

    expect(sql172).toContain(
      "required because opening AR > 0",
    );
    expect(sql172).toContain(
      "required because opening AP > 0",
    );
  });

  it("L/M. invalid customer/vendor/job and future as-of dates blocked", () => {
    const badCust = validateOpeningBatchDraft({
      asOfDate: "2026-01-01",
      lines: [
        { accountId: IDS.cash, signedAmount: 10 },
        { accountId: IDS.obe, signedAmount: -10 },
      ],
      arItems: [{ customerId: "missing", amount: 10 }],
      apItems: [],
      accounts,
      mappings,
      knownCustomerIds: new Set(["c1"]),
    });
    expect(badCust.ok).toBe(false);

    const badJob = validateOpeningBatchDraft({
      asOfDate: "2026-01-01",
      lines: [
        { accountId: IDS.cash, signedAmount: 10 },
        { accountId: IDS.obe, signedAmount: -10 },
      ],
      arItems: [{ customerId: "c1", amount: 10, jobId: "j-missing" }],
      apItems: [],
      accounts,
      mappings,
      knownCustomerIds: new Set(["c1"]),
      knownJobIds: new Set(["j1"]),
    });
    expect(badJob.ok).toBe(false);

    const futureAsOf = validateOpeningBatchDraft({
      asOfDate: "2026-01-01",
      lines: [
        { accountId: IDS.cash, signedAmount: 10 },
        { accountId: IDS.obe, signedAmount: -10 },
      ],
      arItems: [
        { customerId: "c1", amount: 10, asOfDate: "2026-02-01" },
      ],
      apItems: [],
      accounts,
      mappings,
      knownCustomerIds: new Set(["c1"]),
    });
    expect(futureAsOf.ok).toBe(false);
    expect(sql172).toContain(
      "Opening AR as-of date cannot be after the batch opening-balance date.",
    );
    expect(sql172).toContain(
      "Opening AP as-of date cannot be after the batch opening-balance date.",
    );
    expect(sql172).toContain("references a missing customer");
    expect(sql172).toContain("references a missing vendor");
    expect(sql172).toContain("references a missing job");
  });

  it("N/O. posting gate hardened in 0172; generic bypass blocked", () => {
    const policy = openingBalancePostingExceptionPolicy();
    expect(policy.openingBalanceAllowedWhenPostingOff).toBe(true);
    expect(policy.openingBalanceRequiresTrustedDefiner).toBe(true);
    expect(policy.manualPostBlockedWhenPostingOff).toBe(true);
    expect(policy.normalInvoicePostBlockedWhenPostingOff).toBe(true);
    expect(policy.genericBypassBlocked).toBe(true);

    expect(sql172).toContain("app.trusted_opening_balance_post");
    expect(sql172).toContain("app.trusted_opening_balance_batch_id");
    expect(sql172).toContain("OPENING_BALANCE_TRUST_REQUIRED");
    expect(sql172).toContain("OPENING_BALANCE_SOURCE_MISMATCH");
    expect(sql172).toContain("post_opening_balance_journal_from_definer_safe");
    expect(sql172).toContain(
      "post_opening_balance_journal_from_definer_safe(",
    );
    expect(sql172).toMatch(
      /finalize_opening_balances_safe[\s\S]*post_opening_balance_journal_from_definer_safe/,
    );
    expect(sql172).toMatch(
      /void_opening_balance_batch_safe[\s\S]*post_opening_balance_journal_from_definer_safe/,
    );

    const postStart = sql172.indexOf(
      "create or replace function public.post_journal_entry_safe(",
    );
    const postEnd = sql172.indexOf(
      "create or replace function public.create_opening_balance_batch_safe",
    );
    const postBody = sql172.slice(postStart, postEnd);
    expect(postBody).toContain(
      "Opening balance journals require the controlled opening-balance workflow.",
    );
    expect(postBody).toContain(
      "Accounting posting is disabled. Enable after cutover validation.",
    );
    expect(postBody).not.toMatch(
      /p_source_type not in \('manual', 'opening_balance'\)/,
    );

    const office = classifyRequestIdentity({
      jwtRole: "authenticated",
      authUid: "u-office",
      appRole: "office",
    });
    const crew = classifyRequestIdentity({
      jwtRole: "authenticated",
      authUid: "u-crew",
      appRole: "crew",
    });
    const anon = classifyRequestIdentity({
      jwtRole: "anon",
      authUid: null,
    });
    expect(
      mayInvokeLegacyMoneyRpc({
        rpc: "post_journal_entry_safe",
        identity: office,
      }).allowed,
    ).toBe(false);
    expect(
      mayInvokeLegacyMoneyRpc({
        rpc: "post_journal_entry_safe",
        identity: crew,
      }).allowed,
    ).toBe(false);
    expect(
      mayInvokeLegacyMoneyRpc({
        rpc: "post_journal_entry_safe",
        identity: anon,
      }).allowed,
    ).toBe(false);
    expect(
      mayInvokeF6P2BInternalRpc({
        rpc: "post_opening_balance_journal_from_definer_safe",
        identity: classifyRequestIdentity({
          jwtRole: "authenticated",
          authUid: "admin-1",
          appRole: "admin",
        }),
      }).allowed,
    ).toBe(false);
    expect(
      mayInvokeF6P2BInternalRpc({
        rpc: "post_opening_balance_journal_from_definer_safe",
        identity: classifyRequestIdentity({
          jwtRole: "service_role",
          authUid: null,
        }),
      }).allowed,
    ).toBe(true);
    expect(expectedExecuteGrantAfter0172("post_opening_balance_journal_from_definer_safe")).toBe(
      "service_role_only",
    );

    const settings = {
      posting_enabled: false,
      inventory_posting_enabled: false,
      cutover_date: null,
      books_of_record: false,
      default_cash_method: "undeposited" as const,
    };
    expect(
      assessAutoPostAllowed({
        settings,
        entryKind: "post",
        sourceType: "invoice",
        entryDate: "2026-01-01",
      }).ok,
    ).toBe(false);
    expect(
      assessAutoPostAllowed({
        settings,
        entryKind: "manual",
        sourceType: "manual",
        entryDate: "2026-01-01",
      }).ok,
    ).toBe(false);
    expect(
      assessAutoPostAllowed({
        settings,
        entryKind: "opening_balance",
        sourceType: "opening_balance",
        entryDate: "2026-01-01",
      }).ok,
    ).toBe(true);
  });

  it("P/Q/R. reversal exactly-once; flag semantics; activation flags unchanged", () => {
    expect(sql172).toContain("opening_balance:batch:");
    expect(sql172).toContain(":void");
    expect(sql172).toContain("v_batch.status = 'void'");
    expect(sql172).toContain("'duplicate', true");
    expect(sql172).toContain("BOOKS_OF_RECORD");
    expect(sql172).not.toMatch(/delete from public\.journal_entries/i);

    const saveStart = sql172.indexOf(
      "create or replace function public.save_opening_balance_draft_safe",
    );
    const saveEnd = sql172.indexOf(
      "create or replace function public.validate_opening_balance_batch_safe",
    );
    expect(sql172.slice(saveStart, saveEnd)).not.toContain(
      "opening_balances_entered = true",
    );
    const validateStart = sql172.indexOf(
      "create or replace function public.validate_opening_balance_batch_safe",
    );
    const validateEnd = sql172.indexOf(
      "create or replace function public.finalize_opening_balances_safe",
    );
    expect(sql172.slice(validateStart, validateEnd)).not.toContain(
      "opening_balances_entered = true",
    );
    expect(sql172).toMatch(
      /finalize_opening_balances_safe[\s\S]*opening_balances_entered = true/,
    );
    expect(sql172).toMatch(
      /void_opening_balance_batch_safe[\s\S]*opening_balances_entered = false/,
    );

    expect(sql172).not.toMatch(/posting_enabled\s*=\s*true/i);
    expect(sql172).not.toMatch(/books_of_record\s*=\s*true/i);
    expect(sql172).not.toMatch(/accountant_validated\s*=\s*true/i);
    expect(sql172).not.toMatch(/cutover_date\s*=/i);
    expect(sql172).not.toMatch(/backup_pitr_confirmed/i);
  });
});

describe("F6-P2B posting gate spoof prevention (0172)", () => {
  it("A/G/H. direct admin opening_balance spoof blocked without trusted context", () => {
    const postBody = sql172.slice(
      sql172.indexOf("create or replace function public.post_journal_entry_safe("),
      sql172.indexOf("create or replace function public.create_opening_balance_batch_safe"),
    );
    expect(postBody).toContain("OPENING_BALANCE_TRUST_REQUIRED");
    expect(postBody).toContain("trusted_opening_balance_batch_id");
    expect(postBody).not.toContain("p_allow_opening_balance");
    expect(postBody).not.toContain("p_trusted");
  });

  it("B/C. finalize/void use trusted helper not direct post_journal_entry_safe", () => {
    const fin = sql172.slice(
      sql172.indexOf("create or replace function public.finalize_opening_balances_safe"),
      sql172.indexOf("create or replace function public.void_opening_balance_batch_safe"),
    );
    expect(fin).toContain("post_opening_balance_journal_from_definer_safe");
    expect(fin).not.toMatch(
      /v_post := public\.post_journal_entry_safe\(/,
    );

    const voidFn = sql172.slice(
      sql172.indexOf("create or replace function public.void_opening_balance_batch_safe"),
      sql172.indexOf("-- ACL sweep"),
    );
    expect(voidFn).toContain("post_opening_balance_journal_from_definer_safe");
    expect(voidFn).not.toMatch(
      /v_rev := public\.post_journal_entry_safe\(/,
    );
  });

  it("I. trusted helper resets GUC on exception path", () => {
    const helper = sql172.slice(
      sql172.indexOf("create or replace function public.post_opening_balance_journal_from_definer_safe"),
      sql172.indexOf("create or replace function public.post_journal_entry_safe"),
    );
    expect(helper).toContain("set_config('app.trusted_opening_balance_post', 'false', true)");
    expect(helper).toContain("when others then");
  });

  it("manual journal posting-off policy documented", () => {
    // 0171 allowed manual while posting off; 0172 blocks all non-trusted posting.
    expect(sql171).toContain("p_source_type not in ('manual', 'opening_balance')");
    const postBody = sql172.slice(
      sql172.indexOf("create or replace function public.post_journal_entry_safe("),
      sql172.indexOf("create or replace function public.create_opening_balance_batch_safe"),
    );
    expect(postBody).toContain(
      "Accounting posting is disabled. Enable after cutover validation.",
    );
    // Legacy admin manual journal UI (postManualJournalAction) is blocked until posting ON.
  });
});

describe("F6-P2B atomic draft save + audit semantics (0172 final)", () => {
  const saveBody = () => {
    const start = sql172.indexOf(
      "create or replace function public.save_opening_balance_draft_safe",
    );
    const end = sql172.indexOf(
      "create or replace function public.validate_opening_balance_batch_safe",
    );
    return sql172.slice(start, end);
  };

  const validateBody = () => {
    const start = sql172.indexOf(
      "create or replace function public.opening_balance_validate_draft_payload",
    );
    const end = sql172.indexOf(
      "create or replace function public.save_opening_balance_draft_safe",
    );
    return sql172.slice(start, end);
  };

  const postBody = () =>
    sql172.slice(
      sql172.indexOf("create or replace function public.post_journal_entry_safe("),
      sql172.indexOf("create or replace function public.create_opening_balance_batch_safe"),
    );

  it("1–7. validate entire payload before any delete; late AR/AP failures cannot wipe draft", () => {
    const save = saveBody();
    const validate = validateBody();
    expect(validate).toContain("invalid_text_representation");
    expect(validate).toContain("jsonb_typeof(p_lines) <> 'array'");
    expect(validate).not.toMatch(/delete from public\.opening_balance/i);

    const validateCall = save.indexOf("opening_balance_validate_draft_payload");
    const deleteLines = save.indexOf("delete from public.opening_balance_lines");
    const deleteAr = save.indexOf("delete from public.opening_ar_items");
    const deleteAp = save.indexOf("delete from public.opening_ap_items");
    expect(validateCall).toBeGreaterThan(-1);
    expect(validateCall).toBeLessThan(deleteLines);
    expect(validateCall).toBeLessThan(deleteAr);
    expect(validateCall).toBeLessThan(deleteAp);
    expect(save).toContain("PHASE A");
    expect(save).toContain("PHASE B");
    expect(save).toMatch(
      /if coalesce\(\(v_validation->>'ok'\)::boolean, false\) is not true then[\s\S]*return v_validation;/,
    );
  });

  it("8. successful save replaces package only after validation passes", () => {
    const save = saveBody();
    expect(save).toContain("delete from public.opening_balance_lines");
    expect(save).toContain("insert into public.opening_ar_items");
    expect(save).toContain("insert into public.opening_ap_items");
    expect(save).toContain("status = 'draft'");
  });

  it("18–19. trusted opening reversal exempt from cutover; generic pre-cutover blocked", () => {
    const post = postBody();
    expect(post).toContain("and not v_is_opening then");
    expect(post).not.toMatch(
      /p_entry_kind <> 'opening_balance'/,
    );
  });

  it("24–26. journal vs workflow audit semantics are distinct and exactly-once per layer", () => {
    const post = postBody();
    expect(post).toContain("when v_is_opening then 'journal_entry_posted'");
    expect(post).not.toContain("when p_entry_kind = 'opening_balance' then 'opening_balance_posted'");

    const finStart = sql172.indexOf("create or replace function public.finalize_opening_balances_safe");
    const finEnd = sql172.indexOf("create or replace function public.void_opening_balance_batch_safe");
    const fin = sql172.slice(finStart, finEnd);
    expect(fin).toContain("'opening_balance_posted'");
    expect(fin).toContain("'audit:opening_batch_post:'");
    expect(fin).not.toContain("'journal_entry_posted'");

    const voidFn = sql172.slice(
      sql172.indexOf("create or replace function public.void_opening_balance_batch_safe"),
      sql172.indexOf("-- ACL sweep"),
    );
    expect(voidFn).toContain("'opening_balance_reversed'");
    expect(voidFn).toContain("'audit:opening_batch_void:'");

    expect(FINANCIAL_AUDIT_ACTION_LABELS.journal_entry_posted).toBe("Journal entry posted");
    expect(FINANCIAL_AUDIT_ACTION_LABELS.opening_balance_posted).toBeTruthy();
    expect(FINANCIAL_AUDIT_ACTION_LABELS.opening_balance_reversed).toBeTruthy();
    expect(AUDIT_IDEMPOTENCY_PATTERNS.journal("je-1")).toBe("audit:journal:je-1");
    expect(AUDIT_IDEMPOTENCY_PATTERNS.openingBatchPost("b1")).toBe(
      "audit:opening_batch_post:b1",
    );
  });

  it("20. validate helper internal-only like other trusted helpers", () => {
    expect(sql172).toContain("opening_balance_validate_draft_payload");
    expect(
      mayInvokeF6P2BInternalRpc({
        rpc: "opening_balance_validate_draft_payload",
        identity: classifyRequestIdentity({
          jwtRole: "authenticated",
          authUid: "a",
          appRole: "admin",
        }),
      }).allowed,
    ).toBe(false);
    expect(
      mayInvokeF6P2BInternalRpc({
        rpc: "opening_balance_validate_draft_payload",
        identity: classifyRequestIdentity({
          jwtRole: "service_role",
          authUid: null,
        }),
      }).allowed,
    ).toBe(true);
  });
});

describe("F6-P2B ACL + migration markers (revised)", () => {
  it("admin-only finalize; actor spoof blocked; compute package internal", () => {
    expect(
      mayInvokeF6P2BRpc({
        rpc: "finalize_opening_balances_safe",
        identity: classifyRequestIdentity({
          jwtRole: "authenticated",
          authUid: "a",
          appRole: "admin",
        }),
      }).allowed,
    ).toBe(true);
    expect(
      mayInvokeF6P2BRpc({
        rpc: "finalize_opening_balances_safe",
        identity: classifyRequestIdentity({
          jwtRole: "authenticated",
          authUid: "o",
          appRole: "office",
        }),
      }).allowed,
    ).toBe(false);
    expect(
      resolveAccountingActorId({
        identity: classifyRequestIdentity({ jwtRole: "anon", authUid: null }),
        claimed: "spoof",
      }).ok,
    ).toBe(false);
    expect(sql172).toContain("opening_balance_compute_package");
    expect(sql172).toContain("v_internal");
    expect(expectedExecuteGrantAfter0172("finalize_opening_balances_safe")).toBe(
      "authenticated+service_role",
    );
  });

  it("status labels + audit keys remain", () => {
    expect(openingStatusLabel("validated")).toBe("Ready to finalize");
    expect(AUDIT_IDEMPOTENCY_PATTERNS.openingBatchPost("b1")).toBe(
      "audit:opening_batch_post:b1",
    );
    expect(FINANCIAL_AUDIT_ACTION_LABELS.opening_balance_posted).toBeTruthy();
  });
});

describe("F6-P2B statements + aging still hold without auto-plug", () => {
  const openingLines = (() => {
    const built = buildOpeningJournalLines({
      lines: [
        { accountId: IDS.cash, signedAmount: 5000 },
        { accountId: IDS.inv, signedAmount: 1000 },
        { accountId: IDS.loan, signedAmount: -2000 },
        { accountId: IDS.obe, signedAmount: -4000 },
      ],
      arTotal: 1500,
      apTotal: 1500,
      mappings,
    });
    if (!built.ok) throw new Error(built.error);
    return built.lines.map((l) => ({
      accountId: l.accountId,
      debit: l.debit,
      credit: l.credit,
      entryDate: "2026-01-01",
      entryStatus: "posted" as const,
    }));
  })();

  it("TB/BS include opening; P&L not inflated", () => {
    const tb = buildTrialBalance({
      accounts: glAccounts,
      lines: openingLines,
      asOfDate: "2026-01-31",
    });
    expect(tb.balanced).toBe(true);
    const pnl = buildAccountingPnL({
      accounts: glAccounts,
      lines: openingLines,
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });
    expect(pnl.netIncome).toBe(0);
    const bs = buildBalanceSheet({
      accounts: glAccounts,
      lines: openingLines,
      asOfDate: "2026-01-31",
      netIncomeToDate: 0,
    });
    expect(bs.balanced).toBe(true);
  });

  it("aging merges opening AR/AP", () => {
    const ar = buildArAging({
      asOfDate: "2026-02-01",
      invoices: mergeArAgingInvoices({
        invoices: [],
        openingArItems: [
          {
            id: "oar-1",
            amount: 1500,
            due_date: "2025-12-15",
            as_of_date: "2026-01-01",
            legacy_invoice_number: "LEG-9",
            status: "active",
          },
        ],
      }),
    });
    expect(ar.total).toBe(1500);
    const ap = buildApAging({
      asOfDate: "2026-02-01",
      bills: mergeApAgingBills({
        bills: [],
        openingApItems: [
          {
            id: "oap-1",
            amount: 500,
            due_date: "2025-12-20",
            bill_date: "2025-12-01",
            as_of_date: "2026-01-01",
            legacy_bill_number: "VB-LEG",
            status: "active",
          },
        ],
      }),
    });
    expect(ap.total).toBe(500);
  });
});
