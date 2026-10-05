import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CustomerRecordActions } from "./customer-record-actions";

export const metadata: Metadata = { title: "Customer records" };

type Props = {
  searchParams?: Promise<{ view?: string }>;
};

function textValue(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export default async function CustomerRecordsPage({ searchParams }: Props) {
  const profile = await requireProfile();
  const params = (await searchParams) ?? {};
  const view =
    params.view === "archived" || params.view === "all" ? params.view : "active";

  const supabase = await createClient();
  let query = supabase
    .from("customers")
    .select(
      "id, full_name, company, phone, email, city, state, created_at, cancelled_at, cancel_reason",
    )
    .order("created_at", { ascending: false })
    .limit(250);

  if (view === "active") query = query.is("cancelled_at", null);
  if (view === "archived") query = query.not("cancelled_at", "is", null);

  const { data, error } = await query;
  const rows = error ? [] : data ?? [];
  const canArchive = profile.role === "admin" || profile.role === "office";
  const canDelete = profile.role === "admin";

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/home"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to home
        </Link>
        <Link
          href="/new-customer"
          className={buttonVariants({ size: "sm" })}
        >
          <Plus className="size-4" /> New customer
        </Link>
      </div>

      <PageHeader
        title="Customer records"
        description="Archive customers you want out of the active list. Administrators can permanently delete only completely unused customer records."
      />

      <div className="flex flex-wrap gap-2">
        <Link
          href="/customer-records?view=active"
          className={buttonVariants({ variant: view === "active" ? "default" : "outline", size: "sm" })}
        >
          Active
        </Link>
        <Link
          href="/customer-records?view=archived"
          className={buttonVariants({ variant: view === "archived" ? "default" : "outline", size: "sm" })}
        >
          Archived
        </Link>
        <Link
          href="/customer-records?view=all"
          className={buttonVariants({ variant: view === "all" ? "default" : "outline", size: "sm" })}
        >
          All
        </Link>
      </div>

      {error ? (
        <Card>
          <CardContent className="pt-6 text-sm text-destructive">
            Customer records could not be loaded.
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No customers in this view.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const id = textValue(row.id);
            const name = textValue(row.full_name) || "Unnamed customer";
            const company = textValue(row.company);
            const phone = textValue(row.phone);
            const email = textValue(row.email);
            const city = textValue(row.city);
            const state = textValue(row.state);
            const archived = Boolean(row.cancelled_at);

            return (
              <Card key={id}>
                <CardContent className="flex flex-col gap-4 pt-6 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="truncate font-semibold">{name}</div>
                      {archived ? (
                        <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                          Archived
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {[company, phone, email, [city, state].filter(Boolean).join(", ")]
                        .filter(Boolean)
                        .join(" · ") || "No additional contact information"}
                    </div>
                    {archived && row.cancel_reason ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {textValue(row.cancel_reason)}
                      </div>
                    ) : null}
                  </div>

                  {canArchive ? (
                    <CustomerRecordActions
                      customerId={id}
                      archived={archived}
                      canDelete={canDelete}
                    />
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardContent className="pt-6 text-xs text-muted-foreground">
          Delete forever is intentionally strict: if any invoice, job, estimate, payment, order,
          appointment, note, document, referral, or any other foreign-key-linked record exists,
          deletion is blocked and Archive should be used instead.
        </CardContent>
      </Card>
    </div>
  );
}
