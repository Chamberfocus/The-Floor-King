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
  const contact = [org.phone, org.email].filter(Boolean).join("   ·   ");
  return (
    <div className="flex items-start justify-between gap-6 border-b-2 border-gray-800 pb-4">
      <div className="space-y-0.5">
        {org.logo_url ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={org.logo_url}
              alt={org.company_name}
              className="mb-1 h-16 w-auto max-w-[240px] object-contain"
            />
            <div className="text-sm font-semibold">{org.company_name}</div>
          </>
        ) : (
          <div className="text-2xl font-bold">{org.company_name}</div>
        )}
        {org.address ? (
          <div className="whitespace-pre-line text-xs text-gray-600">{org.address}</div>
        ) : null}
        {contact ? <div className="text-xs text-gray-600">{contact}</div> : null}
      </div>
      <div className="shrink-0 text-right">
        <div className="text-xl font-bold tracking-wide text-gray-800">{docTitle}</div>
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
    <div className="py-4 text-sm">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className="font-medium">{name}</div>
      {addr ? <div className="text-xs text-gray-600">{addr}</div> : null}
      {phone || email ? (
        <div className="text-xs text-gray-600">
          {[phone, email].filter(Boolean).join("  ·  ")}
        </div>
      ) : null}
    </div>
  );
}
