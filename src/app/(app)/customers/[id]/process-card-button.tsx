import Link from "next/link";
import { CreditCard } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

/**
 * Opens the shop's external card processor (virtual terminal / payment page) in
 * a new tab so an estimator can run a card. The CRM never handles card data — it
 * only links out. Renders nothing until an admin sets the link in Settings →
 * Branding (a subtle setup prompt shows for admins).
 */
export function ProcessCardButton({
  url,
  isAdmin = false,
}: {
  url: string | null | undefined;
  isAdmin?: boolean;
}) {
  if (url && url.trim()) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className={buttonVariants({ variant: "outline", size: "lg" })}
      >
        <CreditCard className="size-4" /> Process card
      </a>
    );
  }
  if (isAdmin) {
    return (
      <Link
        href="/settings/branding"
        className={buttonVariants({ variant: "ghost", size: "lg" })}
      >
        <CreditCard className="size-4" /> Set up card processing
      </Link>
    );
  }
  return null;
}
