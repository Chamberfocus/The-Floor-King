import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadJobTrueUp } from "@/lib/data/job-true-up-load";
import {
  TRUE_UP_STATUS_LABEL,
  formatCents,
  formatMarginHundredths,
  formatPoints,
  formatRateBps,
  trueUpAccess,
  type MoneyTrio,
} from "@/lib/job-true-up";
import { TrueUpPanel } from "./true-up-panel";

export const metadata: Metadata = { title: "Job true-up" };
export const dynamic = "force-dynamic";

export default async function JobTrueUpPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireProfile();
  const access = trueUpAccess(profile.role);
  if (!access.viewOwn && !access.viewAll) notFound();
  const { id } = await params;
  const supabase = await createClient();
  const loaded = await loadJobTrueUp(supabase, id);
  if (!loaded) notFound();

  const own =
    loaded.facts.salespersonId === profile.id ||
    loaded.snapshot?.salespersonId === profile.id;
  if (!access.viewAll && !own) notFound();

  const result = loaded.result;
  const salesmanView = profile.role === "salesman";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/jobs/${id}`} className="text-sm text-muted-foreground hover:underline">
            Back to job
          </Link>
          <h1 className="mt-1 text-2xl font-bold">Job true-up</h1>
          <p className="text-sm text-muted-foreground">
            {loaded.job.title} — {loaded.job.customerName}
          </p>
        </div>
        <div className="rounded-full border px-3 py-1 text-sm font-semibold">
          {result.status ? TRUE_UP_STATUS_LABEL[result.status] : "Not completed"}
        </div>
      </div>

      {salesmanView ? (
        <SalespersonCard
          title={`${loaded.job.title} — ${loaded.job.customerName}`}
          result={result}
          approved={!!loaded.snapshot}
        />
      ) : (
        <>
          <section className="overflow-hidden rounded-xl border">
            <table className="hidden w-full text-sm md:table">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2"> </th>
                  <th className="px-3 py-2">Estimated</th>
                  <th className="px-3 py-2">Actual</th>
                  <th className="px-3 py-2">Variance</th>
                </tr>
              </thead>
              <tbody>
                <MoneyRow label="Revenue" row={result.revenue} />
                <MoneyRow label="Material" row={result.material} />
                <MoneyRow label="Labor" row={result.labor} />
                <MoneyRow label="Freight" row={result.freight} />
                <MoneyRow label="Other direct cost" row={result.other} />
                <MoneyRow label="Total direct cost" row={result.totalDirect} />
                <MoneyRow label="Gross profit" row={result.grossProfit} />
                <tr className="border-t">
                  <td className="px-3 py-3 font-medium">Profit margin</td>
                  <td className="px-3 py-3">{formatMarginHundredths(result.marginHundredths.estimated)}</td>
                  <td className="px-3 py-3">{formatMarginHundredths(result.marginHundredths.actual)}</td>
                  <td className="px-3 py-3">{formatPoints(result.marginHundredths.variance)}</td>
                </tr>
              </tbody>
            </table>
            <div className="grid gap-3 p-3 md:hidden">
              <MoneyCard label="Revenue" row={result.revenue} />
              <MoneyCard label="Material" row={result.material} />
              <MoneyCard label="Labor" row={result.labor} />
              <MoneyCard label="Freight" row={result.freight} />
              <MoneyCard label="Other direct cost" row={result.other} />
              <MoneyCard label="Total direct cost" row={result.totalDirect} />
              <MoneyCard label="Gross profit" row={result.grossProfit} />
              <div className="rounded-lg border p-3 text-sm">
                <div className="font-medium">Profit margin</div>
                <div>Estimated {formatMarginHundredths(result.marginHundredths.estimated)}</div>
                <div>Actual {formatMarginHundredths(result.marginHundredths.actual)}</div>
                <div>Variance {formatPoints(result.marginHundredths.variance)}</div>
              </div>
            </div>
          </section>

          <section className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
            <h2 className="sm:col-span-2 text-base font-semibold">Commission</h2>
            <Field label="Salesperson" value={loaded.salespeople.find((p) => p.id === result.salespersonId)?.name ?? "Unassigned"} />
            <Field label="Actual gross profit" value={formatCents(result.commissionableGpCents)} />
            <Field label="Actual margin" value={formatMarginHundredths(result.marginHundredths.actual)} />
            <Field label="Commission tier" value={formatRateBps(result.rateBps)} />
            <Field label="Commission amount" value={formatCents(result.commissionCents)} />
            <Field label="Collection" value={result.collectionSatisfied ? "Collected" : `Open ${formatCents(loaded.facts.openBalanceCents)}`} />
            <Field label="Commission status" value={result.commissionStatus.replaceAll("_", " ")} />
            {result.calculatedCommissionCents !== result.commissionCents ? (
              <Field label="Calculated before override" value={formatCents(result.calculatedCommissionCents)} />
            ) : null}
          </section>

          <section className="rounded-xl border p-4">
            <h2 className="text-base font-semibold">Cost completeness</h2>
            <ul className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
              <Completeness label="Material" state={loaded.facts.material.resolution.state} hint={loaded.facts.material.hint} />
              <Completeness label="Labor" state={loaded.facts.labor.resolution.state} hint={loaded.facts.labor.hint} />
              <Completeness label="Freight" state={loaded.facts.freight.resolution.state} hint={loaded.facts.freight.hint} />
              <Completeness label="Other costs" state={loaded.facts.other.resolution.state} hint={loaded.facts.other.hint} />
            </ul>
          </section>

          <section className="rounded-xl border p-4">
            <h2 className="text-base font-semibold">Margin change</h2>
            <p className="mt-1 text-sm">
              Estimated {formatMarginHundredths(result.marginHundredths.estimated)} · Actual{" "}
              {formatMarginHundredths(result.marginHundredths.actual)} · Variance{" "}
              {formatPoints(result.marginHundredths.variance)}
            </p>
            <ul className="mt-2 list-disc pl-5 text-sm">
              {result.marginAnalysis.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>

          {result.flags.length ? (
            <ul className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
              {result.flags.map((flag) => (
                <li key={flag}>{flag}</li>
              ))}
            </ul>
          ) : null}

          {loaded.snapshot ? (
            <p className="text-sm text-muted-foreground">
              Approved snapshot version {loaded.snapshot.version} is kept. Later costs create an adjustment and do not rewrite it.
              Calculated commission on that snapshot: {formatCents(bigintFrom(loaded.snapshot.payload.commission_cents))}.
            </p>
          ) : null}

          {result.approveBlockers.length && !loaded.snapshot ? (
            <ul className="text-sm text-muted-foreground">
              {result.approveBlockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : null}

          <TrueUpPanel
            jobId={id}
            canEnter={access.enterCosts}
            canApprove={access.approve}
            canOverride={access.overrideCommission}
            canCollection={access.overrideCollection}
            canSalesperson={access.correctSalesperson}
            approved={!!loaded.snapshot}
            salespeople={loaded.salespeople}
          />
        </>
      )}
    </div>
  );
}

function SalespersonCard({
  title,
  result,
  approved,
}: {
  title: string;
  result: TrueUpResultLike;
  approved: boolean;
}) {
  if (!approved) {
    return (
      <p className="rounded-xl border p-4 text-sm">
        This job is not approved for commission yet. You will see the explanation after the office approves the true-up.
      </p>
    );
  }
  return (
    <section className="rounded-xl border p-4 font-mono text-sm leading-7">
      <h2 className="font-sans text-base font-semibold">{title}</h2>
      <div>Final revenue: {formatCents(result.actualRevenueCents)}</div>
      <div>Actual job cost: {formatCents(result.actualCostCents)}</div>
      <div>Actual gross profit: {formatCents(result.actualGpCents)}</div>
      <div>Actual margin: {formatMarginHundredths(result.marginHundredths.actual)}</div>
      <div>Commission tier: {formatRateBps(result.rateBps)}</div>
      <div>Commission earned: {formatCents(result.commissionCents)}</div>
      <div className="font-sans font-semibold">Status: {result.commissionStatus.replaceAll("_", " ").toUpperCase()}</div>
      {result.flags.map((flag) => (
        <div key={flag}>{flag}</div>
      ))}
    </section>
  );
}

type TrueUpResultLike = {
  actualRevenueCents: bigint | null;
  actualCostCents: bigint | null;
  actualGpCents: bigint | null;
  marginHundredths: { actual: bigint | null };
  rateBps: bigint;
  commissionCents: bigint;
  commissionStatus: string;
  flags: string[];
};

function MoneyRow({ label, row }: { label: string; row: MoneyTrio }) {
  return (
    <tr className="border-t">
      <td className="px-3 py-3 font-medium">{label}</td>
      <td className="px-3 py-3">{formatCents(row.estimatedCents)}</td>
      <td className="px-3 py-3">{row.actualCents == null ? "Missing" : formatCents(row.actualCents)}</td>
      <td className="px-3 py-3">{formatCents(row.varianceCents)}</td>
    </tr>
  );
}

function MoneyCard({ label, row }: { label: string; row: MoneyTrio }) {
  return (
    <div className="rounded-lg border p-3 text-sm">
      <div className="font-medium">{label}</div>
      <div>Estimated {formatCents(row.estimatedCents)}</div>
      <div>Actual {row.actualCents == null ? "Missing" : formatCents(row.actualCents)}</div>
      <div>Variance {formatCents(row.varianceCents)}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function Completeness({
  label,
  state,
  hint,
}: {
  label: string;
  state: string;
  hint: string | null;
}) {
  const complete = state === "auto" || state === "manual" || state === "confirmed_zero";
  return (
    <li className="rounded-lg border px-3 py-2">
      <span className="font-medium">{label}: </span>
      {complete ? `Complete (${state === "confirmed_zero" ? "$0 confirmed" : state === "manual" ? "entered" : "from records"})` : "Missing"}
      {hint ? <span className="block text-muted-foreground">{hint}</span> : null}
    </li>
  );
}

function bigintFrom(value: unknown): bigint | null {
  if (typeof value === "number" || typeof value === "string") {
    try {
      return BigInt(value);
    } catch {
      return null;
    }
  }
  return null;
}
