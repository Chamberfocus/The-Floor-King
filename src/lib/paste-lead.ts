/**
 * Read one pasted Facebook or website lead into customer fields.
 * Structured labels win. A loose email, phone, or "City, ST ZIP" line fills
 * anything the labels missed. The saved customer stays a normal lead.
 */
import { formatPhone } from "@/components/ui/phone-input";

export type PastedLeadSource = "facebook" | "website";

export interface PastedLead {
  fullName: string;
  company: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  notes: string;
  sourceKey: PastedLeadSource | null;
  /** Chip label on the Facebook source, when the paste says which kind. */
  sourceDetailLabel: string | null;
  campaign: string;
  /** A name plus a phone or email is enough to create the customer. */
  ready: boolean;
}

const EMPTY: PastedLead = {
  fullName: "",
  company: "",
  email: "",
  phone: "",
  street: "",
  city: "",
  state: "",
  zip: "",
  notes: "",
  sourceKey: null,
  sourceDetailLabel: null,
  campaign: "",
  ready: false,
};

type Field =
  | "full_name"
  | "first_name"
  | "last_name"
  | "company"
  | "email"
  | "phone"
  | "street"
  | "city"
  | "state"
  | "zip"
  | "campaign"
  | "ad";

const CONTACT: Record<string, Field> = {
  "full name": "full_name",
  name: "full_name",
  "customer name": "full_name",
  "lead name": "full_name",
  "your name": "full_name",
  "first name": "first_name",
  "last name": "last_name",
  company: "company",
  "company name": "company",
  business: "company",
  email: "email",
  "email address": "email",
  "e mail": "email",
  phone: "phone",
  "phone number": "phone",
  mobile: "phone",
  "mobile number": "phone",
  cell: "phone",
  "cell phone": "phone",
  telephone: "phone",
  "contact number": "phone",
  "street address": "street",
  street: "street",
  address: "street",
  "address line 1": "street",
  city: "city",
  state: "state",
  province: "state",
  zip: "zip",
  "zip code": "zip",
  zipcode: "zip",
  "postal code": "zip",
  campaign: "campaign",
  "campaign name": "campaign",
  "ad set": "ad",
  "ad name": "ad",
  ad: "ad",
};

const STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH",
  "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
  "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN",
  texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]*\d{4}/;
const NAME_RE = /^[A-Z][a-z]+(?:[.'-][A-Z][a-z]+)?(?:\s+[A-Z][a-z]+(?:[.'-][A-Z][a-z]+)?){1,3}$/;

function canonicalLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[_*]/g, " ")
    .replace(/[?:.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanValue(raw: string): string {
  const v = raw.replace(/\s+/g, " ").trim();
  if (!v || /^(n\/a|na|none|null|-+|—)$/i.test(v)) return "";
  return v;
}

function stateCode(raw: string): string {
  const t = raw.trim();
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return STATES[t.toLowerCase()] ?? "";
}

function zipCode(raw: string): string {
  const m = raw.match(/\b(\d{5})(?:-(\d{4}))?\b/);
  if (!m) return "";
  return m[2] ? `${m[1]}-${m[2]}` : m[1];
}

function phoneValue(raw: string): string {
  const m = raw.match(PHONE_RE);
  if (!m) return "";
  const formatted = formatPhone(m[0]);
  return formatted.replace(/\D/g, "").length === 10 ? formatted : "";
}

/** "90 Lake Road, Bay Village, OH 44140" → street, city, state, zip. */
function splitStreetLine(raw: string): {
  street: string;
  city: string;
  state: string;
  zip: string;
} {
  const zip = zipCode(raw);
  const withoutZip = zip ? raw.replace(zip, "").replace(/[,\s]+$/g, "").trim() : raw.trim();
  const parts = withoutZip.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) {
    const state = stateCode(parts[parts.length - 1]);
    if (state) {
      return {
        street: parts.slice(0, -2).join(", "),
        city: parts[parts.length - 2],
        state,
        zip,
      };
    }
  }
  if (parts.length === 2) {
    const state = stateCode(parts[1]);
    if (state) return { street: parts[0], city: "", state, zip };
  }
  const tail = withoutZip.match(/^(.*?),\s*([^,]+)$/);
  if (tail && !stateCode(tail[2])) {
    return { street: tail[1].trim(), city: tail[2].trim(), state: "", zip };
  }
  return { street: raw.trim(), city: "", state: "", zip };
}

function sourceFrom(text: string): Pick<PastedLead, "sourceKey" | "sourceDetailLabel"> {
  const namedFacebook = /\b(facebook|fb\.com|meta business|lead ads?|instagram)\b/i.test(text);
  const campaignExport = /\bcampaign\b/i.test(text) && /\bad set\b/i.test(text);
  const facebook = namedFacebook || campaignExport;
  const website = /\b(website|web site|contact form|form submission|from the site|your site)\b/i.test(text);
  if (facebook) {
    let sourceDetailLabel: string | null = null;
    if (/\borganic\b/i.test(text) && !/\bcampaign\b/i.test(text)) sourceDetailLabel = "Organic page/post";
    else if (/\b(campaign|lead ads?|ad set)\b/i.test(text)) sourceDetailLabel = "Paid campaign";
    else if (/\b(facebook group|local group)\b/i.test(text)) sourceDetailLabel = "Local group";
    return { sourceKey: "facebook", sourceDetailLabel };
  }
  if (website) return { sourceKey: "website", sourceDetailLabel: null };
  return { sourceKey: null, sourceDetailLabel: null };
}

interface Pair {
  label: string;
  field: Field | null;
  value: string;
}

function parsePairs(lines: string[]): Pair[] {
  const pairs: Pair[] = [];
  const isLabelLine = (line: string) => {
    const key = canonicalLabel(line);
    return !!CONTACT[key] && !line.includes(":");
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const colon = line.match(/^([^:]{2,80}):\s*(.*)$/);
    if (colon && !/^\d+$/.test(colon[1].trim())) {
      const label = canonicalLabel(colon[1]);
      let value = cleanValue(colon[2]);
      // "Email:" with the address on the next line. A value already on this
      // line stays on this line so a later question is not swallowed.
      if (!value) {
        const chunks: string[] = [];
        while (
          i + 1 < lines.length &&
          lines[i + 1] &&
          !lines[i + 1].includes(":") &&
          !lines[i + 1].endsWith("?") &&
          !isLabelLine(lines[i + 1])
        ) {
          i += 1;
          chunks.push(lines[i]);
        }
        value = cleanValue(chunks.join(" "));
      }
      pairs.push({ label, field: CONTACT[label] ?? null, value });
      continue;
    }
    if (line.endsWith("?") && !line.includes(":")) {
      const chunks: string[] = [];
      while (
        i + 1 < lines.length &&
        lines[i + 1] &&
        !lines[i + 1].includes(":") &&
        !lines[i + 1].endsWith("?") &&
        !isLabelLine(lines[i + 1])
      ) {
        i += 1;
        chunks.push(lines[i]);
      }
      const value = cleanValue(chunks.join(" "));
      if (value) pairs.push({ label: canonicalLabel(line), field: null, value });
      continue;
    }
    const key = canonicalLabel(line);
    if (!CONTACT[key]) continue;
    const chunks: string[] = [];
    while (i + 1 < lines.length && lines[i + 1] && !lines[i + 1].includes(":") && !isLabelLine(lines[i + 1])) {
      i += 1;
      chunks.push(lines[i]);
    }
    pairs.push({ label: key, field: CONTACT[key], value: cleanValue(chunks.join(" ")) });
  }
  return pairs;
}

function looksLikeHeader(line: string): boolean {
  return /^(you have a new lead!?|new lead!?|lead details|contact information|new (website |web )?form submission.*|new message from the website.*|form response|inbox)$/i.test(
    line.trim(),
  );
}

export function parsePastedLead(raw: string): PastedLead {
  const text = raw.replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n").trim();
  if (!text) return { ...EMPTY };

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const pairs = parsePairs(lines);
  const take = (field: Field): string => pairs.find((p) => p.field === field && p.value)?.value ?? "";

  let fullName = take("full_name");
  const first = take("first_name");
  const last = take("last_name");
  if (!fullName && (first || last)) fullName = [first, last].filter(Boolean).join(" ");

  let email = take("email").match(EMAIL_RE)?.[0] ?? "";
  let phone = phoneValue(take("phone"));
  let street = take("street");
  let city = take("city");
  let state = stateCode(take("state"));
  let zip = zipCode(take("zip"));
  const company = take("company");

  if (street) {
    const split = splitStreetLine(street);
    street = split.street;
    if (!city && split.city) city = split.city;
    if (!state && split.state) state = split.state;
    if (!zip && split.zip) zip = split.zip;
  }

  if (!email) email = text.match(EMAIL_RE)?.[0] ?? "";
  if (!phone) phone = phoneValue(text);

  if (!fullName) {
    const named = lines.find((line) => NAME_RE.test(line) && !looksLikeHeader(line));
    if (named) fullName = named;
  }

  // One spreadsheet row: Name, email, phone, street, city, ST ZIP
  if (!fullName && lines.length === 1 && text.includes(",")) {
    const cells = text.split(",").map((c) => c.trim()).filter(Boolean);
    const named = cells.find((c) => NAME_RE.test(c));
    if (named) fullName = named;
    if (!email) email = cells.find((c) => EMAIL_RE.test(c))?.match(EMAIL_RE)?.[0] ?? "";
    if (!phone) {
      const cell = cells.find((c) => phoneValue(c));
      if (cell) phone = phoneValue(cell);
    }
    const addr = cells.filter((c) => c !== fullName && !EMAIL_RE.test(c) && !phoneValue(c)).join(", ");
    if (addr && !street) {
      const split = splitStreetLine(addr);
      street = split.street;
      if (!city) city = split.city;
      if (!state) state = split.state;
      if (!zip) zip = split.zip;
    }
  }

  const campaignBits = [take("campaign"), take("ad")].filter(Boolean);
  const campaign = campaignBits.join(" · ");
  const source = sourceFrom(text);

  const noteLines = pairs
    .filter((p) => !p.field && p.value)
    .map((p) => `${p.label.charAt(0).toUpperCase()}${p.label.slice(1)}: ${p.value}`);
  let notes = noteLines.join("\n");
  const ready = !!fullName && !!(phone || email);
  if (!ready && !notes) notes = text.slice(0, 4000);

  return {
    fullName,
    company,
    email,
    phone,
    street,
    city,
    state,
    zip,
    notes,
    sourceKey: source.sourceKey,
    sourceDetailLabel: source.sourceDetailLabel,
    campaign,
    ready,
  };
}
