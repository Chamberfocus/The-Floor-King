import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { getCustomer } from "@/lib/data/customers";
import { listProducts } from "@/lib/data/products";
import { listWizardQuestions } from "@/lib/data/wizard";
import { EstimateWizard } from "../estimate-wizard";
import { createEstimate } from "../actions";

export const metadata: Metadata = { title: "New estimate" };

export default async function NewEstimatePage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>;
}) {
  const { customer: customerId } = await searchParams;
  if (!customerId) redirect("/customers");

  const customer = await getCustomer(customerId);
  if (!customer) notFound();

  const [products, questions] = await Promise.all([
    listProducts({ activeOnly: true }),
    listWizardQuestions({ activeOnly: true }),
  ]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link
          href={`/customers/${customerId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to {customer.full_name}
        </Link>
        <form action={createEstimate}>
          <input type="hidden" name="customer_id" value={customerId} />
          <button
            type="submit"
            className="text-sm text-muted-foreground underline hover:text-foreground"
          >
            Skip wizard — start blank
          </button>
        </form>
      </div>

      <PageHeader
        title="Estimate Wizard"
        description={`Guided estimate for ${customer.full_name}. Edit these questions anytime in Wizard Setup.`}
      />

      <EstimateWizard
        customerId={customerId}
        customerName={customer.full_name}
        products={products}
        questions={questions}
      />
    </div>
  );
}
