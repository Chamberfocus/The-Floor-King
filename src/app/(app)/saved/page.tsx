import type { Metadata } from "next";
import Link from "next/link";
import { FileText, ShoppingCart, Receipt, ArrowRight, Bookmark } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { listMyDrafts, type DraftType } from "@/lib/data/drafts";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Saved for later" };

const META: Record<
  DraftType,
  { label: string; icon: typeof FileText; badge: string }
> = {
  estimate: {
    label: "Estimate",
    icon: FileText,
    badge: "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
  },
  po: {
    label: "Purchase Order",
    icon: ShoppingCart,
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  },
  invoice: {
    label: "Invoice",
    icon: Receipt,
    badge: "bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300",
  },
};

export default async function SavedForLaterPage() {
  await requireProfile();
  const drafts = await listMyDrafts();

  return (
    <div>
      <PageHeader
        title="Saved for later"
        description="Your unfinished estimates, purchase orders, and invoices — pick up right where you left off."
      />

      {drafts.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <Bookmark className="mx-auto mb-2 size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Nothing saved for later. When you&apos;re building an estimate, PO, or
            invoice and need to step away, hit{" "}
            <span className="font-medium">Save for later</span> and it&apos;ll
            wait here.
          </p>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {drafts.map((d) => {
                const m = META[d.type];
                const Icon = m.icon;
                return (
                  <li key={`${d.type}-${d.id}`}>
                    <Link
                      href={d.href}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <Icon className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">{d.title}</span>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${m.badge}`}
                          >
                            {m.label}
                          </span>
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {d.customer ? `${d.customer} · ` : ""}Updated{" "}
                          {formatDate(d.updatedAt)}
                        </div>
                      </div>
                      <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary">
                        Resume <ArrowRight className="size-4" />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
