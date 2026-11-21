"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/auth";
import { createLogin } from "@/lib/auth-admin";

export interface PriceBookFormState {
  error: string | null;
  ok?: boolean;
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function marginOf(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n >= 100) return null;
  return Math.round(n * 1000) / 1000;
}

async function requireAdmin() {
  const me = await getProfile();
  if (me?.role !== "admin") return null;
  return me;
}

export async function createPriceBookLogin(
  _prev: PriceBookFormState,
  formData: FormData,
): Promise<PriceBookFormState> {
  if (!(await requireAdmin())) return { error: "Only an administrator can add a price-book login." };
  const margin = marginOf(str(formData.get("margin_pct")));
  if (margin == null) return { error: "Enter a margin from 0 up to, but not including, 100." };
  const { userId, error } = await createLogin({
    email: str(formData.get("email")),
    phone: str(formData.get("phone")),
    password: str(formData.get("password")),
    fullName: str(formData.get("full_name")),
    role: "customer",
    title: "Price book",
  });
  if (error || !userId) return { error: error ?? "Could not create the login." };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { error: "Creating logins needs the Supabase secret key on the server." };
  }
  const { error: accessError } = await admin.from("price_book_access").insert({
    profile_id: userId,
    margin_pct: margin,
    active: true,
  });
  if (accessError) {
    await admin.auth.admin.deleteUser(userId);
    return {
      error: accessError.message.includes("price_book_access")
        ? "Run the price-book SQL in Supabase, then create the login again."
        : accessError.message,
    };
  }
  revalidatePath("/settings/price-book");
  return { error: null, ok: true };
}

export async function updatePriceBookMargin(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const id = str(formData.get("profile_id"));
  const margin = marginOf(str(formData.get("margin_pct")));
  if (!id || margin == null) return;
  const admin = createAdminClient();
  await admin
    .from("price_book_access")
    .update({ margin_pct: margin, updated_at: new Date().toISOString() })
    .eq("profile_id", id);
  revalidatePath("/settings/price-book");
}

export async function setPriceBookActive(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const id = str(formData.get("profile_id"));
  if (!id) return;
  const active = str(formData.get("active")) === "true";
  const admin = createAdminClient();
  await admin
    .from("price_book_access")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("profile_id", id);
  revalidatePath("/settings/price-book");
}
