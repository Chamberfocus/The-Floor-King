import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronUp, ChevronDown, Pencil, Trash2, ListChecks } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { listEstimateQuestions } from "@/lib/data/estimate-questions";
import { QuestionForm } from "./question-form";
import { deleteEstimateQuestion, moveEstimateQuestion } from "./actions";

export const metadata: Metadata = { title: "Estimate questionnaire" };
export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  areas: "Areas / measurements",
  floor_map: "Product per room",
  product: "Catalog product",
  yesno: "Yes / No",
  number: "Number",
  choice: "Choice",
  text: "Text note",
  cuts: "Carpet cuts → yardage",
  stairs: "Stairs → labor + carpet",
  subfloor: "Subfloor → sheets",
  selflevel: "Self-leveler → bags",
};

/** Surface the seeded cost / allowance numbers on a question so they can be
 *  verified against real costs. Returns "" when a question carries none. */
function costSummary(q: { kind: string; config: unknown }): string {
  const c = (q.config ?? {}) as any;
  const bits: string[] = [];
  if (c.emit?.cost) bits.push(`$${c.emit.cost}/${c.emit.unit ?? "unit"} (${c.emit.role})`);
  if (Array.isArray(c.rate_options)) bits.push(...c.rate_options.map((r: any) => `${r.label} $${r.cost}`));
  if (q.kind === "stairs" && Array.isArray(c.options))
    bits.push(...c.options.map((o: any) => `${o.label}: $${o.cost}/step, ${o.carpet_sqft} sf/step`));
  else if (q.kind === "subfloor" && Array.isArray(c.options))
    bits.push(...c.options.map((o: any) => `${o.label} $${o.cost}/sheet`));
  else if (Array.isArray(c.options))
    bits.push(...c.options.filter((o: any) => o.emit?.cost).map((o: any) => `${o.label} $${o.emit.cost}`));
  if (q.kind === "selflevel") bits.push(`${c.coverage_sqft} SF/bag, $${c.bag_cost}/bag`);
  if (q.kind === "cuts") bits.push(`roll widths ${(c.widths ?? [12, 15]).join("/")}′`);
  return bits.join(" · ");
}

export default async function EstimateQuestionsSettingsPage() {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/");

  const questions = await listEstimateQuestions();
  const keyed = questions
    .filter((q) => q.key)
    .map((q) => ({ key: q.key as string, label: q.label }));
  const sections = Array.from(new Set(questions.map((q) => q.section))).sort((a, b) =>
    a.localeCompare(b),
  );

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Estimate questionnaire"
        description="The questions your guided estimate builder asks. Fully editable — add, edit, delete, or reorder. Each question maps its answer to the estimate (a material, labor, or note). Changes appear in the builder immediately."
      />
      <div className="mb-6 rounded-lg border border-amber-400 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/40 dark:bg-amber-950/30">
        <span className="font-semibold text-amber-800 dark:text-amber-300">Seeded numbers are placeholders.</span>{" "}
        <span className="text-amber-800/90 dark:text-amber-200/90">
          Rows tagged <span className="rounded bg-amber-100 px-1 font-medium text-amber-700 dark:bg-amber-500/20 dark:text-amber-400">seeded — verify</span>{" "}
          carry example costs / allowances (per-step carpet labor &amp; yardage, subfloor $/sheet, self-leveler coverage &amp; $/bag, demo tear-out rates). Check them against your real numbers — metals, J-channel &amp; stairnose are notes only (no cost).
        </span>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Add a question</CardTitle>
        </CardHeader>
        <CardContent>
          <QuestionForm keyed={keyed} />
        </CardContent>
      </Card>

      {questions.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No questions yet"
          description="Add one above (or run the estimate_questions migration to seed the carpet questionnaire)."
        />
      ) : (
        <div className="space-y-6">
          {sections.map((section) => {
            const items = questions
              .filter((q) => q.section === section)
              .sort((a, b) => a.position - b.position);
            return (
              <section key={section}>
                <h2 className="mb-2 px-1 text-sm font-semibold text-muted-foreground">{section}</h2>
                <div className="space-y-2">
                  {items.map((q, i) => (
                    <div key={q.id} className={`flex items-center gap-2 rounded-md border p-2 ${q.active ? "" : "opacity-60"}`}>
                      <div className="flex flex-col">
                        <form action={moveEstimateQuestion}>
                          <input type="hidden" name="id" value={q.id} />
                          <input type="hidden" name="dir" value="up" />
                          <Button type="submit" variant="ghost" size="icon-xs" aria-label="Move up" disabled={i === 0}>
                            <ChevronUp className="size-3.5" />
                          </Button>
                        </form>
                        <form action={moveEstimateQuestion}>
                          <input type="hidden" name="id" value={q.id} />
                          <input type="hidden" name="dir" value="down" />
                          <Button type="submit" variant="ghost" size="icon-xs" aria-label="Move down" disabled={i === items.length - 1}>
                            <ChevronDown className="size-3.5" />
                          </Button>
                        </form>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">
                          {q.required ? <span className="text-amber-600">★ </span> : null}
                          {q.label}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>{KIND_LABEL[q.kind] ?? q.kind}</span>
                          {q.config.emit?.description ? <span>· {q.config.emit.role} “{q.config.emit.description}”</span> : null}
                          {q.config.category ? <span>· {q.config.category}</span> : null}
                          {!q.active ? <span>· inactive</span> : null}
                        </div>
                        {costSummary(q) ? (
                          <div className="mt-1 flex items-start gap-1.5 text-xs">
                            <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700 dark:bg-amber-500/20 dark:text-amber-400">
                              seeded — verify
                            </span>
                            <span className="min-w-0 tabular-nums text-muted-foreground">{costSummary(q)}</span>
                          </div>
                        ) : null}
                      </div>
                      <Link href={`/settings/estimate-questions/${q.id}`} className="text-muted-foreground hover:text-foreground" aria-label="Edit">
                        <Pencil className="size-4" />
                      </Link>
                      <form action={deleteEstimateQuestion}>
                        <input type="hidden" name="id" value={q.id} />
                        <ConfirmButton
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Delete"
                          title="Delete this estimate question?"
                          description="Removes the question from the guided estimate builder. This can't be undone."
                          confirmLabel="Delete"
                          destructive
                        >
                          <Trash2 className="size-4" />
                        </ConfirmButton>
                      </form>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
