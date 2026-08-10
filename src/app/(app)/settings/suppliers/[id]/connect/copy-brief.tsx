"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The brief a supplier's EDI contact actually needs.
 *
 * Written to be forwarded as-is. It leads with what we want (their price
 * catalog), names the standard so they know we're not asking for something
 * bespoke, and asks the specific questions whose answers unblock the setup —
 * including the two that most often derail it: which SKU appears on the
 * catalog, and whether the pricing is our negotiated cost or list.
 */
export function CopyBrief({
  company,
  supplier,
  accountNumber,
  contactEmail,
  contactPhone,
}: {
  company: string;
  supplier: string;
  accountNumber: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}) {
  const [copied, setCopied] = useState(false);

  const brief = `Subject: fcB2B / electronic price catalog setup — ${company}

Hello,

${company} is setting up automatic price and order handling with ${supplier}${
    accountNumber ? ` (account ${accountNumber})` : ""
  }, and we'd like to connect using the fcB2B standard.

WHAT WE'RE ASKING FOR FIRST
Your 832 Product Price Catalog, delivered on whatever schedule you publish.
That alone keeps our costs current and is the highest-value piece for us.

IF YOU ALSO SUPPORT THEM, WE'D LIKE
  850  Purchase Order              — our orders sent electronically
  855  PO Acknowledgement          — what you accepted, at what price, ship date
  856  Advance Ship Notice         — what shipped, with dye lots and roll numbers
  810  Invoice                     — your bill, matched to the PO automatically
  997  Functional Acknowledgement  — confirmation the exchange itself succeeded

We can also consume the fcB2B RESTful web services (stock check, inventory
inquiry, price inquiry, related items, document service) if you offer them.

WHAT WE NEED FROM YOU
1. Do you support fcB2B, and which of the documents above?
2. The ClientIdentifier you'll issue us. Per the fcB2B specification this is a
   buyer code for electronic exchange and should be separate from our account
   number.
3. How the price catalog is delivered — 832 document, CSV/Excel file, or a REST
   endpoint — and how often it's refreshed.
4. The connection method: AS2, SFTP, HTTPS endpoint or email drop, plus the
   endpoint URL and how we authenticate.
5. Which SKU appears on the catalog, and confirmation it's the same SKU that
   appears on your invoices and on our purchase orders. A mismatch here is the
   usual reason a feed doesn't line up.
6. Whether the catalog carries our negotiated cost or list price. If it's list,
   what the discount basis is.
7. Your technical contact for the setup.

OUR DETAILS
  Company:  ${company}${accountNumber ? `\n  Account:  ${accountNumber}` : ""}${
    contactEmail ? `\n  Email:    ${contactEmail}` : ""
  }${contactPhone ? `\n  Phone:    ${contactPhone}` : ""}

Happy to work to whatever you already have in place — we don't need anything
custom built. If the simplest thing on your side is a spreadsheet on a schedule,
that works too; we can start there and move to 832 later.

Thank you,
${company}
`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(brief);
      setCopied(true);
      toast.success("Copied — paste it into an email to their EDI contact.");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Couldn't copy. Select the text below and copy it manually.");
    }
  };

  return (
    <div>
      <Button onClick={copy} size="sm" className="mb-3">
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? "Copied" : "Copy the brief"}
      </Button>
      <pre className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed whitespace-pre-wrap">
        {brief}
      </pre>
    </div>
  );
}
