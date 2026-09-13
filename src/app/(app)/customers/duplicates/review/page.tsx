import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { mayMergeCustomers } from "@/lib/customer-duplicate-cleanup";
import { getMergePreview } from "@/lib/data/customer-duplicate-cleanup";
import { MergeReviewForm } from "../merge-review-form";

export const metadata: Metadata = { title: "Merge customers" };

export default async function MergeReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const profile = await requireRole(["admin", "office", "sales_manager"]);
  const sp = await searchParams;
  const a = sp.a?.trim() ?? "";
  const b = sp.b?.trim() ?? "";
  if (!a || !b || a === b) notFound();

  const preview = await getMergePreview(a, b);
  if (!preview.survivor || !preview.duplicate) notFound();

  const countsAB = {
    ...preview.preview.counts,
  };
  const reverse = await getMergePreview(b, a);
  const canMerge = mayMergeCustomers(profile.role);

  return (
    <div>
      <PageHeader
        title="Review customer merge"
        description="Nothing changes until you choose a survivor and confirm. This is not a financial transaction and does not post to accounting."
      >
        <Link href="/customers/duplicates" className={buttonVariants({ variant: "outline" })}>
          Back to duplicates
        </Link>
      </PageHeader>
      <MergeReviewForm
        left={preview.survivor}
        right={preview.duplicate}
        countsLeftToRight={reverse.preview.counts}
        countsRightToLeft={countsAB}
        openArCombined={preview.combinedFinancials.openAr}
        portalConflict={preview.portalConflict}
        draftConflict={preview.draftConflict}
        canMerge={canMerge}
      />
    </div>
  );
}
