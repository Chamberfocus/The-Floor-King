"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/auth-admin";
import { phoneLookupValues } from "@/lib/customer-duplicate";
import { loginFailureMessage } from "@/lib/login-failure";

export interface LoginState {
  error: string | null;
}

function safeNext(next: FormDataEntryValue | null): string {
  const value = typeof next === "string" ? next : "";
  // Only allow internal redirects (avoid open-redirect via the `next` param).
  // Default to "/", which routes each role to its own home (customer list for
  // office/sales, /jobs for scheduler, /installer for crew, /warehouse for
  // warehouse) — so login lands where the role belongs, not a fixed dashboard.
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

async function profileExists(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  return !error && !!data;
}

export async function login(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return { error: loginFailureMessage(error) };
  }
  if (!(await profileExists(data.user.id))) {
    await supabase.auth.signOut();
    return {
      error: "This login has no profile, so the app can't open it. Ask an admin to restore the account.",
    };
  }

  revalidatePath("/", "layout");
  redirect(next);
}

/** Sign in with phone number + PIN (for field/office staff without email). */
export async function loginWithPhone(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  const pin = String(formData.get("pin") ?? "");
  const next = safeNext(formData.get("next"));

  if (!phone || !pin) return { error: "Enter your phone number and PIN." };

  // Look up the login's email by phone (service role), then sign in normally.
  // The stored value may be digits or 216-555-1212 — both are the same number.
  let email: string | null = null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("profiles")
      .select("email, phone")
      .in("phone", phoneLookupValues(phone));
    if (error) return { error: "Phone sign-in isn't available right now." };
    const hits = (data ?? []).filter(
      (row) => normalizePhone(String(row.phone ?? "")) === phone && row.email,
    );
    if (hits.length > 1) {
      return {
        error: "That phone number is on more than one login. Ask an admin to fix it.",
      };
    }
    email = (hits[0]?.email as string | undefined) ?? null;
  } catch {
    return { error: "Phone sign-in isn't available right now." };
  }
  if (!email) return { error: "No login found for that phone number." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: pin,
  });
  if (error || !data.user) {
    const message = loginFailureMessage(error);
    return {
      error: message.startsWith("Incorrect email")
        ? "Incorrect phone number or PIN. Please try again."
        : message,
    };
  }
  if (!(await profileExists(data.user.id))) {
    await supabase.auth.signOut();
    return {
      error: "This login has no profile, so the app can't open it. Ask an admin to restore the account.",
    };
  }

  revalidatePath("/", "layout");
  redirect(next);
}
