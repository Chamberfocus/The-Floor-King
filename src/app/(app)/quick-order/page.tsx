import type { Metadata } from "next";
import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { OrderLinkCard } from "@/components/order-link-card";
import { requireProfile } from "@/lib/auth";
import { COMPANY_NAME } from "@/lib/nav";

export const metadata: Metadata = { title: "Quick order" };
export const dynamic = "force-dynamic";

/**
 * The customer order link, on its own page, for the people who send it.
 *
 * The link already existed — copy button, QR code and a printable counter sign
 * — but it lived at the top of Customer Orders, which sits under Money and is
 * hard-restricted to admin and office. The sales team, who are the ones stood
 * in front of a customer wanting to hand them a link, could not open that page
 * at all.
 *
 * This is the link and nothing else: no order list, so sales don't gain access
 * to the order book just to share a URL.
 */
export default async function QuickOrderPage() {
  const profile = await requireProfile();
  const canSeeOrders = ["admin", "office"].includes(profile.role);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Quick order"
        description="Send this to a customer and they can place a carpet order for pickup themselves — no login needed. It lands under Customer Orders for pricing and confirmation."
      />

      <OrderLinkCard companyName={COMPANY_NAME} />

      <div className="mt-6 rounded-lg border bg-muted/30 p-4 text-sm">
        <p className="font-medium">What happens after they send it</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>They pick from the catalog or describe what they need.</li>
          <li>It arrives as an order that still needs review — nothing is priced or promised yet.</li>
          <li>You confirm pricing, cut it, and let them know it&apos;s ready to grab.</li>
        </ol>
        {canSeeOrders ? (
          <Link
            href="/orders"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <ShoppingBag className="size-4" /> See the orders that have come in
          </Link>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            Orders are reviewed by the office.
          </p>
        )}
      </div>
    </div>
  );
}
