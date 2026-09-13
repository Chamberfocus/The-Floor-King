import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { mayMergeCustomers } from "@/lib/customer-duplicate-cleanup";
import { listDuplicateCandidateGroups } from "@/lib/data/customer-duplicate-cleanup";
import { DuplicateGroupCard } from "./duplicate-group-card";
import type { CleanupConfidence } from "@/lib/customer-duplicate-cleanup";

export const metadata: Metadata = { title: "Duplicate Review" };

const FILTERS: { v: string; label: string }[] = [
  { v: "high", label: "High confidence" },
  { v: "medium", label: "Medium" },
  { v: "low", label: "Low" },
  { v: "ignored", label: "Not a duplicate" },
  { v: "merged", label: "Already merged" },
  { v: "all", label: "All open" },
];

export default async function DuplicateReviewPage({
  searchParams,
}: {
  searchParams: Promise<{
    confidence?: string;
    phone?: string;
    email?: string;
    name_address?: string;
  }>;
}) {
  const profile = await requireRole(["admin", "office", "sales_manager"]);
  const sp = await searchParams;
  const raw = (sp.confidence ?? "high").trim();
  const confidence = (
    ["high", "medium", "low", "all", "ignored", "merged"].includes(raw)
      ? raw
      : "high"
  ) as CleanupConfidence | "all" | "ignored" | "merged";
  const samePhone = sp.phone === "1";
  const sameEmail = sp.email === "1";
  const sameNameAddress = sp.name_address === "1";

  const { groups, totalCustomers } = await listDuplicateCandidateGroups({
    confidence,
    samePhone,
    sameEmail,
    sameNameAddress,
  });
  const canMerge = mayMergeCustomers(profile.role);

  const href = (next: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const conf = next.confidence ?? (confidence === "high" ? undefined : confidence);
    if (conf && conf !== "high") p.set("confidence", conf);
    if ((next.phone ?? (samePhone ? "1" : "")) === "1") p.set("phone", "1");
    if ((next.email ?? (sameEmail ? "1" : "")) === "1") p.set("email", "1");
    if ((next.name_address ?? (sameNameAddress ? "1" : "")) === "1") {
      p.set("name_address", "1");
    }
    const qs = p.toString();
    return qs ? `/customers/duplicates?${qs}` : "/customers/duplicates";
  };

  return (
    <div>
      <PageHeader
        title="Duplicate Review"
        description={`${totalCustomers} active customers. Groups are suggestions only — nothing merges until an office/admin review.`}
      >
        <Link href="/customers" className={buttonVariants({ variant: "outline" })}>
          Back to customers
        </Link>
      </PageHeader>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.v}
            href={href({
              confidence: f.v === "high" ? undefined : f.v,
              phone: samePhone ? "1" : undefined,
              email: sameEmail ? "1" : undefined,
              name_address: sameNameAddress ? "1" : undefined,
            })}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              confidence === f.v
                ? "bg-primary text-primary-foreground"
                : "border hover:bg-muted"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>
      <div className="mb-6 flex flex-wrap gap-2 text-sm">
        <Link
          href={href({
            confidence: confidence === "high" ? undefined : confidence,
            phone: samePhone ? undefined : "1",
            email: sameEmail ? "1" : undefined,
            name_address: sameNameAddress ? "1" : undefined,
          })}
          className={`rounded-md border px-3 py-1.5 ${samePhone ? "bg-muted" : ""}`}
        >
          Same phone
        </Link>
        <Link
          href={href({
            confidence: confidence === "high" ? undefined : confidence,
            phone: samePhone ? "1" : undefined,
            email: sameEmail ? undefined : "1",
            name_address: sameNameAddress ? "1" : undefined,
          })}
          className={`rounded-md border px-3 py-1.5 ${sameEmail ? "bg-muted" : ""}`}
        >
          Same email
        </Link>
        <Link
          href={href({
            confidence: confidence === "high" ? undefined : confidence,
            phone: samePhone ? "1" : undefined,
            email: sameEmail ? "1" : undefined,
            name_address: sameNameAddress ? undefined : "1",
          })}
          className={`rounded-md border px-3 py-1.5 ${sameNameAddress ? "bg-muted" : ""}`}
        >
          Same name/address
        </Link>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          title="No duplicate groups in this filter"
          description="High-confidence matches (exact phone or email) appear here first. Low-confidence name-only pairs are never auto-merged."
        />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <DuplicateGroupCard key={g.id} group={g} canMerge={canMerge} />
          ))}
        </div>
      )}
    </div>
  );
}
