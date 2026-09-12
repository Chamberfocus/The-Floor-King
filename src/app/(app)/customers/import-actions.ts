"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { extractClients, type ClientRow } from "@/lib/extract";
import {
  previewCustomerImport,
  resolveOrCreateCustomer,
} from "@/lib/data/customer-resolve";
import type {
  ClassifiedImportRow,
  MatchCandidateInput,
} from "@/lib/customer-resolve";

export type { ClassifiedImportRow };

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
  const storagePath = str(formData.get("storage_path"));
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);

  if (storagePath) {
    if (!hasKey)
      return {
        error:
          "Reading a file needs the AI key. Paste the rows as text instead.",
      };
    const supabase = await createClient();
    const { data: signed } = await supabase.storage
      .from("documents")
      .createSignedUrl(storagePath, 600);
    if (!signed?.signedUrl)
      return { error: "Couldn't open the uploaded file." };
    const mediaType =
      str(formData.get("storage_mime")) ||
      (storagePath.toLowerCase().endsWith(".pdf")
        ? "application/pdf"
        : "image/jpeg");
    const rows = await extractClients({
      url: signed.signedUrl,
      mediaType,
    });
    if (!rows || !rows.length)
      return { error: "Couldn't read that file — try pasting the rows as text." };
    return { error: null, rows };
  }

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
  summary?: {
    new: number;
    matchedExisting: number;
    possibleDuplicates: number;
    invalid: number;
  };
}

function rowToInput(r: ClientRow): MatchCandidateInput {
  return {
    fullName: (r.full_name || r.company || "").trim(),
    company: r.company,
    email: r.email,
    phone: r.phone,
    address: r.street,
    city: r.city,
    state: r.state,
    zip: r.zip,
  };
}

export async function previewImportClients(rows: ClientRow[]) {
  const valid = (rows ?? []).filter(
    (r) => r.full_name?.trim() || r.company?.trim(),
  );
  return previewCustomerImport(valid.map(rowToInput));
}

/** Insert NEW rows only. Matched existing and possible duplicates are skipped
 *  unless `createPossible` is explicitly set. Never updates existing records. */
export async function importClients(
  rows: ClientRow[],
  opts: { createPossible?: boolean } = {},
): Promise<ImportClientsResult> {
  const valid = (rows ?? []).filter(
    (r) => r.full_name?.trim() || r.company?.trim(),
  );
  if (!valid.length) return { error: "Nothing to import." };

  const preview = await previewCustomerImport(valid.map(rowToInput));
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let count = 0;
  for (const row of preview.classified) {
    if (row.class === "MATCHED_EXISTING" || row.class === "INVALID") continue;
    if (row.class === "POSSIBLE_DUPLICATE" && !opts.createPossible) continue;
    if (row.class !== "NEW" && !(row.class === "POSSIBLE_DUPLICATE" && opts.createPossible)) {
      continue;
    }
    const src = valid[row.index];
    if (!src) continue;
    const resolved = await resolveOrCreateCustomer({
      input: row.input,
      insert: {
        full_name: (src.full_name || src.company || "Customer").trim(),
        company: src.company || null,
        email: src.email || null,
        phone: src.phone || null,
        street: src.street || null,
        city: src.city || null,
        state: src.state || null,
        zip: src.zip || null,
        stage: "new",
        created_by: user?.id ?? null,
        assigned_to: user?.id ?? null,
      },
      forceCreate: row.class === "POSSIBLE_DUPLICATE",
      overrideReason:
        row.class === "POSSIBLE_DUPLICATE" ? "Import: staff accepted possible duplicate" : null,
    });
    if (resolved.action === "created") count += 1;
  }

  revalidatePath("/customers");
  return { error: null, count, summary: preview.summary };
}
