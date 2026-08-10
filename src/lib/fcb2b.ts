/**
 * fcB2B — the flooring industry's own B2B standard.
 *
 * Two generations exist side by side, and a supplier may offer either:
 *
 *  • X12-derived DOCUMENTS, exchanged as files. 832 Price Catalog, 850
 *    Purchase Order, 855 PO Acknowledgement, 856 Advance Ship Notice, 810
 *    Invoice, 997 Functional Acknowledgement. Tuned for flooring — dye lots,
 *    roll widths, piece dimensions.
 *
 *  • RESTful WEB SERVICES (spec v1.0, Jan 2024) for near-real-time questions:
 *    stock check, inventory inquiry, price inquiry, related items, solution
 *    check/inquiry, document service.
 *
 * Every request carries the same four parameters, and the spec is explicit that
 * ClientIdentifier is a code the SUPPLIER issues for electronic exchange — it
 * warns against reusing the account number.
 */

export const FCB2B_DOCUMENTS = [
  { code: "832", name: "Product Price Catalog", why: "Their price list. This is what keeps our costs current." },
  { code: "850", name: "Purchase Order", why: "Our order, sent electronically instead of by phone or email." },
  { code: "855", name: "PO Acknowledgement", why: "Their confirmation — what they accepted, at what price, and when it ships." },
  { code: "856", name: "Advance Ship Notice", why: "What actually shipped, with dye lots and roll numbers, before it arrives." },
  { code: "810", name: "Invoice", why: "Their bill, matched automatically against the PO and the receipt." },
  { code: "997", name: "Functional Acknowledgement", why: "A receipt for the exchange itself, so nothing is silently lost." },
] as const;

export const FCB2B_SERVICES = [
  { path: "/services", name: "Service Discovery", why: "Which of the services below you support." },
  { path: "/stockcheck", name: "Stock Check", why: "Is this item available right now?" },
  { path: "/inventoryinquiry", name: "Inventory Inquiry", why: "All availability for an item." },
  { path: "/relateditems", name: "Related Items", why: "Trims, mouldings and accessories that go with an item." },
  { path: "/solutioncheck", name: "Solution Check", why: "Availability filtered by dye lot or shade." },
  { path: "/solutioninquiry", name: "Solution Inquiry", why: "Every roll or carton matching a constraint." },
  { path: "/documentservice", name: "Document Service", why: "Spec sheets, warranties and images for an item." },
] as const;

/** The four parameters every fcB2B web-service request carries. */
export const FCB2B_REQUEST_PARAMS = [
  { name: "ClientIdentifier", meaning: "The buyer code you assign us. The spec recommends this NOT be our account number." },
  { name: "SupplierItemSKU", meaning: "Your SKU for the item, the same one used on the 832 catalog and 850 order." },
  { name: "TimeStamp", meaning: "ISO 8601 date-time." },
  { name: "GlobalIdentifier", meaning: "A UUID we generate, echoed back so the response can be matched to the request." },
] as const;

/** What we need FROM a supplier before anything can be switched on. */
export const ONBOARDING_ASKS = [
  {
    q: "Do you support fcB2B?",
    detail: "If yes, which documents (832 / 850 / 855 / 856 / 810) and do you offer the RESTful web services?",
  },
  {
    q: "What ClientIdentifier will you issue us?",
    detail: "The buyer code for electronic exchange. Per the fcB2B spec this should be separate from our account number.",
  },
  {
    q: "How is the price catalog delivered?",
    detail: "An 832 document, a CSV/Excel file, or a REST price-inquiry endpoint — and how often it is refreshed.",
  },
  {
    q: "How do we connect?",
    detail: "AS2, SFTP, HTTPS endpoint or email drop — plus the endpoint URL and how we authenticate.",
  },
  {
    q: "Which SKU appears on the catalog?",
    detail: "So it matches the SKU on your invoices and our purchase orders. A mismatch here is the usual reason a feed doesn't line up.",
  },
  {
    q: "Is pricing customer-specific?",
    detail: "Does the catalog carry OUR negotiated cost, or list price we discount from? If it's list, we need the discount basis.",
  },
  {
    q: "Who is the technical contact?",
    detail: "The person who actually configures the connection, not the sales rep.",
  },
] as const;

/** A UUID for the GlobalIdentifier parameter. */
export function globalIdentifier(): string {
  return crypto.randomUUID();
}

/** Build an fcB2B web-service request URL with the four required parameters. */
export function fcb2bUrl(
  base: string,
  service: string,
  clientIdentifier: string,
  supplierItemSku: string,
  now: Date,
): string {
  const root = base.replace(/\/+$/, "");
  const path = service.startsWith("/") ? service : `/${service}`;
  const qs = new URLSearchParams({
    ClientIdentifier: clientIdentifier,
    SupplierItemSKU: supplierItemSku,
    TimeStamp: now.toISOString(),
    GlobalIdentifier: globalIdentifier(),
  });
  return `${root}${path}?${qs.toString()}`;
}
