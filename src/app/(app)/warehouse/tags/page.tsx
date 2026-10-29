import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PrintButton } from "@/components/print-button";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { listRollTags } from "@/lib/data/roll-scan";

export const metadata: Metadata = { title: "Roll tags" };
export const dynamic = "force-dynamic";

export default async function RollTagsPage() {
  const profile = await requireProfile();
  if (!["admin", "office", "warehouse", "sales_manager"].includes(profile.role)) redirect("/");
  const tags = await listRollTags();

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/warehouse/scan" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Scan a roll
        </Link>
        <PrintButton label="Print tags" />
      </div>
      <PageHeader
        title="Roll tags"
        description="Print a tag for each roll on hand. Scanning the code opens that roll."
      />
      {tags.length === 0 ? (
        <p className="rounded-lg border bg-card px-4 py-3 text-sm">No rolls are on hand.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {tags.map((tag) => (
            <article key={tag.id} className="flex break-inside-avoid flex-col items-center rounded-lg border bg-card px-3 py-3 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={tag.qr} alt="" width={120} height={120} />
              <div className="mt-2 text-sm font-semibold">{tag.productName}</div>
              <div className="text-xs text-muted-foreground">
                {tag.rollNumber ? `Roll ${tag.rollNumber}` : "No roll number"}
                {tag.dyeLot ? ` · ${tag.dyeLot}` : ""}
              </div>
              <div className="text-xs text-muted-foreground">
                {tag.location || "No bin"} · {tag.qty} {tag.unit}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
