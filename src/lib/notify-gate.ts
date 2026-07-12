// Central notification gate. SERVER ONLY.
// Decides whether a text/email may actually go out, based on WHO the recipient
// is (staff vs customer) and the shop's master switches. This runs inside the
// low-level sendEmail/sendSms so no call site can accidentally bypass it —
// customer notifications stay off until the shop turns them on, while
// staff/installer/warehouse/sales notifications keep flowing.
import { createAdminClient } from "@/lib/supabase/admin";

interface Flags {
  notifyStaff: boolean;
  notifyCustomers: boolean;
}

async function getFlags(): Promise<Flags> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("business_settings")
      .select("notify_staff, notify_customers")
      .eq("id", "default")
      .maybeSingle();
    return {
      notifyStaff: data?.notify_staff ?? true,
      notifyCustomers: data?.notify_customers ?? false,
    };
  } catch {
    // Safe default: staff on, customers off.
    return { notifyStaff: true, notifyCustomers: false };
  }
}

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const last10 = (s: string | null | undefined) => digits(s).slice(-10);

async function isStaff(
  admin: ReturnType<typeof createAdminClient>,
  email: string | null,
  phone10: string | null,
): Promise<boolean> {
  if (email) {
    const { data } = await admin
      .from("profiles")
      .select("id")
      .ilike("email", email)
      .neq("role", "customer")
      .limit(1)
      .maybeSingle();
    if (data) return true;
  }
  if (phone10) {
    const { data } = await admin
      .from("profiles")
      .select("phone")
      .neq("role", "customer")
      .not("phone", "is", null);
    if ((data ?? []).some((p) => last10(p.phone as string) === phone10)) return true;
  }
  return false;
}

async function isCustomer(
  admin: ReturnType<typeof createAdminClient>,
  email: string | null,
  phone10: string | null,
): Promise<boolean> {
  if (email) {
    const { data } = await admin
      .from("customers")
      .select("id")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();
    if (data) return true;
  }
  if (phone10) {
    const { data } = await admin
      .from("customers")
      .select("phone")
      .not("phone", "is", null);
    if ((data ?? []).some((c) => last10(c.phone as string) === phone10)) return true;
  }
  return false;
}

/**
 * True if a message to this recipient is allowed to send right now. Staff wins
 * over customer if a contact somehow matches both. Unknown recipients (vendors,
 * one-off addresses) are always allowed — the switches only gate people we know.
 */
export async function notifyAllowed(opts: {
  email?: string | null;
  phone?: string | null;
}): Promise<boolean> {
  const flags = await getFlags();
  if (flags.notifyStaff && flags.notifyCustomers) return true; // nothing gated

  const email = opts.email?.trim().toLowerCase() || null;
  const phone10 = opts.phone ? last10(opts.phone) || null : null;
  if (!email && !phone10) return true;

  const admin = createAdminClient();
  if (await isStaff(admin, email, phone10)) return flags.notifyStaff;
  if (await isCustomer(admin, email, phone10)) return flags.notifyCustomers;
  return true; // vendor / unknown external
}
