import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Phone, MapPin } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { listCustomers } from "@/lib/data/customers";
import {
  LEAD_STAGE_LABELS,
  LEAD_STAGE_ORDER,
  type Customer,
  type LeadStage,
} from "@/lib/types";

export const metadata: Metadata = { title: "Leads" };

export default async function LeadsPage() {
  const customers = await listCustomers();

  const byStage = Object.fromEntries(
    LEAD_STAGE_ORDER.map((s) => [s, [] as Customer[]]),
  ) as Record<LeadStage, Customer[]>;
  for (const c of customers) byStage[c.stage].push(c);

  return (
    <div>
      <PageHeader
        title="Leads"
        description="Your pipeline at a glance. Move a lead's stage from its profile."
      >
        <Link href="/customers/new" className={buttonVariants({ size: "lg" })}>
          <Plus className="size-4" /> Add lead
        </Link>
      </PageHeader>

      {customers.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No leads yet. Add your first one to start filling the pipeline.
          </p>
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {LEAD_STAGE_ORDER.map((stage) => (
            <section key={stage} className="w-72 shrink-0">
              <div className="mb-3 flex items-center justify-between px-1">
                <h2 className="text-sm font-semibold">
                  {LEAD_STAGE_LABELS[stage]}
                </h2>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {byStage[stage].length}
                </span>
              </div>
              <div className="space-y-2">
                {byStage[stage].map((c) => (
                  <Link
                    key={c.id}
                    href={`/customers/${c.id}`}
                    className="block rounded-lg border bg-card p-3 shadow-sm transition-colors hover:bg-muted/50"
                  >
                    <div className="font-medium">{c.full_name}</div>
                    {c.company ? (
                      <div className="text-xs text-muted-foreground">
                        {c.company}
                      </div>
                    ) : null}
                    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {c.phone ? (
                        <div className="flex items-center gap-1.5">
                          <Phone className="size-3" /> {c.phone}
                        </div>
                      ) : null}
                      {c.city ? (
                        <div className="flex items-center gap-1.5">
                          <MapPin className="size-3" /> {c.city}
                        </div>
                      ) : null}
                    </div>
                  </Link>
                ))}
                {byStage[stage].length === 0 ? (
                  <div className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                    Empty
                  </div>
                ) : null}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
