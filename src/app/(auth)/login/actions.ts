"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface LoginState {
  error: string | null;
}

function digits(raw: string): string {
  let d = (raw || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d;
}

function safeNext(next: FormDataEntryValue | null): string {
  const value = typeof next === "string" ? next : "";
  // Only allow internal redirects (avoid open-redirect via the `next` param).
  // Default to "/", which routes each role to its own home (customer list for
  // office/sales, /jobs for scheduler, /installer for crew, /warehouse for
  // warehouse) — so login lands where the role belongs, not a fixed dashboard.
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export async function login(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "Incorrect email or password. Please try again." };
  }

  revalidatePath("/", "layout");
  redirect(next);
}

/** Sign in with phone number + PIN (for field/office staff without email). */
export async function loginWithPhone(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const phone = digits(String(formData.get("phone") ?? ""));
  const pin = String(formData.get("pin") ?? "");
  const next = safeNext(formData.get("next"));

  if (!phone || !pin) return { error: "Enter your phone number and PIN." };

  // Look up the login's email by phone (service role), then sign in normally.
  let email: string | null = null;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("profiles")
      .select("email")
      .eq("phone", phone)
      .maybeSingle();
    email = (data?.email as string) ?? null;
  } catch {
    return { error: "Phone sign-in isn't available right now." };
  }
  if (!email) return { error: "No login found for that phone number." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: pin,
  });
  if (error) return { error: "Incorrect phone number or PIN. Please try again." };

  revalidatePath("/", "layout");
  redirect(next);
}
