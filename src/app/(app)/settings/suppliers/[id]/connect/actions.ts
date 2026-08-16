"use server";

import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { discoverServices } from "@/lib/fcb2b";
import { probeSftp } from "@/lib/sftp-832";
import {
  collectCatalogsOverSftp,
  fetchPricesOverRest,
  getSupplierFeed,
  readCatalogFile,
  recordFeedRun,
  sftpTargetFor,
  stagePriceImport,
  type FeedKind,
} from "@/lib/data/supplier-feeds";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function feedKind(v: FormDataEntryValue | null): FeedKind {
  const s = str(v);
  return s === "fcb2b_rest" || s === "fcb2b_832" || s === "file" || s === "manual"
    ? s
    : "file";
}

export interface FeedState {
  error: string | null;
  ok?: boolean;
  /** Set when the action produced a draft import to review. */
  importId?: string;
  /** Anything the office needs to know but that isn't a failure. */
  warnings?: string[];
  note?: string;
}

const initialFail = (error: string): FeedState => ({ error });

async function supplierName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
): Promise<string> {
  const { data } = await supabase.from("suppliers").select("name").eq("id", id).maybeSingle();
  return (data?.name as string) ?? "Supplier";
}

function refresh(supplierId: string) {
  revalidatePath(`/settings/suppliers/${supplierId}/connect`);
  revalidatePath(`/settings/suppliers/${supplierId}`);
}

/** Save (or create) how we connect to this supplier. */
export async function saveFeedConnection(
  _prev: FeedState,
  formData: FormData,
): Promise<FeedState> {
  await assertRole(["admin", "office"]);
  const supplierId = str(formData.get("supplier_id"));
  if (!supplierId) return initialFail("Missing supplier.");

  const kind = feedKind(formData.get("kind"));
  const endpoint = str(formData.get("endpoint_url"));
  if (kind === "fcb2b_rest" && !endpoint) {
    return initialFail("A REST connection needs the endpoint URL they gave you.");
  }
  if (endpoint && !/^https:\/\//i.test(endpoint)) {
    // Credentials ride on this request. Plain http would put them on the wire.
    return initialFail("The endpoint must be an https:// URL.");
  }

  const cadenceRaw = str(formData.get("cadence_days"));
  const cadence = cadenceRaw === "" ? null : Math.max(0, Math.round(Number(cadenceRaw) || 0));

  const transport = str(formData.get("transport")) === "sftp" ? "sftp" : "upload";
  const sftpHost = str(formData.get("sftp_host")).replace(/^sftp:\/\//i, "").replace(/\/.*$/, "");
  const sftpUser = str(formData.get("sftp_username"));
  if (transport === "sftp") {
    if (!sftpHost) return initialFail("An SFTP connection needs the host they gave you.");
    if (!sftpUser) return initialFail("An SFTP connection needs the username they issued.");
    if (!str(formData.get("credential_key"))) {
      return initialFail("Name the environment variable holding the SFTP password.");
    }
  }
  const portRaw = str(formData.get("sftp_port"));
  const sftpPort = portRaw === "" ? 22 : Math.max(1, Math.round(Number(portRaw) || 22));

  const supabase = await createClient();
  const row = {
    supplier_id: supplierId,
    kind,
    transport,
    client_identifier: str(formData.get("client_identifier")) || null,
    endpoint_url: endpoint || null,
    credential_key: str(formData.get("credential_key")) || null,
    price_service_path: str(formData.get("price_service_path")) || null,
    sftp_host: sftpHost || null,
    sftp_port: sftpPort,
    sftp_username: sftpUser || null,
    sftp_remote_path: str(formData.get("sftp_remote_path")) || null,
    cadence_days: cadence,
    active: str(formData.get("active")) === "on",
    notes: str(formData.get("notes")) || null,
    updated_at: new Date().toISOString(),
  };

  const existing = await getSupplierFeed(supabase, supplierId);
  const { error } = existing
    ? await supabase.from("supplier_feeds").update(row).eq("id", existing.id)
    : await supabase.from("supplier_feeds").insert(row);
  if (error) return initialFail(error.message);

  refresh(supplierId);
  return { error: null, ok: true };
}

/**
 * Ask the supplier what they expose. This is the honest first move: it proves
 * the URL, the ClientIdentifier and the credential all work together before
 * anyone waits on a price run that was never going to succeed.
 */
export async function testFeedConnection(supplierId: string): Promise<FeedState> {
  await assertRole(["admin", "office"]);
  const supabase = await createClient();
  const feed = await getSupplierFeed(supabase, supplierId);
  if (!feed) return initialFail("Save the connection first.");
  if (!feed.endpoint_url) return initialFail("No endpoint URL is saved.");
  if (feed.credential_key && !process.env[feed.credential_key]) {
    return initialFail(
      `The credential ${feed.credential_key} isn't set in this environment. Add it in Vercel → Settings → Environment Variables, redeploy, then test again.`,
    );
  }

  const res = await discoverServices(feed);
  await recordFeedRun(supabase, feed.id, res.ok ? null : res.error);
  refresh(supplierId);

  if (!res.ok) {
    return initialFail(
      `${res.error ?? "The request failed."}${res.status ? "" : " — check the endpoint URL is reachable from the internet."}`,
    );
  }
  // Show them what came back; the service list is what tells us which path to
  // put in "price service".
  const snippet = res.body.slice(0, 600).replace(/\s+/g, " ").trim();
  return {
    error: null,
    ok: true,
    note: snippet || "Connected, but they returned an empty service list.",
  };
}

/** Pull prices now over REST and stage them for review. */
export async function fetchPricesNow(supplierId: string): Promise<FeedState> {
  const profile = await assertRole(["admin", "office"]);
  const supabase = await createClient();
  const feed = await getSupplierFeed(supabase, supplierId);
  if (!feed) return initialFail("Save the connection first.");
  if (feed.kind !== "fcb2b_rest") {
    return initialFail("This supplier is set up for files, not web services. Upload their catalog instead.");
  }

  const name = await supplierName(supabase, supplierId);
  const fetched = await fetchPricesOverRest(supabase, feed, name);
  await recordFeedRun(supabase, feed.id, fetched.error);
  if (fetched.error) {
    refresh(supplierId);
    return { error: fetched.error, warnings: fetched.warnings };
  }

  const staged = await stagePriceImport(supabase, {
    supplierId,
    kind: "fcb2b_rest",
    sourceName: fetched.sourceName,
    effectiveDate: fetched.effectiveDate,
    rows: fetched.rows,
    createdBy: profile.id,
    warnings: fetched.warnings,
  });
  refresh(supplierId);
  if (staged.error && !staged.importId) return { error: staged.error, warnings: staged.warnings };
  return {
    error: null,
    ok: true,
    importId: staged.importId ?? undefined,
    warnings: staged.warnings,
  };
}

/** Sign in to the supplier's SFTP mailbox and report what's in it. */
export async function testSftpConnection(supplierId: string): Promise<FeedState> {
  await assertRole(["admin", "office"]);
  const supabase = await createClient();
  const feed = await getSupplierFeed(supabase, supplierId);
  if (!feed) return initialFail("Save the connection first.");
  if (feed.transport !== "sftp") return initialFail("This supplier isn't set up for SFTP.");
  if (feed.credential_key && !process.env[feed.credential_key]) {
    return initialFail(
      `The password variable ${feed.credential_key} isn't set in this environment. Add it in Vercel → Settings → Environment Variables, redeploy, then test again.`,
    );
  }

  const probe = await probeSftp(sftpTargetFor(feed));
  await recordFeedRun(supabase, feed.id, probe.ok ? null : probe.message);
  refresh(supplierId);
  if (!probe.ok) return initialFail(probe.message);
  return {
    error: null,
    ok: true,
    note: probe.names.length ? `${probe.message}\n\n${probe.names.join("\n")}` : probe.message,
  };
}

/** Collect every new 832 sitting in the supplier's mailbox. */
export async function pullFromSftp(supplierId: string): Promise<FeedState> {
  const profile = await assertRole(["admin", "office"]);
  const supabase = await createClient();
  const feed = await getSupplierFeed(supabase, supplierId);
  if (!feed) return initialFail("Save the connection first.");
  if (feed.transport !== "sftp") return initialFail("This supplier isn't set up for SFTP.");

  const name = await supplierName(supabase, supplierId);
  const run = await collectCatalogsOverSftp(supabase, feed, name, profile.id);
  await recordFeedRun(supabase, feed.id, run.error);
  refresh(supplierId);

  if (run.error) return { error: run.error, warnings: run.warnings };
  if (!run.imports.length) {
    return {
      error: null,
      ok: true,
      warnings: run.warnings,
      note:
        run.filesSeen === 0
          ? "Signed in, but there are no catalog files in that directory yet."
          : "Nothing new to read — every catalog in the mailbox has been imported already.",
    };
  }
  // Several files can arrive at once; open the first and list the rest.
  return {
    error: null,
    ok: true,
    importId: run.imports[0].importId,
    warnings: [
      ...run.warnings,
      ...(run.imports.length > 1
        ? [`${run.imports.length} catalogs were read. Opening the oldest; the others are listed on the connect page.`]
        : []),
    ],
  };
}

/** Upload an 832 price catalog they sent as a file. */
export async function uploadCatalogFile(
  _prev: FeedState,
  formData: FormData,
): Promise<FeedState> {
  const profile = await assertRole(["admin", "office"]);
  const supplierId = str(formData.get("supplier_id"));
  if (!supplierId) return initialFail("Missing supplier.");

  const file = formData.get("file");
  if (!(file instanceof File) || !file.size) return initialFail("Choose a file first.");
  if (file.size > 20 * 1024 * 1024) return initialFail("That file is over 20MB — send it in parts.");

  const text = await file.text();
  const read = readCatalogFile(text, file.name);
  if (read.error) return { error: read.error, warnings: read.warnings };

  const supabase = await createClient();
  const staged = await stagePriceImport(supabase, {
    supplierId,
    kind: "fcb2b_832",
    sourceName: file.name,
    effectiveDate: read.effectiveDate,
    rows: read.rows,
    createdBy: profile.id,
    warnings: read.warnings,
  });
  refresh(supplierId);
  if (staged.error && !staged.importId) return { error: staged.error, warnings: staged.warnings };
  return {
    error: null,
    ok: true,
    importId: staged.importId ?? undefined,
    warnings: staged.warnings,
  };
}
