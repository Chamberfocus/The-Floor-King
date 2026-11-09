/**
 * An installer update uses the records the store already reads.
 * Shop talk is the store and the salesperson. The client thread is the customer.
 * The customer hears it only when the installer asks for that.
 */

export type InstallerAudience = "store" | "sales" | "customer";

const AUDIENCE_ORDER: InstallerAudience[] = ["store", "sales", "customer"];

export function parseInstallerAudiences(flags: {
  store: boolean;
  sales: boolean;
  customer: boolean;
}): InstallerAudience[] {
  return AUDIENCE_ORDER.filter((audience) => flags[audience]);
}

export function installerUpdateActivity(input: {
  jobId: string;
  body: string;
  audiences: InstallerAudience[];
}): string {
  const who = input.audiences.length ? input.audiences.join("+") : "store";
  return `Installer update (${input.jobId}, ${who}): ${input.body.trim()}`;
}

const UPDATE_RE =
  /^Installer update \(([0-9a-f-]{36}), ([a-z+]+)\): ([\s\S]+)$/i;

export function parseInstallerUpdate(
  body: string,
): { jobId: string; audiences: InstallerAudience[]; detail: string } | null {
  const match = UPDATE_RE.exec(body.trim());
  if (!match) return null;
  const audiences = match[2].split("+");
  if (
    audiences.length === 0 ||
    audiences.some((part) => !AUDIENCE_ORDER.includes(part as InstallerAudience))
  ) {
    return null;
  }
  return {
    jobId: match[1],
    audiences: audiences as InstallerAudience[],
    detail: match[3].trim(),
  };
}

export function installerShopBody(body: string): string {
  return `Installer update: ${body.trim()}`;
}

export function installerCustomerMessage(input: {
  firstName: string;
  installerName: string;
  body: string;
}): string {
  const who = input.firstName.trim() || "there";
  const from = input.installerName.trim() || "your installer";
  return `Hello ${who}, this is an update from ${from} on your installation: ${input.body.trim()}`;
}

export function escapeUpdateText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function installerUpdateHtml(value: string): string {
  return escapeUpdateText(value).replace(/\n/g, "<br>");
}

/** Inbox for the store side of an installer update. */
export function installerStoreEmails(args: {
  owner: string;
  staffEmails: string[];
}): string[] {
  const out = new Set<string>();
  const owner = args.owner.trim();
  if (owner) out.add(owner);
  for (const email of args.staffEmails) {
    const clean = email.trim();
    if (clean) out.add(clean);
  }
  return [...out];
}
