/**
 * Smart document extraction via the Anthropic API.
 *
 * Three jobs, one robust engine:
 *  - extractPriceList   — vendor price lists → catalog products
 *  - extractOrderDocument — order confirmations / invoices / bills of lading → PO lines
 *  - extractClients     — customer lists → contacts
 *
 * Built for accuracy and resilience: deterministic (temperature 0), expert
 * prompts that see through vendor "nonsense", and tolerant JSON recovery so a
 * slightly-truncated response still yields the rows it managed to return —
 * instead of failing the whole import. No-ops (returns null) until
 * ANTHROPIC_API_KEY is set.
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

interface AnthropicBlock {
  type: string;
  text?: string;
}

// ---------------------------------------------------------------------------
// Shared, resilient model call + JSON recovery
// ---------------------------------------------------------------------------

/** The reason the most recent extraction returned nothing — so callers can
 *  show a real message instead of a silent failure. */
let lastExtractError: string | null = null;
export function getLastExtractError(): string | null {
  return lastExtractError;
}

type FileSource =
  | { type: "url"; url: string }
  | { type: "base64"; media_type: string; data: string };

/** Build the document/image content block for a PDF or image source. */
function fileBlock(opts: {
  base64?: string;
  url?: string;
  mediaType?: string;
}): unknown | null {
  const source: FileSource | null = opts.url
    ? { type: "url", url: opts.url }
    : opts.base64 && opts.mediaType
      ? { type: "base64", media_type: opts.mediaType, data: opts.base64 }
      : null;
  if (!source || !opts.mediaType) return null;
  return opts.mediaType === "application/pdf"
    ? { type: "document", source }
    : { type: "image", source };
}

/**
 * One model call → raw text. Deterministic (temperature 0) for faithful
 * extraction. Sets lastExtractError on any failure and returns "".
 */
async function callModel(opts: {
  system: string;
  content: unknown[];
  maxTokens: number;
}): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    lastExtractError = "No AI key set (ANTHROPIC_API_KEY).";
    return "";
  }
  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || MODEL,
        max_tokens: opts.maxTokens,
        temperature: 0,
        system: opts.system,
        messages: [{ role: "user", content: opts.content }],
      }),
    });
  } catch {
    lastExtractError = "Couldn't reach the AI service.";
    return "";
  }
  if (!res.ok) {
    let reason = `AI error (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) reason = `AI error: ${body.error.message}`;
    } catch {
      /* ignore */
    }
    lastExtractError = reason;
    return "";
  }
  try {
    const json = (await res.json()) as { content?: AnthropicBlock[] };
    const text =
      json.content?.find((b) => b.type === "text")?.text?.trim() ?? "";
    if (!text) lastExtractError = "AI returned nothing.";
    return text;
  } catch {
    lastExtractError = "Couldn't read the AI response.";
    return "";
  }
}

/** Strip code fences and isolate the outermost JSON object, then parse it. */
function parseWholeObject(text: string): Record<string, unknown> | null {
  const cleaned = text
    .replace(/^```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Salvage every COMPLETE object inside the `"<key>": [ ... ]` array, even if
 * the response was truncated mid-stream (the last partial object is simply
 * dropped). String-aware brace matching, so braces inside values don't fool it.
 */
function salvageArray(text: string, key: string): Record<string, unknown>[] {
  const keyIdx = text.indexOf(`"${key}"`);
  const arrStart = text.indexOf("[", keyIdx >= 0 ? keyIdx : 0);
  if (arrStart < 0) return [];
  const out: Record<string, unknown>[] = [];
  let depth = 0;
  let objStart = -1;
  let inStr = false;
  let esc = false;
  for (let i = arrStart + 1; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && objStart >= 0) {
        try {
          out.push(JSON.parse(text.slice(objStart, i + 1)));
        } catch {
          /* skip a malformed object, keep the rest */
        }
        objStart = -1;
      }
    } else if (ch === "]" && depth === 0) {
      break;
    }
  }
  return out;
}

/** Parse `{ "<key>": [...] }` from a model response, tolerating truncation. */
function extractRows(text: string, key: string): Record<string, unknown>[] {
  if (!text) return [];
  const whole = parseWholeObject(text);
  if (whole && Array.isArray(whole[key])) {
    return (whole[key] as unknown[]).map(
      (it) => (it ?? {}) as Record<string, unknown>,
    );
  }
  // Full parse failed (often a truncated array) → recover what we can.
  return salvageArray(text, key);
}

// ---------------------------------------------------------------------------
// Coercion helpers
// ---------------------------------------------------------------------------

function coerceNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function coerceStr(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** Normalize a free-text unit into our canonical set. */
function normUnit(v: unknown): string {
  const u = (coerceStr(v) ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!u) return "sqft";
  if (u.startsWith("sy") || u.includes("yard") || u === "yd" || u === "yds")
    return "sqyd";
  if (u.includes("sf") || u.includes("sq") || u.includes("square")) return "sqft";
  if (u.includes("lf") || u.includes("lnft") || u.includes("linear") || u === "ft")
    return "lnft";
  if (
    u.startsWith("ea") || u === "each" || u === "pc" || u === "piece" ||
    u === "box" || u === "ctn" || u === "carton" || u === "roll"
  )
    return "each";
  return "sqft";
}

// ===========================================================================
// PRICE LISTS
// ===========================================================================

export interface PriceRow {
  name: string;
  category: string;
  unit: string;
  sku: string | null;
  material_rate: number | null;
  labor_rate: number | null;
  notes: string | null;
  manufacturer?: string | null;
  style?: string | null;
  color?: string | null;
}

const PRICE_SYSTEM = `You are an expert data-extraction engine for a flooring company (Cleveland Floor King). You read messy vendor PRICE LISTS — Excel/CSV exports, dealer cost sheets, scanned PDFs, and phone photos — and turn them into a clean, accurate product catalog.

These documents are FULL of noise and you must see through all of it: repeated page headers and column headers, section/category titles, legends and footnotes, freight/fuel/terms notes, page numbers, "effective date" banners, discontinued markers, and SKU/style codes jammed into product names. Extract only real, orderable products, and extract EVERY one of them.`;

const PRICE_SCHEMA = `Return ONLY a JSON object — no prose, no code fences:
{ "items": [ {
  "name": string,             // clean, human-readable: Manufacturer + Style/Collection + Color (NO raw codes)
  "manufacturer": string|null, // brand / mill (Shaw, Mohawk, Mannington, Daltile, ...)
  "style": string|null,        // collection / pattern / style NAME (a name, not a number)
  "color": string|null,        // color / colorway NAME
  "sku": string|null,          // item / style / SKU number or code
  "category": "carpet"|"lvp"|"hardwood"|"laminate"|"tile"|"vinyl"|"underlayment"|"trim"|"labor"|"other",
  "unit": "sqft"|"sqyd"|"lnft"|"each",
  "material_rate": number|null, // OUR per-unit cost (see PRICE rules), digits only — no $, no commas
  "labor_rate": number|null,    // only if the list separates labor; else null
  "notes": string|null          // size / coverage / width / warranty if shown (e.g. "7\\" x 48\\", 23.8 sf/box, 12' wide")
} ] }

PRICE — pick OUR cost, never retail:
- If a row shows MULTIPLE prices, choose the dealer/net/your-cost one. Prefer, in order:
  "Your Cost" → "Dealer" → "Net" → "Cost" → "Unit Cost"  OVER  "MSRP" / "Retail" / "List" / a generic "Price".
- The price is PER UNIT, never the extended/line total. Strip $ and commas → a plain number.
- If priced per box/carton with a coverage (sf/box), record the price AS SHOWN and put the coverage in notes. Do NOT invent a per-sqft conversion.

UNIT:
- carpet & pad → "sqyd" (per SY) unless the sheet clearly prices per SF.
- planks / boards / tile → "sqft".  trim / molding / transitions → "lnft".  accessories → "each".
- Honor the sheet's own unit-of-measure column when present.

NAME & FIELDS — separate signal from codes:
- Build "name" so a person reads it cleanly: e.g. "Shaw Coretec Plus HD — Honey Oak". Keep raw item/style NUMBERS out of "name" (put them in "sku").
- Put the color NAME in "color", the collection/pattern NAME in "style", the brand in "manufacturer", the number/code in "sku".
- Use null for anything not present. NEVER invent a brand, color, style, or price.

CATEGORY — infer from the product: LVP/LVT/SPC/WPC/rigid core → lvp; broadloom → carpet; engineered/solid wood → hardwood; ceramic/porcelain → tile; sheet vinyl → vinyl; pad/cushion/underlayment → underlayment; molding/transition/base/reducer → trim; install/labor → labor; otherwise other.

IGNORE non-products: page/column headers, section titles, totals, legends, freight/fuel/terms notes, addresses, page numbers, and blank lines. (A product marked "discontinued" is still a product — include it and note it.)

Be exhaustive and precise. Return every real product row.`;

/** Map a raw model object → a clean PriceRow (keeps brand/style/color). */
function toPriceRow(o: Record<string, unknown>): PriceRow {
  return {
    name: coerceStr(o.name) ?? "",
    category: coerceStr(o.category) ?? "other",
    unit: normUnit(o.unit),
    sku: coerceStr(o.sku),
    material_rate: coerceNum(o.material_rate),
    labor_rate: coerceNum(o.labor_rate),
    manufacturer: coerceStr(o.manufacturer),
    style: coerceStr(o.style),
    color: coerceStr(o.color),
    notes: coerceStr(o.notes),
  };
}

/** Parse a price list (pasted text, a URL, OR base64 PDF/image) into products. */
export async function extractPriceList(opts: {
  text?: string;
  base64?: string;
  url?: string;
  mediaType?: string;
}): Promise<PriceRow[] | null> {
  lastExtractError = null;
  if (!process.env.ANTHROPIC_API_KEY) {
    lastExtractError = "No AI key set (ANTHROPIC_API_KEY).";
    return null;
  }

  const content: unknown[] = [];
  const block = fileBlock(opts);
  if (block) {
    content.push(block);
    content.push({ type: "text", text: PRICE_SCHEMA });
  } else if (opts.text) {
    content.push({
      type: "text",
      text: `${PRICE_SCHEMA}\n\nPRICE LIST:\n${opts.text}`,
    });
  } else {
    return null;
  }

  const text = await callModel({
    system: PRICE_SYSTEM,
    content,
    maxTokens: 16000,
  });
  if (!text) return null;
  const rows = extractRows(text, "items").map(toPriceRow).filter((r) => r.name);
  return rows;
}

// ===========================================================================
// ORDER CONFIRMATIONS / INVOICES / BILLS OF LADING
// ===========================================================================

export interface ExtractedItem {
  description: string;
  manufacturer: string | null;
  style: string | null;
  color: string | null;
  item_no: string | null;
  quantity: number | null;
  unit: string | null;
  unit_cost: number | null;
}

export interface ExtractedDoc {
  vendor: string | null;
  order_number: string | null;
  order_date: string | null;
  eta_date: string | null;
  items: ExtractedItem[];
  total: number | null;
}

const ORDER_SYSTEM = `You are an expert at reading flooring PURCHASING PAPERWORK for a flooring company: vendor order confirmations, sales orders, invoices, packing slips, and bills of lading (BOL). You pull the order and its line items out accurately and ignore boilerplate, terms, and addresses.`;

const ORDER_SCHEMA = `Return ONLY a JSON object (no prose, no code fences):
{
  "vendor": string|null,        // supplier / mill / shipper company name
  "order_number": string|null,  // PO / order / invoice number — for a bill of lading use the BOL or PRO number
  "order_date": "YYYY-MM-DD"|null,
  "eta_date": "YYYY-MM-DD"|null, // expected ship / delivery / arrival date if shown
  "items": [
    {
      "description": string,
      "manufacturer": string|null,
      "style": string|null,
      "color": string|null,
      "item_no": string|null,
      "quantity": number|null,
      "unit": string|null,
      "unit_cost": number|null
    }
  ],
  "total": number|null
}
- Map flooring fields: style/pattern → style, color/colorway → color, item/SKU/product# → item_no, brand/mill → manufacturer.
- quantity is the ordered/shipped amount; unit_cost is PER UNIT (not the extended/line total). Strip $ and commas.
- A bill of lading or packing slip may have NO prices — that's fine: capture pieces/cartons/rolls as quantity and leave unit_cost null.
- Ignore terms, legalese, remit-to/ship-to addresses, and boilerplate. Extract every real product line. Use null when unknown.`;

function toExtractedItem(o: Record<string, unknown>): ExtractedItem {
  return {
    description: coerceStr(o.description) ?? "",
    manufacturer: coerceStr(o.manufacturer),
    style: coerceStr(o.style),
    color: coerceStr(o.color),
    item_no: coerceStr(o.item_no),
    quantity: coerceNum(o.quantity),
    unit: coerceStr(o.unit),
    unit_cost: coerceNum(o.unit_cost),
  };
}

export async function extractOrderDocument(opts: {
  base64: string;
  mediaType: string;
}): Promise<ExtractedDoc | null> {
  lastExtractError = null;
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const block = fileBlock(opts);
  if (!block) return null;

  const text = await callModel({
    system: ORDER_SYSTEM,
    content: [block, { type: "text", text: ORDER_SCHEMA }],
    maxTokens: 8000,
  });
  if (!text) return null;

  const whole = parseWholeObject(text);
  const items = extractRows(text, "items")
    .map(toExtractedItem)
    .filter((it) => it.description || it.item_no || it.style);

  // If even the items couldn't be salvaged and there's no header, bail.
  if (!whole && !items.length) return null;

  return {
    vendor: coerceStr(whole?.vendor),
    order_number: coerceStr(whole?.order_number),
    order_date: coerceStr(whole?.order_date),
    eta_date: coerceStr(whole?.eta_date),
    items,
    total: coerceNum(whole?.total),
  };
}

// ===========================================================================
// JOB NOTES → STRUCTURED ESTIMATE  (typed text OR a photo of handwritten notes)
// ===========================================================================

export interface NotesRoom {
  name: string | null;
  type: string; // carpet | lvp | hardwood | laminate | tile | vinyl
  length_ft: number;
  length_in: number;
  width_ft: number;
  width_in: number;
  sqft: number | null; // if an area was written directly instead of L×W
  material: string | null; // product/term to match the catalog
  material_cost: number | null; // any per-unit material price written on the notes
  labor_cost: number | null; // any per-unit install/labor price written on the notes
  pad_cost: number | null; // any per-unit pad price written on the notes
  install: boolean;
  pad: boolean;
  notes: string | null;
}
export interface NotesAddon {
  label: string;
  labor: boolean;
  qty: number | null;
  unit: string | null;
  cost: number | null;
}
export interface NotesJob {
  title: string | null;
  rooms: NotesRoom[];
  addons: NotesAddon[];
}

const NOTES_SYSTEM = `You are an expert flooring estimator for Cleveland Floor King. You read a salesperson's rough job notes — typed, or a PHOTO of handwriting on a measure sheet — and turn them into a clean structured estimate. Measurements are messy and abbreviated (e.g. "LR 15'6 x 12", "MBR 12x14 carpet", "hall 3x12 LVP", "tearout + haul", "13 steps", "T-mold x2"). Read them like a flooring pro.`;

const NOTES_SCHEMA = `Return ONLY a JSON object (no prose, no code fences):
{
  "title": string|null,
  "rooms": [ {
    "name": string|null,            // room name ("Living room", "MBR", "Hall")
    "type": "carpet"|"lvp"|"hardwood"|"laminate"|"tile"|"vinyl",
    "length_ft": number, "length_in": number,   // split feet & inches (15'6" → 15 and 6)
    "width_ft": number,  "width_in": number,
    "sqft": number|null,            // only if an area is written directly (no L×W)
    "material": string|null,        // product/brand/style if noted (to match the catalog)
    "material_cost": number|null,   // ANY per-unit material price written for this room (see PRICES rule)
    "labor_cost": number|null,      // ANY per-unit install/labor price written for this room
    "pad_cost": number|null,        // ANY per-unit pad price written for this room
    "install": boolean,             // true unless the notes say material-only
    "pad": boolean,                 // carpet pad — true for carpet unless noted otherwise
    "notes": string|null
  } ],
  "addons": [ { "label": string, "labor": boolean, "qty": number|null, "unit": string|null, "cost": number|null } ]
}
Rules:
- One entry per room. Split every measurement into feet + inches. If only an area is given, use sqft and leave L×W at 0.
- "type": infer from the notes (broadloom→carpet, plank/LVP/LVT/SPC→lvp, engineered/solid/wood→hardwood, ceramic/porcelain→tile, sheet→vinyl).
- PRICES — capture EVERY price the notes show: a number next to a material ("$3.50", "3.50/sf", "$18 yd", "carpet 22") → material_cost; an install/labor price ("install $2", "lab 1.50") → labor_cost; a pad price ("pad $4") → pad_cost; an add-on price → that add-on's cost. Strip $ and units to a plain number. Don't guess prices that aren't written, but never skip a price that IS written.
- "addons": the extra work mentioned for the WHOLE job — tear-out & haul-away, floor prep, stairs, transitions/T-mold/metals, furniture, toilet pull, etc. Mark labor:true for work, labor:false for materials/metals. Only include what the notes mention.
- Never invent prices. Use null for anything not written.`;

/** Read job notes (typed text OR a photo) into a structured estimate. */
export async function extractJobFromNotes(opts: {
  text?: string;
  base64?: string;
  url?: string;
  mediaType?: string;
}): Promise<NotesJob | null> {
  lastExtractError = null;
  if (!process.env.ANTHROPIC_API_KEY) {
    lastExtractError = "No AI key set (ANTHROPIC_API_KEY).";
    return null;
  }

  const content: unknown[] = [];
  const block = fileBlock(opts);
  if (block) {
    content.push(block);
    content.push({ type: "text", text: `Read these job notes. ${NOTES_SCHEMA}` });
  } else if (opts.text) {
    content.push({ type: "text", text: `${NOTES_SCHEMA}\n\nJOB NOTES:\n${opts.text}` });
  } else {
    return null;
  }

  const text = await callModel({ system: NOTES_SYSTEM, content, maxTokens: 4000 });
  if (!text) return null;
  const whole = parseWholeObject(text);

  const numv = (v: unknown) => coerceNum(v) ?? 0;
  const rawRooms = whole && Array.isArray(whole.rooms)
    ? (whole.rooms as unknown[])
    : salvageArray(text, "rooms");
  const rooms: NotesRoom[] = rawRooms
    .map((it) => {
      const o = (it ?? {}) as Record<string, unknown>;
      return {
        name: coerceStr(o.name),
        type: (coerceStr(o.type) ?? "lvp").toLowerCase(),
        length_ft: numv(o.length_ft),
        length_in: numv(o.length_in),
        width_ft: numv(o.width_ft),
        width_in: numv(o.width_in),
        sqft: coerceNum(o.sqft),
        material: coerceStr(o.material),
        material_cost: coerceNum(o.material_cost),
        labor_cost: coerceNum(o.labor_cost),
        pad_cost: coerceNum(o.pad_cost),
        install: o.install !== false,
        pad: o.pad !== false,
        notes: coerceStr(o.notes),
      } satisfies NotesRoom;
    })
    .filter((r) => r.length_ft || r.width_ft || (r.sqft ?? 0) > 0 || r.material);

  const rawAddons = whole && Array.isArray(whole.addons)
    ? (whole.addons as unknown[])
    : salvageArray(text, "addons");
  const addons: NotesAddon[] = rawAddons
    .map((it) => {
      const o = (it ?? {}) as Record<string, unknown>;
      return {
        label: coerceStr(o.label) ?? "",
        labor: o.labor !== false,
        qty: coerceNum(o.qty),
        unit: coerceStr(o.unit),
        cost: coerceNum(o.cost),
      } satisfies NotesAddon;
    })
    .filter((a) => a.label);

  if (!rooms.length && !addons.length) return null;
  return { title: coerceStr(whole?.title), rooms, addons };
}

// ===========================================================================
// CUSTOMER LISTS
// ===========================================================================

export interface ClientRow {
  full_name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

const CLIENT_SYSTEM = `You read customer/contact lists for a flooring company and turn them into clean contact records, separating people from companies and splitting mailing addresses.`;

const CLIENT_SCHEMA = `Return ONLY a JSON object (no prose, no code fences):
{ "clients": [ { "full_name": string, "company": string|null, "email": string|null,
  "phone": string|null, "street": string|null, "city": string|null,
  "state": string|null, "zip": string|null } ] }
- One entry per customer. Separate a person's name from a company name.
- Split mailing addresses into street / city / state / zip.
- Keep phone digits/format as given. Skip header rows and blank lines.`;

/** Parse a client/customer list (pasted text OR a PDF/image) into customers. */
export async function extractClients(opts: {
  text?: string;
  base64?: string;
  url?: string;
  mediaType?: string;
}): Promise<ClientRow[] | null> {
  lastExtractError = null;
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const content: unknown[] = [];
  const block = fileBlock(opts);
  if (block) {
    content.push(block);
    content.push({ type: "text", text: CLIENT_SCHEMA });
  } else if (opts.text) {
    content.push({
      type: "text",
      text: `${CLIENT_SCHEMA}\n\nLIST:\n${opts.text}`,
    });
  } else {
    return null;
  }

  const text = await callModel({
    system: CLIENT_SYSTEM,
    content,
    maxTokens: 16000,
  });
  if (!text) return null;

  return extractRows(text, "clients")
    .map((o) => ({
      full_name: coerceStr(o.full_name) ?? "",
      company: coerceStr(o.company),
      email: coerceStr(o.email),
      phone: coerceStr(o.phone),
      street: coerceStr(o.street),
      city: coerceStr(o.city),
      state: coerceStr(o.state),
      zip: coerceStr(o.zip),
    }))
    .filter((c) => c.full_name || c.company || c.email || c.phone);
}
