import { redirect } from "next/navigation";

// "Leads" is folded into the customer-centric model: a lead is just an
// early-stage customer. The Customers list (search + stage filter) and the
// Pipeline board cover this view, so /leads now redirects there.
export default function LeadsPage() {
  redirect("/customers");
}
