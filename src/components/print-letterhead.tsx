import type { OrgSettings } from "@/lib/types";

/**
 * Professional letterhead for printed/PDF documents (estimates, invoices, POs):
 * the company logo (or name), full contact block, and the document
 * title/number/date on the right. Print-color safe (black on white).
 */
export function PrintLetterhead({
  org,
  docTitle,
  meta,
}: {
  org: OrgSettings;
  docTitle: string;
  meta?: React.ReactNode;
}) {
  const contact = [org.phone, org.email, org.website]
    .filter(Boolean)
    .join("   ·   ");
  return (
    <div className="flex items-start justify-between gap-6 border-b-2 border-gray-800 pb-4">
      <div className="space-y-1">
        {org.logo_url ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={org.logo_url}
              alt={org.company_name}
              className="mb-1.5 h-24 w-auto max-w-[320px] object-contain"
            />
            <div className="text-lg font-bold">{org.company_name}</div>
          </>
        ) : (
          <div className="text-3xl font-extrabold tracking-tight">{org.company_name}</div>
        )}
        {org.address ? (
          <div className="whitespace-pre-line text-sm leading-snug text-gray-700">{org.address}</div>
        ) : null}
        {contact ? <div className="text-sm text-gray-700">{contact}</div> : null}
      </div>
      <div className="shrink-0 text-right">
        <div className="text-2xl font-extrabold tracking-wide text-gray-800">{docTitle}</div>
        {meta}
      </div>
    </div>
  );
}

/** "Bill to" / "Prepared for" block for a customer. */
export function PrintBillTo({
  label = "Prepared for",
  name,
  street,
  city,
  state,
  zip,
  phone,
  email,
}: {
  label?: string;
  name: string;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  email?: string | null;
}) {
  const addr = [street, [city, state].filter(Boolean).join(", "), zip]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="py-3.5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
        {label}
      </div>
      <div className="text-lg font-bold">{name}</div>
      {addr ? <div className="text-[15px] text-gray-700">{addr}</div> : null}
      {phone || email ? (
        <div className="text-[15px] text-gray-700">
          {[phone, email].filter(Boolean).join("  ·  ")}
        </div>
      ) : null}
    </div>
  );
}
