import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import type { UserRole } from "@/lib/types";

/** Who may open a manufacturer or pay site and receive its password. */
export const SUPPLIER_SITE_OPEN_ROLES: readonly UserRole[] = ["admin", "office"];

/** Who may save, change, or remove a site and its password. */
export const SUPPLIER_SITE_SAVE_ROLES: readonly UserRole[] = ["admin"];

export const SUPPLIER_SITE_PURPOSES = ["order", "pay"] as const;
export type SupplierSitePurpose = (typeof SUPPLIER_SITE_PURPOSES)[number];

export const SUPPLIER_SITE_PURPOSE_LABEL: Record<SupplierSitePurpose, string> = {
  order: "Ordering site",
  pay: "Pay site",
};

/** Columns the list is allowed to read. The cipher lives in another table. */
export const SUPPLIER_SITE_LIST_COLUMNS =
  "id, supplier_id, name, purpose, site_url, username, has_secret, updated_at";

const VAULT_SALT = "cleveland-floor-king-supplier-sites";
const MIN_KEY_CHARS = 16;
const MAX_URL_LENGTH = 500;
const MAX_NAME_LENGTH = 80;
const MAX_USERNAME_LENGTH = 120;
const MAX_PASSWORD_LENGTH = 256;

let cachedKey: { raw: string; key: Buffer } | null = null;

/**
 * Derive the vault key from the server secret. Short or missing values refuse
 * to encrypt. The raw secret is never stored next to the passwords.
 */
export function supplierVaultKey(raw: string | undefined | null): Buffer | null {
  const text = raw?.trim() ?? "";
  if (text.length < MIN_KEY_CHARS) return null;
  if (cachedKey?.raw === text) return cachedKey.key;
  const key = scryptSync(text, VAULT_SALT, 32);
  cachedKey = { raw: text, key };
  return key;
}

export function supplierVaultReady(raw: string | undefined | null): boolean {
  return supplierVaultKey(raw) !== null;
}

/** Encrypt a password. Empty input is not a password. */
export function sealSupplierSecret(plain: string, key: Buffer): string | null {
  const text = plain;
  if (!text || text.length > MAX_PASSWORD_LENGTH) return null;
  if (key.length !== 32) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${body.toString("base64url")}`;
}

/** Decrypt a password. A wrong key or a changed blob returns null. */
export function openSupplierSecret(blob: string, key: Buffer): string | null {
  if (key.length !== 32) return null;
  const parts = blob.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const body = Buffer.from(parts[3], "base64url");
    if (iv.length !== 12 || tag.length !== 16 || body.length === 0) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    return plain || null;
  } catch {
    return null;
  }
}

export interface SupplierSiteUrl {
  ok: true;
  url: string;
}

export interface SupplierSiteUrlError {
  ok: false;
  error: string;
}

/**
 * A supplier website we will open in the browser. Https only, and the password
 * is never allowed inside the address (that would land in browser history).
 */
export function supplierSiteUrl(raw: string): SupplierSiteUrl | SupplierSiteUrlError {
  const text = raw.trim();
  if (!text) return { ok: false, error: "Enter the website." };
  if (text.length > MAX_URL_LENGTH) return { ok: false, error: "That website address is too long." };
  if (/[\s]/.test(text)) return { ok: false, error: "The website cannot contain a space." };
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return { ok: false, error: "Enter the full website, starting with https://." };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, error: "The website has to start with https://." };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "Take the username and password out of the website address." };
  }
  if (!parsed.hostname || !parsed.hostname.includes(".")) {
    return { ok: false, error: "That website address is not complete." };
  }
  return { ok: true, url: parsed.toString() };
}

export function supplierSiteName(raw: string): string | null {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text || text.length > MAX_NAME_LENGTH) return null;
  return text;
}

export function supplierSiteUsername(raw: string): string | null {
  const text = raw.trim();
  if (text.length > MAX_USERNAME_LENGTH) return null;
  return text;
}

export function supplierSitePurpose(raw: string): SupplierSitePurpose | null {
  if (raw === "order" || raw === "pay") return raw;
  return null;
}

export function supplierSiteTableMissing(message: string): boolean {
  return /supplier_sites/i.test(message) && /schema cache|does not exist|could not find/i.test(message);
}
