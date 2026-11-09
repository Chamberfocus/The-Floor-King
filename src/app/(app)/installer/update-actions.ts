"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth";
import { refuseNewActiveWorkForCustomer } from "@/lib/active-work-guard";
import { installerMayReportIssue } from "@/lib/ops-followup";
import {
  escapeUpdateText,
  installerCustomerMessage,
  installerShopBody,
  installerStoreEmails,
  installerUpdateActivity,
  installerUpdateHtml,
  parseInstallerAudiences,
} from "@/lib/installer-update";
import { emailLayout, ownerEmail, sendEmail, siteUrl } from "@/lib/notify";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types";

const ROLES: UserRole[] = ["crew", "admin", "office"];

export type InstallerUpdateState = {
  error: string | null;
  ok?: boolean;
  note?: string | null;
};

function checked(formData: FormData, name: string): boolean {
  const value = formData.get(name);
  return value === "on" || value === "true" || value === "1";
}

export async function sendInstallerUpdate(
  _prev: InstallerUpdateState,
  formData: FormData,
): Promise<InstallerUpdateState> {
  const profile = await assertRole(ROLES);
  const jobId = (formData.get("job_id") ?? "").toString().trim();
  const body = (formData.get("body") ?? "").toString().trim();
  const audiences = parseInstallerAudiences({
    store: checked(formData, "tell_store"),
    sales: checked(formData, "tell_sales"),
    customer: checked(formData, "tell_customer"),
  });
  if (!jobId || !body) return { error: "Write the update first." };
  if (body.length > 800) return { error: "Keep the update under 800 characters." };
  if (!audiences.length) return { error: "Choose who should hear this." };

  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id, customer_id, assigned_to, assigned_crew_id, title, customer:customers(full_name, email, assigned_to, cancelled_at)",
    )
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return { error: "Job not found." };

  const isBoss = profile.role === "admin" || profile.role === "office";
  let memberCrewIds: string[] = [];
  if (!isBoss && profile.role === "crew") {
    const { data: crewRows } = await supabase
      .from("install_crews")
      .select("id")
      .eq("profile_id", profile.id)
      .eq("active", true);
    memberCrewIds = (crewRows ?? []).map((row) => row.id as string);
  }
  if (
    !installerMayReportIssue({
      role: profile.role,
      actorId: profile.id,
      assignedTo: (job.assigned_to as string | null) ?? null,
      assignedCrewId: (job.assigned_crew_id as string | null) ?? null,
      memberCrewIds,
    })
  ) {
    return { error: "You can only update people on jobs assigned to you." };
  }

  const customerId = (job.customer_id as string | null) ?? null;
  if (!customerId) return { error: "This job has no customer on file." };
  const blocked = await refuseNewActiveWorkForCustomer(supabase, customerId);
  if (blocked) return { error: blocked };

  const customer = (Array.isArray(job.customer) ? job.customer[0] : job.customer) as {
    full_name?: string | null;
    email?: string | null;
    assigned_to?: string | null;
  } | null;
  const customerName = customer?.full_name?.trim() || (job.title as string) || "this job";
  const firstName = customerName.split(" ")[0] || "there";
  const salespersonId = customer?.assigned_to ?? null;

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { error: "Could not send the update. Try again in a moment." };
  }

  const activity = installerUpdateActivity({ jobId, body, audiences });
  const { error: activityError } = await admin.from("activities").insert({
    customer_id: customerId,
    user_id: profile.id,
    type: "note",
    body: activity,
  });
  if (activityError) return { error: "Could not save the update. Try again." };

  const tellStore = audiences.includes("store") || audiences.includes("sales");
  if (tellStore) {
    const { error: messageError } = await admin.from("messages").insert({
      customer_id: customerId,
      channel: "internal",
      audience: "shop",
      author_id: profile.id,
      body: installerShopBody(body),
    });
    if (messageError) return { error: "The store did not get the update. Try again." };
  }

  let customerTold = false;
  if (audiences.includes("customer")) {
    const spoken = installerCustomerMessage({
      firstName,
      installerName: profile.full_name ?? "",
      body,
    });
    const { error: clientError } = await admin.from("messages").insert({
      customer_id: customerId,
      channel: "client",
      author_id: profile.id,
      body: spoken,
    });
    if (clientError) return { error: "The customer did not get the update. Try again." };
    customerTold = true;
  }

  const notes: string[] = [];
  if (audiences.includes("sales") && !salespersonId) {
    notes.push("No salesperson is on this account.");
  }

  const storeWanted = audiences.includes("store");
  const salesWanted = audiences.includes("sales") && Boolean(salespersonId);
  const customerEmail = customer?.email?.trim() || "";
  const installerName = profile.full_name?.trim() || "Your installer";
  const jobUrl = `${siteUrl()}/jobs/${jobId}`;

  after(async () => {
    try {
      if (storeWanted) {
        const { data: staff } = await admin
          .from("profiles")
          .select("email")
          .in("role", ["admin", "office"]);
        const emails = installerStoreEmails({
          owner: ownerEmail(),
          staffEmails: (staff ?? []).map((row) => (row.email as string | null) ?? ""),
        });
        const html = emailLayout(
          "Installer update",
          `<p>${escapeUpdateText(installerName)} on ${escapeUpdateText(customerName)}:</p><p>${installerUpdateHtml(body)}</p>`,
          { label: "Open the job", url: jobUrl },
        );
        for (const email of emails) {
          await sendEmail({
            to: email,
            subject: `Installer update: ${customerName}`,
            html,
          }).catch(() => {});
        }
      }
      if (salesWanted && salespersonId) {
        const { data: sales } = await admin
          .from("profiles")
          .select("email")
          .eq("id", salespersonId)
          .maybeSingle();
        const email = (sales?.email as string | null)?.trim();
        if (email) {
          await sendEmail({
            to: email,
            subject: `Installer update on ${customerName}`,
            html: emailLayout(
              "Installer update",
              `<p>${escapeUpdateText(installerName)} asked that you see this update on ${escapeUpdateText(customerName)}:</p><p>${installerUpdateHtml(body)}</p>`,
              { label: "Open the job", url: jobUrl },
            ),
          }).catch(() => {});
        }
      }
      if (customerTold && customerEmail) {
        await sendEmail({
          to: customerEmail,
          subject: "An update on your installation",
          html: emailLayout(
            "An update on your installation",
            `<p>${installerUpdateHtml(
              installerCustomerMessage({
                firstName,
                installerName,
                body,
              }),
            )}</p>`,
          ),
        }).catch(() => {});
      }
    } catch {
      /* mail is best-effort after the record is saved */
    }
  });

  revalidatePath("/installer");
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/shop-talk");
  return {
    error: null,
    ok: true,
    note: notes[0] ?? null,
  };
}
