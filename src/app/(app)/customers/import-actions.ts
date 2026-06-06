"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { extractClients, type ClientRow } from "@/lib/extract";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

export interface ParseClientsResult {
  error: string | null;
  rows?: ClientRow[];
}

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE_RE = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;

/** Plain-text fallback (no AI): one customer per line. */
function parseClientText(text: string): ClientRow[] {
  const rows: ClientRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cells = line.includes("\t")
      ? line.split("\t").map((c) => c.trim())
      : line.includes(",")
        ? line.split(",").map((c) => c.trim())
        : null;
    let email: string | null = null;
    let phone: string | null = null;
    let name = "";
    if (cells && cells.length > 1) {
      email = cells.find((c) => EMAIL_RE.test(c)) ?? null;
      phone = cells.find((c) => PHONE_RE.test(c)) ?? null;
      name = cells[0] || "";
    } else {
      email = line.match(EMAIL_RE)?.[0] ?? null;
      phone = line.match(PHONE_RE)?.[0] ?? null;
      name = line
        .replace(EMAIL_RE, " ")
        .replace(PHONE_RE, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
    }
    if (!name && !email && !phone) continue;
    rows.push({
      full_name: name || email || phone || "Customer",
      company: null,
      email,
      phone,
      street: null,
      city: null,
      state: null,
      zip: null,
    });
  }
  return rows;
}

export async function parseClients(
  formData: FormData,
): Promise<ParseClientsResult> {
  const text = str(formData.get("text"));
  const file = formData.get("file");
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);

  if (file instanceof File && file.size > 0) {
    if (file.size > 20 * 1024 * 1024) return { error: "File too large (max 20 MB)." };
    if (!hasKey)
      return {
        error:
          "Reading a file needs the AI key. For now, paste the rows as text instead.",
      };
    const bytes = Buffer.from(await file.arrayBuffer());
    const rows = await extractClients({
      base64: bytes.toString("base64"),
      mediaType: file.type || "application/octet-stream",
    });
    if (!rows || !rows.length)
      return { error: "Couldn't read that file — try pasting the rows as text." };
    return { error: null, rows };
  }

  if (text) {
    let rows = hasKey ? await extractClients({ text }) : null;
    if (!rows || !rows.length) rows = parseClientText(text);
    if (!rows.length) return { error: "No customers found in that text." };
    return { error: null, rows };
  }

  return { error: "Paste a client list or choose a file." };
}

export interface ImportClientsResult {
  error: string | null;
  count?: number;
}

/** Insert-only: never updates or deletes existing customers. */
export async function importClients(
  rows: ClientRow[],
): Promise<ImportClientsResult> {
  const valid = (rows ?? []).filter(
    (r) => r.full_name?.trim() || r.company?.trim(),
  );
  if (!valid.length) return { error: "Nothing to import." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const insertRows = valid.map((r) => ({
    full_name: (r.full_name || r.company || "Customer").trim(),
    company: r.company || null,
    email: r.email || null,
    phone: r.phone || null,
    street: r.street || null,
    city: r.city || null,
    state: r.state || null,
    zip: r.zip || null,
    stage: "new",
    created_by: user?.id ?? null,
    assigned_to: user?.id ?? null,
  }));

  const { error } = await supabase.from("customers").insert(insertRows);
  if (error) return { error: error.message };

  revalidatePath("/customers");
  return { error: null, count: insertRows.length };
}
