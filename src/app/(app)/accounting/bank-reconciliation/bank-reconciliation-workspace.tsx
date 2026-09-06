"use client";

import { useMemo, useState, useTransition } from "react";
import { formatMoney } from "@/lib/format";
import {
  bankReconStatusLabel,
  isBankReconEditable,
  mapCsvRowsToImportPayload,
  parseCsvPreview,
  type MatchSuggestion,
  type ReconciliationPackage,
} from "@/lib/accounting/bank-reconciliation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  attachImportToSessionAction,
  createBankMatchAction,
  finalizeBankReconciliationAction,
  removeBankMatchAction,
  resolveDuplicateAction,
  stageBankImportAction,
  voidBankReconciliationAction,
} from "./actions";

type BankLine = {
  id: string;
  sourceRowNo: number;
  transactionDate: string | null;
  description: string;
  amount: number;
  direction: string;
  duplicateStatus: string;
  reviewStatus: string;
  matchedAmount: number;
};

type JournalLine = {
  journalLineId: string;
  entryDate: string;
  debit: number;
  credit: number;
  memo?: string | null;
  matchedAmount: number;
};

type MatchRow = {
  id: string;
  importLineId: string;
  journalLineId: string;
  allocatedAmount: number;
  status: string;
};

export function BankReconciliationWorkspace(props: {
  sessionId: string;
  accountId: string;
  accountLabel: string;
  status: string;
  statementStart: string;
  statementEnd: string;
  openingBalance: number;
  endingBalance: number;
  importBatch: Record<string, unknown> | null;
  bankLines: BankLine[];
  journalLines: JournalLine[];
  matches: MatchRow[];
  package: ReconciliationPackage;
  suggestions: MatchSuggestion[];
  isAdmin: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const editable = isBankReconEditable(props.status);

  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const preview = useMemo(
    () => (csvText ? parseCsvPreview(csvText) : { headers: [], rows: [] }),
    [csvText],
  );
  const [mapping, setMapping] = useState({
    date: "",
    description: "",
    amount: "",
    debit: "",
    credit: "",
    reference: "",
  });

  const unmatchedBank = props.bankLines.filter(
    (l) =>
      l.duplicateStatus !== "rejected" &&
      l.reviewStatus !== "excluded" &&
      l.matchedAmount < l.amount - 0.004,
  );
  const outstandingBook = props.journalLines.filter(
    (l) => l.matchedAmount < Math.max(l.debit, l.credit) - 0.004,
  );

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setCsvText(text);
      const p = parseCsvPreview(text);
      const guess = (names: string[]) =>
        p.headers.find((h) => names.some((n) => h.toLowerCase().includes(n))) ?? "";
      setMapping({
        date: guess(["date", "posted"]),
        description: guess(["description", "memo", "payee"]),
        amount: guess(["amount", "net"]),
        debit: guess(["debit", "withdrawal"]),
        credit: guess(["credit", "deposit"]),
        reference: guess(["ref", "check", "number"]),
      });
    };
    reader.readAsText(file);
  }

  function run(action: () => Promise<{ error?: string; ok?: boolean }>) {
    setError(null);
    start(async () => {
      const res = await action();
      if (res.error) setError(res.error);
      else window.location.reload();
    });
  }

  return (
    <div className="space-y-6">
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{props.accountLabel}</h2>
            <p className="text-sm text-muted-foreground">
              {props.statementStart} → {props.statementEnd} ·{" "}
              {bankReconStatusLabel(props.status)}
            </p>
          </div>
          <div className="text-right text-sm">
            <p>Opening: {formatMoney(props.openingBalance)}</p>
            <p>Statement ending: {formatMoney(props.endingBalance)}</p>
            <p className={props.package.canFinalize ? "text-green-700" : "text-amber-700"}>
              Book vs adjusted bank:{" "}
              {formatMoney(props.package.bookVsAdjustedDifference)}
            </p>
          </div>
        </div>
        {error ? (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 space-y-2">
          <h3 className="font-medium">Statement math</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Beginning balance</dt>
            <dd>{formatMoney(props.package.openingBalance)}</dd>
            <dt className="text-muted-foreground">Statement deposits</dt>
            <dd>{formatMoney(props.package.bankDeposits)}</dd>
            <dt className="text-muted-foreground">Statement withdrawals</dt>
            <dd>{formatMoney(props.package.bankWithdrawals)}</dd>
            <dt className="text-muted-foreground">Calculated ending</dt>
            <dd>{formatMoney(props.package.statementCalculatedEnding)}</dd>
            <dt className="text-muted-foreground">Statement ending</dt>
            <dd>{formatMoney(props.package.endingBalance)}</dd>
            <dt className="text-muted-foreground">Statement equation difference</dt>
            <dd
              className={
                Math.abs(props.package.statementEquationDifference) > 0.005
                  ? "text-amber-700"
                  : undefined
              }
            >
              {formatMoney(props.package.statementEquationDifference)}
            </dd>
          </dl>
        </Card>

        <Card className="p-4 space-y-2">
          <h3 className="font-medium">Book / bank reconciliation</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">GL / book balance</dt>
            <dd>{formatMoney(props.package.glBalanceThroughEnd)}</dd>
            <dt className="text-muted-foreground">Matched inflows (allocations)</dt>
            <dd>{formatMoney(props.package.matchedDebit)}</dd>
            <dt className="text-muted-foreground">Matched outflows (allocations)</dt>
            <dd>{formatMoney(props.package.matchedCredit)}</dd>
            <dt className="text-muted-foreground">Remaining unmatched bank</dt>
            <dd>
              {formatMoney(
                props.package.remainingBankDeposits +
                  props.package.remainingBankWithdrawals,
              )}
            </dd>
            <dt className="text-muted-foreground">Outstanding deposits (book)</dt>
            <dd>{formatMoney(props.package.outstandingBookDebit)}</dd>
            <dt className="text-muted-foreground">Outstanding checks (book)</dt>
            <dd>{formatMoney(props.package.outstandingBookCredit)}</dd>
            <dt className="text-muted-foreground">Adjusted bank balance</dt>
            <dd>{formatMoney(props.package.adjustedBankBalance)}</dd>
            <dt className="text-muted-foreground">Book vs adjusted difference</dt>
            <dd
              className={
                Math.abs(props.package.bookVsAdjustedDifference) > 0.005
                  ? "text-amber-700"
                  : "text-green-700"
              }
            >
              {formatMoney(props.package.bookVsAdjustedDifference)}
            </dd>
            <dt className="text-muted-foreground">Unresolved duplicates</dt>
            <dd>{props.package.unresolvedPossibleDuplicates}</dd>
            <dt className="text-muted-foreground">Unresolved rejected rows</dt>
            <dd>{props.package.unresolvedRejected}</dd>
          </dl>
        </Card>

        <Card className="p-4 space-y-2 lg:col-span-2">
          <h3 className="font-medium">Import batch</h3>
          {props.importBatch ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
              <dt className="text-muted-foreground">File</dt>
              <dd className="sm:col-span-2">{String(props.importBatch.file_name ?? "—")}</dd>
              <dt className="text-muted-foreground">Staged rows</dt>
              <dd>{String(props.importBatch.staged_row_count ?? 0)}</dd>
              <dt className="text-muted-foreground">Rejected</dt>
              <dd>{String(props.importBatch.rejected_row_count ?? 0)}</dd>
              <dt className="text-muted-foreground">Exact reimports (evidence only)</dt>
              <dd>{String(props.importBatch.exact_reimport_count ?? 0)}</dd>
              <dt className="text-muted-foreground">Possible duplicates</dt>
              <dd>{String(props.importBatch.possible_duplicate_count ?? 0)}</dd>
            </dl>
          ) : editable ? (
            <p className="text-sm text-muted-foreground">Upload a CSV to stage bank activity.</p>
          ) : (
            <p className="text-sm text-muted-foreground">No import attached.</p>
          )}
        </Card>
      </div>

      {editable && !props.importBatch ? (
        <Card className="p-4 space-y-4">
          <h3 className="font-medium">Upload bank statement CSV</h3>
          <Input type="file" accept=".csv,text/csv" onChange={onFile} />
          {preview.headers.length > 0 ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {(["date", "description", "amount", "debit", "credit", "reference"] as const).map(
                  (key) => (
                    <div key={key} className="space-y-1">
                      <Label>{key}</Label>
                      <select
                        className="w-full rounded-md border px-2 py-1.5 text-sm"
                        value={mapping[key]}
                        onChange={(e) =>
                          setMapping((m) => ({ ...m, [key]: e.target.value }))
                        }
                      >
                        <option value="">—</option>
                        {preview.headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>
                  ),
                )}
              </div>
              <div className="overflow-x-auto text-xs">
                <table className="min-w-full border-collapse">
                  <thead>
                    <tr>
                      {preview.headers.map((h) => (
                        <th key={h} className="border px-2 py-1 text-left">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) => (
                          <td key={j} className="border px-2 py-1">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const mapped = mapCsvRowsToImportPayload({
                      headers: preview.headers,
                      rows: csvText
                        .split(/\r?\n/)
                        .slice(1)
                        .filter((l) => l.trim())
                        .map((l) => l.split(",").map((c) => c.trim())),
                      mapping,
                    });
                    if (!mapped.ok) return { error: mapped.error };
                    const importFd = new FormData();
                    importFd.set("account_id", props.accountId);
                    importFd.set("file_name", fileName || "import.csv");
                    importFd.set("rows_json", JSON.stringify(mapped.rows));
                    const staged = await stageBankImportAction(importFd);
                    if ("error" in staged && staged.error) return { error: staged.error };
                    if (!("batch_id" in staged) || !staged.batch_id) {
                      return { error: "Import did not return a batch id." };
                    }
                    const fd = new FormData();
                    fd.set("session_id", props.sessionId);
                    fd.set("batch_id", String(staged.batch_id));
                    return attachImportToSessionAction(fd);
                  })
                }
              >
                {pending ? "Importing…" : "Preview import & attach"}
              </Button>
            </>
          ) : null}
        </Card>
      ) : null}

      {editable && props.suggestions.length > 0 ? (
        <Card className="p-4 space-y-3">
          <h3 className="font-medium">Suggested matches</h3>
          <ul className="space-y-2 text-sm">
            {props.suggestions.slice(0, 12).map((s) => {
              const bank = props.bankLines.find((b) => b.id === s.importLineId);
              const jl = props.journalLines.find((j) => j.journalLineId === s.journalLineId);
              return (
                <li
                  key={`${s.importLineId}:${s.journalLineId}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2"
                >
                  <span>
                    Bank #{bank?.sourceRowNo} {formatMoney(s.allocatedAmount)} ↔ Book{" "}
                    {jl?.entryDate} {formatMoney(Math.max(jl?.debit ?? 0, jl?.credit ?? 0))}
                    <span className="text-muted-foreground"> ({s.reasons.join(", ")})</span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      const fd = new FormData();
                      fd.set("session_id", props.sessionId);
                      fd.set("import_line_id", s.importLineId);
                      fd.set("journal_line_id", s.journalLineId);
                      fd.set("allocated_amount", String(s.allocatedAmount));
                      run(() => createBankMatchAction(fd));
                    }}
                  >
                    Accept match
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-4 space-y-2">
          <h3 className="font-medium">Bank statement lines</h3>
          <div className="max-h-96 overflow-y-auto text-sm">
            <table className="min-w-full">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1">#</th>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {props.bankLines.map((l) => (
                  <tr key={l.id} className="border-t">
                    <td className="py-1">{l.sourceRowNo}</td>
                    <td>{l.transactionDate ?? "—"}</td>
                    <td className="max-w-[12rem] truncate">{l.description}</td>
                    <td>
                      {l.direction === "withdrawal" ? "−" : "+"}
                      {formatMoney(l.amount)}
                    </td>
                    <td>
                      {l.duplicateStatus}
                      {l.duplicateStatus === "possible_duplicate" &&
                      l.reviewStatus === "pending" &&
                      editable ? (
                        <span className="ml-2 inline-flex gap-1">
                          <button
                            type="button"
                            className="text-xs underline"
                            onClick={() => {
                              const fd = new FormData();
                              fd.set("session_id", props.sessionId);
                              fd.set("import_line_id", l.id);
                              fd.set("resolution", "accepted");
                              run(() => resolveDuplicateAction(fd));
                            }}
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            className="text-xs underline"
                            onClick={() => {
                              const fd = new FormData();
                              fd.set("session_id", props.sessionId);
                              fd.set("import_line_id", l.id);
                              fd.set("resolution", "excluded");
                              fd.set("reason", "Excluded as duplicate");
                              run(() => resolveDuplicateAction(fd));
                            }}
                          >
                            Exclude
                          </button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {unmatchedBank.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {unmatchedBank.length} unmatched bank line(s) — deposits in transit or missing book entries.
            </p>
          ) : null}
        </Card>

        <Card className="p-4 space-y-2">
          <h3 className="font-medium">Book activity (posted GL)</h3>
          <div className="max-h-96 overflow-y-auto text-sm">
            <table className="min-w-full">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1">Date</th>
                  <th>Memo</th>
                  <th>Debit</th>
                  <th>Credit</th>
                </tr>
              </thead>
              <tbody>
                {props.journalLines.map((l) => (
                  <tr key={l.journalLineId} className="border-t">
                    <td className="py-1">{l.entryDate}</td>
                    <td className="max-w-[12rem] truncate">{l.memo ?? "—"}</td>
                    <td>{l.debit > 0 ? formatMoney(l.debit) : "—"}</td>
                    <td>{l.credit > 0 ? formatMoney(l.credit) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {outstandingBook.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {outstandingBook.length} outstanding book line(s) — checks not yet cleared or unmatched.
            </p>
          ) : null}
          {props.journalLines.length === 0 ? (
            <p className="text-xs text-amber-700">
              No posted journal activity in this period. Matching will be available once accounting posts exist.
              Reconciliation cannot reach $0 without matching book activity or adjusting entries through the proper journal workflow.
            </p>
          ) : null}
        </Card>
      </div>

      {props.matches.filter((m) => m.status === "active").length > 0 ? (
        <Card className="p-4 space-y-2">
          <h3 className="font-medium">Active matches</h3>
          <ul className="space-y-1 text-sm">
            {props.matches
              .filter((m) => m.status === "active")
              .map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2">
                  <span>
                    Bank line → Journal {m.journalLineId.slice(0, 8)}… (
                    {formatMoney(m.allocatedAmount)})
                  </span>
                  {editable ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => {
                        const fd = new FormData();
                        fd.set("session_id", props.sessionId);
                        fd.set("match_id", m.id);
                        fd.set("reason", "Removed by user");
                        run(() => removeBankMatchAction(fd));
                      }}
                    >
                      Remove
                    </Button>
                  ) : null}
                </li>
              ))}
          </ul>
        </Card>
      ) : null}

      <Card className="p-4 flex flex-wrap items-center gap-3">
        {editable ? (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" id="finalize_confirm" name="confirm" />
              I confirm this reconciliation is complete and balanced
            </label>
            <Button
              disabled={pending || !props.package.canFinalize}
              onClick={() => {
                const confirmed = (
                  document.getElementById("finalize_confirm") as HTMLInputElement | null
                )?.checked;
                if (!confirmed) {
                  setError("Check the confirmation box before finalizing.");
                  return;
                }
                const fd = new FormData();
                fd.set("session_id", props.sessionId);
                fd.set("confirm", "true");
                run(() => finalizeBankReconciliationAction(fd));
              }}
            >
              {pending ? "Finalizing…" : "Finalize reconciliation"}
            </Button>
          </>
        ) : null}
        {!editable && props.isAdmin && props.status !== "void" ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              fd.set("session_id", props.sessionId);
              run(() => voidBankReconciliationAction(fd));
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="void_reason">Void reason</Label>
              <Input id="void_reason" name="void_reason" required className="min-w-[16rem]" />
            </div>
            <Button type="submit" variant="destructive" disabled={pending}>
              Void reconciliation
            </Button>
          </form>
        ) : null}
        {!props.package.canFinalize && editable ? (
          <p className="w-full text-sm text-muted-foreground">
            Finalize stays blocked until statement math foots, remaining unmatched bank
            amounts are $0, book vs adjusted bank is $0, and all possible duplicates /
            rejected rows are resolved. Server re-checks under lock.
          </p>
        ) : null}
      </Card>
    </div>
  );
}
