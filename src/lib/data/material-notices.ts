import { createClient } from "@/lib/supabase/server";
import {
  parseMaterialIssue,
  parseMaterialNotice,
  type MaterialIssueKind,
  type MaterialNoticeKind,
} from "@/lib/material-notice";

export interface MaterialSignal {
  notice: MaterialNoticeKind | null;
  noticeDetail: string | null;
  issue: MaterialIssueKind | null;
  issueDetail: string | null;
}

const EMPTY: MaterialSignal = {
  notice: null,
  noticeDetail: null,
  issue: null,
  issueDetail: null,
};

/**
 * Latest warehouse notice and latest missing/damaged report for each job on
 * this customer. Newest activity wins. Reads the same activity rows the
 * timeline shows.
 */
export async function materialSignalsForCustomer(
  customerId: string,
): Promise<Map<string, MaterialSignal>> {
  const out = new Map<string, MaterialSignal>();
  const supabase = await createClient();
  const { data } = await supabase
    .from("activities")
    .select("body, created_at")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(200);

  const seenNotice = new Set<string>();
  const seenIssue = new Set<string>();
  for (const row of data ?? []) {
    const body = (row.body as string | null) ?? "";
    const notice = parseMaterialNotice(body);
    if (notice && !seenNotice.has(notice.jobId)) {
      seenNotice.add(notice.jobId);
      const current = out.get(notice.jobId) ?? { ...EMPTY };
      current.notice = notice.kind;
      current.noticeDetail = notice.detail;
      out.set(notice.jobId, current);
    }
    const issue = parseMaterialIssue(body);
    if (issue && !seenIssue.has(issue.jobId)) {
      seenIssue.add(issue.jobId);
      const current = out.get(issue.jobId) ?? { ...EMPTY };
      current.issue = issue.kind;
      current.issueDetail = issue.detail;
      out.set(issue.jobId, current);
    }
  }
  return out;
}
