/**
 * What the store tells a customer after the warehouse checks material.
 *
 * The warehouse records the condition. Admin, the account owner, and that
 * customer's salesperson decide whether the customer hears about it. The
 * activity text is the record both the timeline and the notice card read.
 */

export type MaterialNoticeKind = "all" | "partial" | "hold";
export type MaterialIssueKind = "missing" | "damaged";
export type ReceiveCondition = "good" | "missing" | "damaged";

export function materialNoticeActivity(input: {
  jobId: string;
  kind: MaterialNoticeKind;
  detail: string;
}): string {
  return `Material notice (${input.jobId}, ${input.kind}): ${input.detail.trim()}`;
}

export function materialIssueActivity(input: {
  jobId: string;
  kind: MaterialIssueKind;
  detail: string;
}): string {
  return `Material issue (${input.jobId}, ${input.kind}): ${input.detail.trim()}`;
}

const NOTICE_RE =
  /^Material notice \(([0-9a-f-]{36}), (all|partial|hold)\): ([\s\S]+)$/i;
const ISSUE_RE =
  /^Material issue \(([0-9a-f-]{36}), (missing|damaged)\): ([\s\S]+)$/i;

export function parseMaterialNotice(
  body: string,
): { jobId: string; kind: MaterialNoticeKind; detail: string } | null {
  const match = NOTICE_RE.exec(body.trim());
  if (!match) return null;
  return {
    jobId: match[1],
    kind: match[2].toLowerCase() as MaterialNoticeKind,
    detail: match[3],
  };
}

export function parseMaterialIssue(
  body: string,
): { jobId: string; kind: MaterialIssueKind; detail: string } | null {
  const match = ISSUE_RE.exec(body.trim());
  if (!match) return null;
  return {
    jobId: match[1],
    kind: match[2].toLowerCase() as MaterialIssueKind,
    detail: match[3],
  };
}

export function receivingConditionNote(
  condition: ReceiveCondition,
  note: string,
): string | null {
  const text = note.trim();
  if (condition === "good") return text || null;
  const label = condition === "damaged" ? "Damaged" : "Missing";
  return text ? `${label} — ${text}` : label;
}

/** Customer-facing sentences. The same words go to email and the portal thread. */
export function customerMaterialMessage(
  kind: "all" | "partial",
  firstName: string,
): { subject: string; body: string } {
  const name = firstName.trim() || "there";
  if (kind === "all") {
    return {
      subject: "Your material has arrived",
      body: `Hello ${name}, your flooring material has arrived and been checked. Everything needed for the installation is here and in good condition. A member of our team will reach out shortly to schedule the installation.`,
    };
  }
  return {
    subject: "An update on your material",
    body: `Hello ${name}, some of your flooring material has arrived. We are still waiting on the rest of the order before the installation can be scheduled. We will let you know as soon as the remaining items are here.`,
  };
}

export function canDecideMaterialNotice(
  viewer: { id: string; role: string },
  owners: {
    salespersonId?: string | null;
    accountOwnerId?: string | null;
    jobOwnerId?: string | null;
  },
): boolean {
  if (viewer.role === "admin") return true;
  const id = viewer.id;
  return (
    (!!owners.salespersonId && id === owners.salespersonId) ||
    (!!owners.accountOwnerId && id === owners.accountOwnerId) ||
    (!!owners.jobOwnerId && id === owners.jobOwnerId)
  );
}
