import { createClient } from "@/lib/supabase/server";
import { getAccountMappings, listGlAccounts } from "@/lib/data/accounting";
import {
  computeReconciliationPackage,
  isEligibleBankReconAccount,
  suggestBankMatches,
  type BankImportLineView,
  type BankMatchView,
  type JournalBankLineView,
} from "@/lib/accounting/bank-reconciliation";

export async function listBankReconciliationSessions() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bank_reconciliation_sessions")
    .select(
      "id, account_id, statement_start, statement_end, opening_balance, ending_balance, status, import_batch_id, created_at, completed_at, difference",
    )
    .order("statement_end", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getBankReconciliationSession(sessionId: string) {
  const supabase = await createClient();
  const { data: session, error } = await supabase
    .from("bank_reconciliation_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!session) return null;

  const batchId = session.import_batch_id as string | null;
  let importLines: Record<string, unknown>[] = [];
  let importBatch = null;
  if (batchId) {
    const [{ data: batch }, { data: lines }] = await Promise.all([
      supabase.from("bank_statement_import_batches").select("*").eq("id", batchId).maybeSingle(),
      supabase
        .from("bank_statement_import_lines")
        .select("*")
        .eq("batch_id", batchId)
        .order("source_row_no"),
    ]);
    importBatch = batch;
    importLines = lines ?? [];
  }

  const accountId = session.account_id as string;

  const { data: matches } = await supabase
    .from("bank_reconciliation_matches")
    .select(
      "*, session:bank_reconciliation_sessions!inner(id, account_id, status)",
    )
    .eq("session.account_id", accountId);

  const { data: journalRows } = await supabase
    .from("journal_lines")
    .select(
      "id, account_id, debit, credit, memo, journal_entry:journal_entries!inner(entry_date, status)",
    )
    .eq("account_id", accountId);

  const journalLines: JournalBankLineView[] = [];
  let glBalanceThroughEnd = 0;
  for (const row of journalRows ?? []) {
    const je = row.journal_entry as unknown as {
      entry_date: string;
      status: string;
    };
    if (je.status !== "posted") continue;
    if (je.entry_date > (session.statement_end as string)) continue;
    const debit = Number(row.debit) || 0;
    const credit = Number(row.credit) || 0;
    glBalanceThroughEnd += debit - credit;
    // Include pre-period uncleared items for outstanding; UI still shows them.
    journalLines.push({
      journalLineId: row.id as string,
      entryDate: je.entry_date,
      debit,
      credit,
      memo: row.memo as string | null,
      matchedAmount: 0,
    });
  }
  glBalanceThroughEnd = Math.round(glBalanceThroughEnd * 100) / 100;

  const matchViews: BankMatchView[] = (matches ?? []).map((m) => {
    const sess = m.session as { id: string; status: string };
    return {
      id: m.id as string,
      importLineId: m.import_line_id as string,
      journalLineId: m.journal_line_id as string,
      allocatedAmount: Number(m.allocated_amount) || 0,
      status: m.status as string,
      sessionId: sess.id,
      sessionStatus: sess.status,
    };
  });

  const currentSessionMatches = matchViews.filter((m) => m.sessionId === sessionId);

  const bankLines: BankImportLineView[] = importLines.map((l) => {
    const matched = currentSessionMatches
      .filter((m) => m.status === "active" && m.importLineId === l.id)
      .reduce((s, m) => s + m.allocatedAmount, 0);
    return {
      id: l.id as string,
      sourceRowNo: Number(l.source_row_no),
      transactionDate: (l.transaction_date as string | null) ?? null,
      description: (l.description as string) ?? "",
      amount: Number(l.amount) || 0,
      direction: l.direction as "deposit" | "withdrawal",
      duplicateStatus: l.duplicate_status as string,
      reviewStatus: (l.review_status as string) ?? "pending",
      matchedAmount: matched,
    };
  });

  for (const jl of journalLines) {
    jl.matchedAmount = currentSessionMatches
      .filter((m) => m.status === "active" && m.journalLineId === jl.journalLineId)
      .reduce((s, m) => s + m.allocatedAmount, 0);
  }

  const pkg = computeReconciliationPackage({
    openingBalance: Number(session.opening_balance) || 0,
    endingBalance: Number(session.ending_balance) || 0,
    bankLines,
    journalLines,
    matches: matchViews,
    glBalanceThroughEnd,
    currentSessionId: sessionId,
  });

  const suggestions = suggestBankMatches({
    bankLines,
    journalLines,
    matches: matchViews,
    currentSessionId: sessionId,
    statementEnd: session.statement_end as string,
  });

  return {
    session,
    importBatch,
    importLines,
    bankLines,
    journalLines,
    matches: currentSessionMatches,
    package: pkg,
    suggestions,
  };
}

export async function listEligibleBankAccounts() {
  const accounts = await listGlAccounts();
  const mappings = await getAccountMappings();
  const cashOperating = mappings.cash_operating;
  const undeposited = mappings.undeposited_funds;
  return accounts.filter((a) =>
    isEligibleBankReconAccount({
      accountType: a.account_type,
      subtype: a.subtype,
      isActive: a.is_active,
      mappedAsCashOperating: a.id === cashOperating,
      mappedAsUndeposited: a.id === undeposited,
    }),
  );
}
