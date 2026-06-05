"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
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

export async function deleteExpense(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("expenses").delete().eq("id", id);
  revalidatePath("/financials/expenses");
  revalidatePath("/financials");
}
