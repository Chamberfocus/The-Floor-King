"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sendEmail, emailLayout, siteUrl } from "@/lib/notify";
import { getDriveTime } from "@/lib/maps";

export async function notifyOnTheWay(
  customerId: string,
): Promise<{ error: string | null; eta?: string }> {
  if (!customerId) return { error: "Missing customer." };
  const supabase = await createClient();
  const { data: c } = await supabase
    .from("customers")
    .select("full_name, email, street, city, state, zip")
    .eq("id", customerId)
    .maybeSingle();
  if (!c) return { error: "Customer not found." };

  const dest = [c.street, c.city, c.state, c.zip].filter(Boolean).join(", ");
  const eta = await getDriveTime(dest);
  const etaText = eta?.text ?? null;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Email the customer.
  if (c.email) {
    await sendEmail({
      to: c.email as string,
      subject: "Your Cleveland Floor King team is on the way 🚚",
      html: emailLayout(
        "We're on our way!",
        `<p>Hi ${(c.full_name as string)?.split(" ")[0] ?? "there"},</p>
         <p>Your Cleveland Floor King team is headed your way${etaText ? ` — estimated arrival in about <strong>${etaText}</strong>` : ""}. See you soon!</p>`,
        { label: "View your project", url: `${siteUrl()}/portal` },
      ),
    });
  }

  // Also drop it in the customer chat so it shows in their portal.
  await supabase.from("messages").insert({
    customer_id: customerId,
    channel: "client",
    author_id: user?.id ?? null,
    body: `🚚 We're on our way${etaText ? ` — ETA about ${etaText}` : ""}.`,
  });

  revalidatePath(`/customers/${customerId}`);
  return { error: null, eta: etaText ?? "sent" };
}
