const SAFE_EXT = /^[a-z0-9]{1,8}$/;

/** Storage key segment. Drops directories and the original name. */
export function safeStorageFileName(
  originalName: string,
  fallbackExt = "bin",
): string {
  const base = originalName.split(/[/\\]/).pop() ?? "";
  const extRaw = base.includes(".")
    ? base.slice(base.lastIndexOf(".") + 1).toLowerCase()
    : "";
  const ext = SAFE_EXT.test(extRaw) ? extRaw : fallbackExt.replace(/^\./, "");
  return `${crypto.randomUUID()}.${ext}`;
}

export function safeDisplayFileName(originalName: string): string {
  const base = (originalName.split(/[/\\]/).pop() ?? "file")
    .replace(/[\u0000-\u001f]/g, "")
    .trim();
  return base.slice(0, 180) || "file";
}

export function employeeFileSaveError(
  kind: "signature" | "photo" | "file" = "file",
): string {
  if (kind === "signature") return "This signature could not be saved. Try again.";
  if (kind === "photo") return "This photo could not be saved. Try again.";
  return "This file could not be saved. Try again.";
}
