"use client";

import { useMemo, useState, useTransition } from "react";
import {
  classifyOpeningAccount,
  imbalanceWarning,
  OPENING_BS_GROUP_LABELS,
  OPENING_EQUITY_HELP,
  type OpeningApItemDraft,
  type OpeningArItemDraft,
  type OpeningBsGroup,
  type OpeningGlLineDraft,
  validateOpeningBatchDraft,
} from "@/lib/accounting/opening-balances";
import type { AccountMappingDict } from "@/lib/accounting/types";
import {
  createOpeningBalanceBatchAction,
  finalizeOpeningBalancesAction,
  saveOpeningBalanceDraftAction,
  validateOpeningBalanceBatchAction,
  voidOpeningBalanceBatchAction,
} from "./actions";

type Account = {
  id: string;
  code: string;
  name: string;
  account_type: string;
  subtype: string | null;
  is_active: boolean;
};

type Customer = { id: string; full_name: string };
type Vendor = { id: string; name: string };

type Props = {
  batch: {
    id: string;
    as_of_date: string;
    status: string;
    description: string;
  } | null;
  initialLines: OpeningGlLineDraft[];
  initialAr: OpeningArItemDraft[];
  initialAp: OpeningApItemDraft[];
  accounts: Account[];
  customers: Customer[];
  vendors: Vendor[];
  mappings: AccountMappingDict;
  isAdmin: boolean;
};

const STEPS = [
  "Date",
  "Balance sheet",
  "AR customers",
  "AP vendors",
  "Review",
] as const;

export function OpeningBalanceWizard(props: Props) {
  const [step, setStep] = useState(0);
  const [batchId, setBatchId] = useState(props.batch?.id ?? "");
  const [asOfDate, setAsOfDate] = useState(props.batch?.as_of_date ?? "");
  const [description, setDescription] = useState(
    props.batch?.description ?? "Opening balances",
  );
  const [status, setStatus] = useState(props.batch?.status ?? "none");
  const [lines, setLines] = useState<OpeningGlLineDraft[]>(props.initialLines);
  const [arItems, setArItems] = useState<OpeningArItemDraft[]>(props.initialAr);
  const [apItems, setApItems] = useState<OpeningApItemDraft[]>(props.initialAp);
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();

  const grouped = useMemo(() => {
    const map = new Map<OpeningBsGroup, Account[]>();
    for (const a of props.accounts.filter((x) => x.is_active)) {
      const g = classifyOpeningAccount({
        accountType: a.account_type,
        subtype: a.subtype,
      });
      if (g === "excluded" || g === "receivable" || g === "payable") continue;
      const list = map.get(g) ?? [];
      list.push(a);
      map.set(g, list);
    }
    return map;
  }, [props.accounts]);

  const preview = useMemo(
    () =>
      validateOpeningBatchDraft({
        asOfDate,
        lines,
        arItems,
        apItems,
        accounts: props.accounts.map((a) => ({
          id: a.id,
          accountType: a.account_type,
          subtype: a.subtype,
          isActive: a.is_active,
        })),
        mappings: props.mappings,
      }),
    [asOfDate, lines, arItems, apItems, props.accounts, props.mappings],
  );

  function amountFor(accountId: string) {
    return lines.find((l) => l.accountId === accountId)?.signedAmount ?? 0;
  }

  function setAmount(accountId: string, signed: number) {
    setLines((prev) => {
      const rest = prev.filter((l) => l.accountId !== accountId);
      if (!signed) return rest;
      return [...rest, { accountId, signedAmount: signed }];
    });
  }

  function run(fn: () => Promise<{ error?: string; ok?: boolean; batchId?: string }>) {
    startTransition(async () => {
      setMessage(null);
      const res = await fn();
      if (res.error) {
        setMessage(res.error);
        return;
      }
      if (res.batchId) setBatchId(res.batchId);
      setMessage("Saved.");
    });
  }

  if (!props.isAdmin) {
    return (
      <p className="text-sm text-muted-foreground">
        Only admins can edit opening balances. Office users can review status on
        the Accounting page.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap gap-2 text-sm">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            className={`rounded-md border px-3 py-1 ${
              i === step ? "bg-foreground text-background" : ""
            }`}
            onClick={() => setStep(i)}
          >
            {i + 1}. {label}
          </button>
        ))}
      </nav>

      <p className="text-xs text-muted-foreground">
        Status: <strong>{status}</strong>
        {batchId ? ` · Batch ${batchId.slice(0, 8)}` : ""}
      </p>
      {message ? <p className="text-sm text-amber-800">{message}</p> : null}

      {step === 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Opening balance date</h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Enter the balances from your prior accounting system as of the end of
            this date. Floor King CRM will begin with these starting balances.
            This is not the accounting cutover date and does not turn accounting
            on.
          </p>
          <label className="block text-sm">
            As-of date
            <input
              type="date"
              className="mt-1 block w-full max-w-xs rounded-md border px-3 py-2"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Description
            <input
              className="mt-1 block w-full max-w-lg rounded-md border px-3 py-2"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={pending || !asOfDate}
            className="rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50"
            onClick={() =>
              run(async () => {
                if (!batchId) {
                  const fd = new FormData();
                  fd.set("as_of_date", asOfDate);
                  fd.set("description", description);
                  const created = await createOpeningBalanceBatchAction(fd);
                  if (created.error || !created.batchId) {
                    return { error: created.error ?? "Create failed" };
                  }
                  setBatchId(created.batchId);
                  setStatus("draft");
                  setStep(1);
                  return { ok: true, batchId: created.batchId };
                }
                setStep(1);
                return { ok: true };
              })
            }
          >
            Continue
          </button>
        </section>
      ) : null}

      {step === 1 ? (
        <section className="space-y-4">
          <h2 className="text-lg font-medium">Balance sheet accounts</h2>
          <p className="text-sm text-muted-foreground">
            Enter one signed amount per account. Positive = debit, negative =
            credit. AR and AP are entered on the next steps from customers and
            vendors — not as anonymous totals.
          </p>
          <p className="text-sm text-muted-foreground max-w-2xl">
            {OPENING_EQUITY_HELP} The system will not invent this amount for you.
          </p>
          {[...grouped.entries()].map(([group, accts]) => (
            <div key={group} className="space-y-2">
              <h3 className="font-medium">{OPENING_BS_GROUP_LABELS[group]}</h3>
              <ul className="space-y-2">
                {accts.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center gap-3 text-sm"
                  >
                    <span className="w-48 shrink-0">
                      {a.code} · {a.name}
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      className="w-36 rounded-md border px-2 py-1"
                      value={amountFor(a.id) || ""}
                      onChange={(e) =>
                        setAmount(a.id, Number(e.target.value) || 0)
                      }
                      placeholder="0.00"
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <button
            type="button"
            className="rounded-md border px-4 py-2 text-sm"
            onClick={() => setStep(2)}
          >
            Continue to AR
          </button>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Opening accounts receivable</h2>
          <p className="text-sm text-muted-foreground">
            List who owes Floor King as of the opening date. These are opening
            items — not new commercial invoices.
          </p>
          {arItems.map((item, idx) => (
            <div key={idx} className="flex flex-wrap gap-2 text-sm">
              <select
                className="rounded-md border px-2 py-1"
                value={item.customerId}
                onChange={(e) => {
                  const next = [...arItems];
                  next[idx] = { ...item, customerId: e.target.value };
                  setArItems(next);
                }}
              >
                <option value="">Customer…</option>
                {props.customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                step="0.01"
                className="w-28 rounded-md border px-2 py-1"
                value={item.amount || ""}
                onChange={(e) => {
                  const next = [...arItems];
                  next[idx] = { ...item, amount: Number(e.target.value) || 0 };
                  setArItems(next);
                }}
                placeholder="Amount"
              />
              <input
                type="date"
                className="rounded-md border px-2 py-1"
                value={item.dueDate ?? ""}
                onChange={(e) => {
                  const next = [...arItems];
                  next[idx] = { ...item, dueDate: e.target.value };
                  setArItems(next);
                }}
              />
              <input
                className="rounded-md border px-2 py-1"
                value={item.legacyInvoiceNumber ?? ""}
                onChange={(e) => {
                  const next = [...arItems];
                  next[idx] = {
                    ...item,
                    legacyInvoiceNumber: e.target.value,
                  };
                  setArItems(next);
                }}
                placeholder="Legacy invoice #"
              />
              <button
                type="button"
                className="underline"
                onClick={() => setArItems(arItems.filter((_, i) => i !== idx))}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-sm underline"
            onClick={() =>
              setArItems([
                ...arItems,
                { customerId: "", amount: 0, dueDate: asOfDate },
              ])
            }
          >
            Add customer balance
          </button>
          <div>
            <button
              type="button"
              className="rounded-md border px-4 py-2 text-sm"
              onClick={() => setStep(3)}
            >
              Continue to AP
            </button>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Opening accounts payable</h2>
          <p className="text-sm text-muted-foreground">
            List vendors Floor King owes as of the opening date. These are
            opening items — not new purchase bills.
          </p>
          {apItems.map((item, idx) => (
            <div key={idx} className="flex flex-wrap gap-2 text-sm">
              <select
                className="rounded-md border px-2 py-1"
                value={item.vendorId}
                onChange={(e) => {
                  const next = [...apItems];
                  next[idx] = { ...item, vendorId: e.target.value };
                  setApItems(next);
                }}
              >
                <option value="">Vendor…</option>
                {props.vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                step="0.01"
                className="w-28 rounded-md border px-2 py-1"
                value={item.amount || ""}
                onChange={(e) => {
                  const next = [...apItems];
                  next[idx] = { ...item, amount: Number(e.target.value) || 0 };
                  setApItems(next);
                }}
                placeholder="Amount"
              />
              <input
                type="date"
                className="rounded-md border px-2 py-1"
                value={item.dueDate ?? ""}
                onChange={(e) => {
                  const next = [...apItems];
                  next[idx] = { ...item, dueDate: e.target.value };
                  setApItems(next);
                }}
              />
              <input
                className="rounded-md border px-2 py-1"
                value={item.legacyBillNumber ?? ""}
                onChange={(e) => {
                  const next = [...apItems];
                  next[idx] = { ...item, legacyBillNumber: e.target.value };
                  setApItems(next);
                }}
                placeholder="Legacy bill #"
              />
              <button
                type="button"
                className="underline"
                onClick={() => setApItems(apItems.filter((_, i) => i !== idx))}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-sm underline"
            onClick={() =>
              setApItems([
                ...apItems,
                { vendorId: "", amount: 0, dueDate: asOfDate, billDate: asOfDate },
              ])
            }
          >
            Add vendor balance
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md border px-4 py-2 text-sm"
              disabled={pending || !batchId}
              onClick={() =>
                run(async () => {
                  const fd = new FormData();
                  fd.set("batch_id", batchId);
                  fd.set("as_of_date", asOfDate);
                  fd.set("description", description);
                  fd.set(
                    "lines_json",
                    JSON.stringify(
                      lines.map((l) => ({
                        accountId: l.accountId,
                        signedAmount: l.signedAmount,
                        note: l.note ?? null,
                      })),
                    ),
                  );
                  fd.set(
                    "ar_json",
                    JSON.stringify(
                      arItems.map((i) => ({
                        customerId: i.customerId,
                        amount: i.amount,
                        dueDate: i.dueDate ?? null,
                        legacyInvoiceNumber: i.legacyInvoiceNumber ?? null,
                        reference: i.reference ?? null,
                        jobId: i.jobId ?? null,
                        note: i.note ?? null,
                      })),
                    ),
                  );
                  fd.set(
                    "ap_json",
                    JSON.stringify(
                      apItems.map((i) => ({
                        vendorId: i.vendorId,
                        amount: i.amount,
                        billDate: i.billDate ?? null,
                        dueDate: i.dueDate ?? null,
                        legacyBillNumber: i.legacyBillNumber ?? null,
                        reference: i.reference ?? null,
                        note: i.note ?? null,
                      })),
                    ),
                  );
                  const saved = await saveOpeningBalanceDraftAction(fd);
                  if (saved.error) return saved;
                  setStatus("draft");
                  setStep(4);
                  return { ok: true };
                })
              }
            >
              Save draft & review
            </button>
          </div>
        </section>
      ) : null}

      {step === 4 ? (
        <section className="space-y-4">
          <h2 className="text-lg font-medium">Review & finalize</h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            These balances establish the starting point for Floor King CRM
            accounting. They do not turn accounting on or make Floor King CRM
            the official books.
          </p>
          {!preview.ok ? (
            <div className="space-y-2">
              {preview.preview &&
              Math.abs(preview.preview.difference) > 0.005 ? (
                <p className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-800">
                  {imbalanceWarning(preview.preview.difference)}
                </p>
              ) : null}
              {preview.preview ? (
                <dl className="grid max-w-md gap-1 text-sm">
                  <div className="flex justify-between">
                    <dt>Total debits</dt>
                    <dd>${preview.preview.totalDebits.toFixed(2)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Total credits</dt>
                    <dd>${preview.preview.totalCredits.toFixed(2)}</dd>
                  </div>
                  <div className="flex justify-between font-medium text-red-800">
                    <dt>Difference</dt>
                    <dd>${preview.preview.difference.toFixed(2)}</dd>
                  </div>
                </dl>
              ) : null}
              <ul className="list-disc pl-5 text-sm text-red-700">
                {preview.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          ) : (
            <dl className="grid max-w-md gap-1 text-sm">
              <div className="flex justify-between">
                <dt>As of</dt>
                <dd>{asOfDate}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Total debits</dt>
                <dd>${preview.preview.totalDebits.toFixed(2)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Total credits</dt>
                <dd>${preview.preview.totalCredits.toFixed(2)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Difference</dt>
                <dd>$0.00</dd>
              </div>
              <div className="flex justify-between">
                <dt>AR customers</dt>
                <dd>{arItems.length}</dd>
              </div>
              <div className="flex justify-between">
                <dt>AP vendors</dt>
                <dd>{apItems.length}</dd>
              </div>
            </dl>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || !batchId || !preview.ok}
              className="rounded-md border px-4 py-2 text-sm disabled:opacity-50"
              onClick={() =>
                run(async () => {
                  const fd = new FormData();
                  fd.set("batch_id", batchId);
                  const res = await validateOpeningBalanceBatchAction(fd);
                  if (res.error) return res;
                  setStatus("validated");
                  return { ok: true };
                })
              }
            >
              Validate
            </button>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirm}
                onChange={(e) => setConfirm(e.target.checked)}
                disabled={!preview.ok || status === "draft"}
              />
              I understand this posts the opening journal and marks opening
              balances entered. Validate first — drafts cannot finalize.
            </label>
            <button
              type="button"
              disabled={
                pending ||
                !batchId ||
                !confirm ||
                !preview.ok ||
                status !== "validated"
              }
              className="rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50"
              onClick={() =>
                run(async () => {
                  const fd = new FormData();
                  fd.set("batch_id", batchId);
                  fd.set("confirm", "true");
                  const res = await finalizeOpeningBalancesAction(fd);
                  if (res.error) return res;
                  setStatus("posted");
                  return { ok: true };
                })
              }
            >
              Finalize opening balances
            </button>
          </div>

          {status === "posted" ? (
            <form
              className="space-y-2 rounded-md border p-3 text-sm"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                run(async () => {
                  const res = await voidOpeningBalanceBatchAction(fd);
                  if (res.error) return res;
                  setStatus("void");
                  setConfirm(false);
                  return { ok: true };
                });
              }}
            >
              <p className="text-muted-foreground">
                Need a correction before books-of-record? Reverse the posted
                batch (preserves journal history).
              </p>
              <input type="hidden" name="batch_id" value={batchId} />
              <input
                name="void_reason"
                required
                className="w-full max-w-md rounded-md border px-2 py-1"
                placeholder="Reason for reversal"
              />
              <button type="submit" className="underline">
                Reverse posted opening balances
              </button>
            </form>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
