"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { extractOrderDocument } from "@/lib/extract";
import type { ExpenseCategory } from "@/lib/types";
import {
  DIRECT_EXPENSE_IDEMPOTENCY_REQUIRED_MESSAGE,
  resolveDirectExpenseIdempotencyKey,
} from "@/lib/financial-idempotency";

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
  if (str(formData.get("ack_unlinked")) !== "yes") {
    return {
      error:
        "Confirm this is an already-paid cash/card expense — not a vendor bill you still owe.",
    };
  }

  const idem = resolveDirectExpenseIdempotencyKey(
    str(formData.get("idempotency_key")),
  );
  if (!idem) return { error: DIRECT_EXPENSE_IDEMPOTENCY_REQUIRED_MESSAGE };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const { data, error } = await supabase.rpc("record_direct_expense_safe", {
    p_date: str(formData.get("date")) || new Date().toISOString().slice(0, 10),
    p_category: (str(formData.get("category")) || "other") as ExpenseCategory,
    p_amount: amount,
    p_vendor: str(formData.get("vendor")) || null,
    p_note: str(formData.get("note")) || null,
    p_job_id: str(formData.get("job_id")) || null,
    p_bill_id: null,
    p_created_by: user.id,
    p_idempotency_key: idem,
    p_supplier_id: null,
    p_vendor_invoice_ref: str(formData.get("vendor_invoice")) || null,
    p_ack_unlinked: true,
  });
  if (error) return { error: error.message };
  const res = data as { ok?: boolean; error?: string; skipped?: boolean };
  if (res?.ok === false) return { error: res.error || "Could not record expense." };
  if (res?.skipped) {
    return { error: "That cost belongs on a vendor bill, not a direct expense." };
  }

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

export async function deleteExpense(_formData: FormData): Promise<void> {
  // F6-P3B: authenticated DELETE on expenses is revoked. Expense reversal is
  // deferred — financial history must not be hard-deleted from the UI.
  return;
}
