import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { shellSectionsForRole } from "@/lib/nav";
import {
  SUPPLIER_SITE_LIST_COLUMNS,
  SUPPLIER_SITE_OPEN_ROLES,
  SUPPLIER_SITE_SAVE_ROLES,
  openSupplierSecret,
  sealSupplierSecret,
  supplierSiteTableMissing,
  supplierSiteUrl,
  supplierVaultKey,
} from "@/lib/supplier-vault";

const root = join(__dirname, "../..");
const actions = readFileSync(join(root, "src/app/(app)/supplier-sites/actions.ts"), "utf8");
const sql = readFileSync(join(root, "supabase/migrations/0516_supplier_site_vault.sql"), "utf8");
const adminOnly = readFileSync(join(root, "supabase/migrations/0517_supplier_sites_admin_only.sql"), "utf8");

describe("supplier site vault", () => {
  const key = supplierVaultKey("floor-king-vault-test-key");

  it("locks a password so the saved blob is not the password", () => {
    expect(key).not.toBeNull();
    const cipher = sealSupplierSecret("mill-password-4821", key!);
    expect(cipher).toBeTruthy();
    expect(cipher).not.toContain("mill-password-4821");
    expect(openSupplierSecret(cipher!, key!)).toBe("mill-password-4821");
  });

  it("refuses a short vault key, a wrong key, and a changed blob", () => {
    expect(supplierVaultKey("too-short")).toBeNull();
    expect(supplierVaultKey("")).toBeNull();
    const cipher = sealSupplierSecret("secret-value", key!);
    const other = supplierVaultKey("a-different-vault-key");
    expect(openSupplierSecret(cipher!, other!)).toBeNull();
    const flipped = cipher!.slice(0, -2) + (cipher!.endsWith("a") ? "b" : "a");
    expect(openSupplierSecret(flipped, key!)).toBeNull();
    expect(openSupplierSecret("v1.bad.bad.bad", key!)).toBeNull();
  });

  it("accepts an https site and refuses a password hiding in the address", () => {
    expect(supplierSiteUrl("https://dealer.example.com/login").ok).toBe(true);
    expect(supplierSiteUrl("http://dealer.example.com").ok).toBe(false);
    expect(supplierSiteUrl("javascript:alert(1)").ok).toBe(false);
    expect(supplierSiteUrl("https://user:secret@dealer.example.com").ok).toBe(false);
    expect(supplierSiteUrl("https://localhost/login").ok).toBe(false);
    expect(supplierSiteUrl("")).toEqual({ ok: false, error: "Enter the website." });
  });

  it("keeps the password out of the list columns", () => {
    expect(SUPPLIER_SITE_LIST_COLUMNS.split(", ").sort()).toEqual([
      "has_secret",
      "id",
      "name",
      "purpose",
      "site_url",
      "supplier_id",
      "updated_at",
      "username",
    ]);
    expect(SUPPLIER_SITE_LIST_COLUMNS).not.toContain("secret_cipher");
    expect(SUPPLIER_SITE_LIST_COLUMNS).not.toContain("password");
  });

  it("lets an admin open and save, and keeps everyone else out", () => {
    expect(SUPPLIER_SITE_SAVE_ROLES).toEqual(["admin"]);
    expect(SUPPLIER_SITE_OPEN_ROLES).toEqual(["admin"]);
    expect(actions).toContain("assertRole([...SUPPLIER_SITE_SAVE_ROLES])");
    expect(actions).toContain("assertRole([...SUPPLIER_SITE_OPEN_ROLES])");
    expect(actions).not.toContain("console.");
    for (const role of ["office", "salesman", "sales_manager", "scheduler", "crew", "warehouse", "customer"] as const) {
      const hrefs = new Set(
        shellSectionsForRole(role).flatMap((section) => section.items.map((item) => item.href)),
      );
      expect(hrefs.has("/supplier-sites"), role).toBe(false);
    }
    const adminHrefs = new Set(
      shellSectionsForRole("admin").flatMap((section) => section.items.map((item) => item.href)),
    );
    expect(adminHrefs.has("/supplier-sites")).toBe(true);
  });

  it("stores the password where a signed-in user cannot read it", () => {
    expect(sql).toContain("revoke all on public.supplier_site_secrets from public, anon, authenticated");
    expect(sql).toContain("revoke all on public.supplier_site_opens from public, anon, authenticated");
    expect(sql).not.toContain("policy supplier_site_secrets");
    expect(adminOnly).toContain("public.user_role(auth.uid())::text = 'admin'");
    expect(adminOnly).not.toContain("'office'");
    expect(sql).toContain("public.user_role(auth.uid())::text = 'admin'");
    expect(supplierSiteTableMissing("Could not find the table 'public.supplier_sites' in the schema cache")).toBe(
      true,
    );
    expect(supplierSiteTableMissing("permission denied")).toBe(false);
  });
});
