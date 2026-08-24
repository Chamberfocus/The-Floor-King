import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";

/**
 * There were two pages called "Counter sale".
 *
 * This one — reached only from the Invoices list's own button — was the older,
 * cut-down version: type a description and a number, no product picker, no
 * catalog prices, no stock. /counter-sale is the real one, and it's the one in
 * the sidebar. So the button on the Invoices page was the only way to reach the
 * worse of the two, and you'd have no way of knowing which you were in: same
 * title, same "cash & carry" description.
 *
 * One counter sale now. This redirects; its form and action are deleted.
 */
export default async function QuickInvoiceRedirect() {
  await requireProfile();
  redirect("/counter-sale");
}
