"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertRole } from "@/lib/auth";
import { employeeDbError } from "@/lib/employee-error";
import {
  SUPPLIER_SITE_LIST_COLUMNS,
  SUPPLIER_SITE_OPEN_ROLES,
  SUPPLIER_SITE_SAVE_ROLES,
  openSupplierSecret,
  sealSupplierSecret,
  supplierSiteName,
  supplierSitePurpose,
  supplierSiteTableMissing,
  supplierSiteUrl,
  supplierSiteUsername,
  supplierVaultKey,
} from "@/lib/supplier-vault";

export interface SupplierSiteState {
  error: string | null;
  ok?: boolean;
  /** Set when the site row exists so a retry updates it instead of adding another. */
  id?: string;
}

export interface OpenSupplierSiteResult {
  error: string | null;
  url?: string;
  username?: string;
  name?: string;
  password?: string;
  passwordNote?: string;
}

function str(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function vaultKey(): Buffer | null {
  return supplierVaultKey(process.env.SUPPLIER_VAULT_KEY);
}

function revalidateSites() {
  revalidatePath("/supplier-sites");
  revalidatePath("/office");
  revalidatePath("/bills");
  revalidatePath("/purchase-orders");
  revalidatePath("/settings/suppliers");
}

async function supplierExists(id: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.from("suppliers").select("id").eq("id", id).maybeSingle();
  return Boolean(data?.id);
}

export async function saveSupplierSite(
  _prev: SupplierSiteState,
  formData: FormData,
): Promise<SupplierSiteState> {
  let profile;
  try {
    profile = await assertRole([...SUPPLIER_SITE_SAVE_ROLES]);
  } catch {
    return { error: "Only the owner can save a supplier site." };
  }

  const name = supplierSiteName(str(formData.get("name")));
  const purpose = supplierSitePurpose(str(formData.get("purpose")));
  const url = supplierSiteUrl(str(formData.get("site_url")));
  const username = supplierSiteUsername(str(formData.get("username")));
  const password = str(formData.get("site_secret"));
  const clearSecret = str(formData.get("clear_secret")) === "on";
  const id = str(formData.get("id"));
  const supplierId = str(formData.get("supplier_id"));

  if (!name) return { error: "Enter a name for this site." };
  if (!purpose) return { error: "Choose ordering site or pay site." };
  if (!url.ok) return { error: url.error };
  if (username === null) return { error: "That username is too long." };
  if (password.length > 256) return { error: "That password is too long." };
  if (supplierId && !(await supplierExists(supplierId))) {
    return { error: "Pick a vendor from the list." };
  }
  if (password.trim() && clearSecret) {
    return { error: "Enter a new password or remove the saved one, not both." };
  }
  if (password.trim() && !vaultKey()) {
    return { error: "Set SUPPLIER_VAULT_KEY on the server, then save the password." };
  }
  if (password.trim() || clearSecret) {
    try {
      createAdminClient();
    } catch {
      return { error: "The server key for storage is missing, so the password was not changed." };
    }
  }

  const supabase = await createClient();
  const row = {
    name,
    purpose,
    site_url: url.url,
    username,
    supplier_id: supplierId || null,
    updated_by: profile.id,
    updated_at: new Date().toISOString(),
  };

  let siteId = id;
  if (siteId) {
    const { error } = await supabase.from("supplier_sites").update(row).eq("id", siteId);
    if (error) {
      if (supplierSiteTableMissing(error.message)) {
        return { error: "Supplier sites are not turned on yet. Apply migration 0516 first." };
      }
      return { error: employeeDbError(error.message, "That site could not be saved.") };
    }
  } else {
    const { data, error } = await supabase
      .from("supplier_sites")
      .insert(row)
      .select("id")
      .single();
    if (error || !data) {
      if (error && supplierSiteTableMissing(error.message)) {
        return { error: "Supplier sites are not turned on yet. Apply migration 0516 first." };
      }
      return { error: employeeDbError(error?.message, "That site could not be saved.") };
    }
    siteId = data.id as string;
  }

  if (password.trim()) {
    const key = vaultKey();
    const cipher = key ? sealSupplierSecret(password, key) : null;
    if (!key || !cipher) return { error: "That password could not be locked.", id: siteId };
    const admin = createAdminClient();
    const { error: secretError } = await admin.from("supplier_site_secrets").upsert({
      site_id: siteId,
      secret_cipher: cipher,
      updated_at: new Date().toISOString(),
    });
    if (secretError) {
      return { error: "The website is saved. The password was not stored.", id: siteId };
    }
    const { error: flagError } = await supabase
      .from("supplier_sites")
      .update({ has_secret: true })
      .eq("id", siteId);
    if (flagError) {
      await admin.from("supplier_site_secrets").delete().eq("site_id", siteId);
      return { error: "The website is saved. The password was not stored.", id: siteId };
    }
  } else if (clearSecret) {
    let admin;
    try {
      admin = createAdminClient();
    } catch {
      return { error: "The password could not be removed." };
    }
    const { error: secretError } = await admin
      .from("supplier_site_secrets")
      .delete()
      .eq("site_id", siteId);
    if (secretError) return { error: "The password could not be removed." };
    await supabase.from("supplier_sites").update({ has_secret: false }).eq("id", siteId);
  }

  revalidateSites();
  return { error: null, ok: true };
}

export async function deleteSupplierSite(id: string): Promise<SupplierSiteState> {
  try {
    await assertRole([...SUPPLIER_SITE_SAVE_ROLES]);
  } catch {
    return { error: "Only the owner can remove a supplier site." };
  }
  if (!id) return { error: "That site is missing." };
  const supabase = await createClient();
  const { error } = await supabase.from("supplier_sites").delete().eq("id", id);
  if (error) return { error: employeeDbError(error.message, "That site could not be removed.") };
  revalidateSites();
  return { error: null, ok: true };
}

export async function openSupplierSite(id: string): Promise<OpenSupplierSiteResult> {
  let profile;
  try {
    profile = await assertRole([...SUPPLIER_SITE_OPEN_ROLES]);
  } catch {
    return { error: "Only an admin can open supplier sites." };
  }
  if (!id) return { error: "That site is missing." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supplier_sites")
    .select(SUPPLIER_SITE_LIST_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (supplierSiteTableMissing(error.message)) {
      return { error: "Supplier sites are not turned on yet. Apply migration 0516 first." };
    }
    return { error: "That site could not be opened." };
  }
  if (!data) return { error: "That site is not on the list." };

  const checked = supplierSiteUrl(data.site_url as string);
  if (!checked.ok) return { error: "That website address is not safe to open." };

  const username = (data.username as string) ?? "";
  const name = (data.name as string) ?? "Supplier site";
  const base = { error: null, url: checked.url, username, name };

  if (data.has_secret !== true) {
    return { ...base, passwordNote: "No password is saved for this site." };
  }

  const key = vaultKey();
  if (!key) {
    return {
      ...base,
      passwordNote: "The vault key is not set, so the password stayed locked.",
    };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ...base, passwordNote: "The password stayed locked." };
  }

  const { error: auditError } = await admin.from("supplier_site_opens").insert({
    site_id: id,
    actor_id: profile.id,
  });
  if (auditError) {
    return { error: "The password stayed locked because this open could not be recorded." };
  }

  const { data: secret, error: secretError } = await admin
    .from("supplier_site_secrets")
    .select("secret_cipher")
    .eq("site_id", id)
    .maybeSingle();
  if (secretError || !secret?.secret_cipher) {
    return { ...base, passwordNote: "No password is saved for this site." };
  }

  const password = openSupplierSecret(secret.secret_cipher as string, key);
  if (!password) {
    return { ...base, passwordNote: "The saved password could not be unlocked." };
  }
  return { ...base, password };
}
