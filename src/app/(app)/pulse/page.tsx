import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  AlertOctagon,
  Lightbulb,
  CheckCircle2,
  ArrowRight,
  Receipt,
  BarChart3,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { getBusinessPulse } from "@/lib/data/pulse";
import { buildInsights, type InsightTone } from "@/lib/insights";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Business Pulse" };

const TONE: Record<
  InsightTone,
  { icon: typeof AlertTriangle; box: string; chip: string }
> = {
  danger: {
    icon: AlertOctagon,
    box: "border-destructive/40 bg-destructive/5",
    chip: "text-destructive",
  },
  warning: {
    icon: AlertTriangle,
    box: "border-amber-500/40 bg-amber-500/5",
    chip: "text-amber-600",
  },
  opportunity: {
    icon: Lightbulb,
    box: "border-sky-500/40 bg-sky-500/5",
    chip: "text-sky-600",
  },
  good: {
    icon: CheckCircle2,
    box: "border-emerald-500/40 bg-emerald-500/5",
    chip: "text-emerald-600",
  },
};

export default async function PulsePage() {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/");

  const pulse = await getBusinessPulse();
  const insights = buildInsights(pulse);
  const target = pulse.settings.target_gross_margin_pct;

  const netUp = pulse.netDelta >= 0;

  return (
    <div>
      <PageHeader
        title="Business Pulse"
        description={`How ${pulse.monthLabel} is going — real profit, what's owed, and what to do about it.`}
      >
        <div className="flex gap-2">
          <Link
            href="/financials"
            className={buttonVariants({ variant: "outline", size: "lg" })}
          >
            <BarChart3 className="size-4" /> Full financials
          </Link>
          <Link
            href="/financials/expenses"
            className={buttonVariants({ variant: "ghost", size: "lg" })}
          >
            <Receipt className="size-4" /> Expenses
          </Link>
        </div>
      </PageHeader>

      {/* Headline numbers */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Net profit this month
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={cn(
                "text-2xl font-semibold",
                pulse.thisMonth.net < 0 && "text-destructive",
              )}
            >
              {formatMoney(pulse.thisMonth.net)}
            </div>
            <p
              className={cn(
                "mt-1 inline-flex items-center gap-1 text-xs",
                netUp ? "text-emerald-600" : "text-destructive",
              )}
            >
              {netUp ? (
                <TrendingUp className="size-3" />
              ) : (
                <TrendingDown className="size-3" />
              )}
              {formatMoney(Math.abs(pulse.netDelta))} vs last month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Cash collected
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {formatMoney(pulse.thisMonth.collected)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {pulse.goalProgressPct !== null
                ? `${Math.round(pulse.goalProgressPct)}% of ${formatMoney(
                    pulse.settings.monthly_revenue_goal,
                  )} goal`
                : "Set a monthly goal in Settings"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg job margin
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={cn(
                "text-2xl font-semibold",
                pulse.avgJobMargin < target && "text-amber-600",
              )}
            >
              {Math.round(pulse.avgJobMargin)}%
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Target {Math.round(target)}%
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Owed to you (AR)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {formatMoney(pulse.ar.total)}
            </div>
            <p
              className={cn(
                "mt-1 text-xs",
                pulse.ar.d90plus > 0
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {formatMoney(pulse.ar.d90plus)} is 90+ days overdue
            </p>
          </CardContent>
        </Card>
      </div>

      {/* What to do — ranked insights */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            What to do — ranked by dollar impact
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {insights.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing needs your attention right now. As jobs close, invoices
              age, and costs come in, suggestions will appear here.
            </p>
          ) : (
            insights.map((ins) => {
              const tone = TONE[ins.tone];
              const Icon = tone.icon;
              return (
                <div
                  key={ins.id}
                  className={cn("rounded-lg border p-3", tone.box)}
                >
                  <div className="flex items-start gap-3">
                    <Icon className={cn("mt-0.5 size-5 shrink-0", tone.chip)} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{ins.title}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {ins.detail}
                      </p>
                      {ins.href ? (
                        <Link
                          href={ins.href}
                          className="mt-2 inline-flex items-center gap-1 text-sm font-medium hover:underline"
                        >
                          {ins.cta ?? "Open"}
                          <ArrowRight className="size-3.5" />
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
