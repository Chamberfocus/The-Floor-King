/**
 * Smart document extraction via the Anthropic API.
 * Reads an order confirmation / vendor bill (PDF or image) and returns
 * structured line items ready to drop into a purchase order.
 * No-ops (returns null) until ANTHROPIC_API_KEY is set.
 */

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

const SCHEMA_HINT = `Return ONLY a JSON object (no prose, no code fences) shaped exactly like:
{
  "vendor": string|null,
  "order_number": string|null,
  "order_date": "YYYY-MM-DD"|null,
  "eta_date": "YYYY-MM-DD"|null,
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
Extract every product line. Map flooring fields carefully: "style"/"pattern" -> style,
"color"/"colorway" -> color, "item"/"SKU"/"product #" -> item_no, brand/mill -> manufacturer.
unit_cost is the per-unit price (not the extended total). Use null when unknown.`;

interface AnthropicBlock {
  type: string;
  text?: string;
}

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
  return null;
}

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
  mediaType?: string;
}): Promise<ClientRow[] | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const content: unknown[] = [];
  if (opts.base64 && opts.mediaType) {
    const source = { type: "base64", media_type: opts.mediaType, data: opts.base64 };
    content.push(
      opts.mediaType === "application/pdf"
        ? { type: "document", source }
        : { type: "image", source },
    );
    content.push({ type: "text", text: `Read this customer list. ${CLIENT_SCHEMA}` });
  } else if (opts.text) {
    content.push({
      type: "text",
      text: `Parse this customer list. ${CLIENT_SCHEMA}\n\nLIST:\n${opts.text}`,
    });
  } else {
    return null;
  }

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 8000,
        messages: [{ role: "user", content }],
      }),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const json = (await res.json()) as { content?: AnthropicBlock[] };
  const text = json.content?.find((b) => b.type === "text")?.text?.trim() ?? "";
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  let parsed: { clients?: unknown };
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
  const raw = Array.isArray(parsed.clients) ? parsed.clients : [];
  return raw
    .map((it) => {
      const o = (it ?? {}) as Record<string, unknown>;
      return {
        full_name: coerceStr(o.full_name) ?? "",
        company: coerceStr(o.company),
        email: coerceStr(o.email),
        phone: coerceStr(o.phone),
        street: coerceStr(o.street),
        city: coerceStr(o.city),
        state: coerceStr(o.state),
        zip: coerceStr(o.zip),
      } satisfies ClientRow;
    })
    .filter((c) => c.full_name || c.company || c.email || c.phone);
}

export interface PriceRow {
  name: string;
  category: string;
  unit: string;
  sku: string | null;
  material_rate: number | null;
  labor_rate: number | null;
  notes: string | null;
}

const PRICE_SCHEMA = `Return ONLY a JSON object (no prose, no code fences):
{ "items": [ { "name": string, "category": string, "unit": string,
  "sku": string|null, "material_rate": number|null, "labor_rate": number|null,
  "notes": string|null } ] }
- category MUST be one of: carpet, lvp, hardwood, laminate, tile, vinyl,
  underlayment, trim, labor, other  (infer from the product name/description).
- unit: "sqft" for most; "sqyd" for carpet; "lnft" for trim/molding; else best guess.
- material_rate is the per-unit PRICE/cost from the list (a number only, no $).
- labor_rate only if the list separates labor; otherwise null.
- sku is the item/style/SKU number if present.
Extract every product row. Skip headers, totals, and blank lines.`;

/** Parse a price list (pasted text OR a PDF/image) into catalog products. */
export async function extractPriceList(opts: {
  text?: string;
  base64?: string;
  mediaType?: string;
}): Promise<PriceRow[] | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const content: unknown[] = [];
  if (opts.base64 && opts.mediaType) {
    const source = {
      type: "base64",
      media_type: opts.mediaType,
      data: opts.base64,
    };
    content.push(
      opts.mediaType === "application/pdf"
        ? { type: "document", source }
        : { type: "image", source },
    );
    content.push({ type: "text", text: `Read this flooring price list. ${PRICE_SCHEMA}` });
  } else if (opts.text) {
    content.push({
      type: "text",
      text: `Parse this flooring price list. ${PRICE_SCHEMA}\n\nPRICE LIST:\n${opts.text}`,
    });
  } else {
    return null;
  }

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 8000,
        messages: [{ role: "user", content }],
      }),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const json = (await res.json()) as { content?: AnthropicBlock[] };
  const text = json.content?.find((b) => b.type === "text")?.text?.trim() ?? "";
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  let parsed: { items?: unknown };
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  return rawItems
    .map((it) => {
      const o = (it ?? {}) as Record<string, unknown>;
      return {
        name: coerceStr(o.name) ?? "",
        category: coerceStr(o.category) ?? "other",
        unit: coerceStr(o.unit) ?? "sqft",
        sku: coerceStr(o.sku),
        material_rate: coerceNum(o.material_rate),
        labor_rate: coerceNum(o.labor_rate),
        notes: coerceStr(o.notes),
      } satisfies PriceRow;
    })
    .filter((r) => r.name);
}

export async function extractOrderDocument(opts: {
  base64: string;
  mediaType: string;
}): Promise<ExtractedDoc | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const isPdf = opts.mediaType === "application/pdf";
  const source = {
    type: "base64",
    media_type: opts.mediaType,
    data: opts.base64,
  };
  const fileBlock = isPdf
    ? { type: "document", source }
    : { type: "image", source };

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              fileBlock,
              {
                type: "text",
                text: `You are extracting a flooring purchase/order document. ${SCHEMA_HINT}`,
              },
            ],
          },
        ],
      }),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const json = (await res.json()) as { content?: AnthropicBlock[] };
  const text =
    json.content?.find((b) => b.type === "text")?.text?.trim() ?? "";
  if (!text) return null;

  // Strip any stray code fences and isolate the JSON object.
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }

  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const items: ExtractedItem[] = rawItems
    .map((it) => {
      const o = (it ?? {}) as Record<string, unknown>;
      return {
        description: coerceStr(o.description) ?? "",
        manufacturer: coerceStr(o.manufacturer),
        style: coerceStr(o.style),
        color: coerceStr(o.color),
        item_no: coerceStr(o.item_no),
        quantity: coerceNum(o.quantity),
        unit: coerceStr(o.unit),
        unit_cost: coerceNum(o.unit_cost),
      } satisfies ExtractedItem;
    })
    .filter((it) => it.description || it.item_no || it.style);

  return {
    vendor: coerceStr(parsed.vendor),
    order_number: coerceStr(parsed.order_number),
    order_date: coerceStr(parsed.order_date),
    eta_date: coerceStr(parsed.eta_date),
    items,
    total: coerceNum(parsed.total),
  };
}
