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
