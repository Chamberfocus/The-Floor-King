"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { extractOrderDocument } from "@/lib/extract";
import type { ExpenseCategory } from "@/lib/types";

export interface ExpenseFormState {
  error: string | null;
  ok?: boolean;
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function createExpense(
  _prev: ExpenseFormState,
  formData: FormData,
): Promise<ExpenseFormState> {
  const amount = parseFloat(str(formData.get("amount")));
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Enter a valid amount." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("expenses").insert({
    date: str(formData.get("date")) || new Date().toISOString().slice(0, 10),
    category: (str(formData.get("category")) || "other") as ExpenseCategory,
    amount,
    vendor: str(formData.get("vendor")) || null,
    note: str(formData.get("note")) || null,
    job_id: str(formData.get("job_id")) || null,
    created_by: user?.id ?? null,
  });
  if (error) return { error: error.message };

  revalidatePath("/financials/expenses");
  revalidatePath("/financials");
  return { error: null, ok: true };
}

export interface BillExtractResult {
  error: string | null;
  data?: { vendor: string | null; amount: number | null; date: string | null };
}

/** Smart uploader: read a vendor bill and return fields to pre-fill an expense. */
export async function extractBillDocument(
  formData: FormData,
): Promise<BillExtractResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }
  if (file.size > 20 * 1024 * 1024) {
    return { error: "File is too large (max 20 MB)." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "application/octet-stream";
  const path = `bill/${crypto.randomUUID()}-${file.name}`;

  await supabase.storage
    .from("documents")
    .upload(path, bytes, { contentType: mime });

  const ex = await extractOrderDocument({
    base64: bytes.toString("base64"),
    mediaType: mime,
  });

  await supabase.from("documents").insert({
    uploaded_by: user?.id ?? null,
    name: file.name,
    path,
    mime,
    kind: "bill",
    extracted: ex ?? null,
  });

  if (!ex) {
    return {
      error:
        "Couldn't read that bill automatically. The file is saved — enter the details manually, or set ANTHROPIC_API_KEY.",
    };
  }
  return {
    error: null,
    data: { vendor: ex.vendor, amount: ex.total, date: ex.order_date },
  };
}

export async function deleteExpense(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("expenses").delete().eq("id", id);
  revalidatePath("/financials/expenses");
  revalidatePath("/financials");
}
