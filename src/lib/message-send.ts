/**
 * Canonical send outcome. UI must never say "sent" unless status is success.
 *
 * SUCCESS — the provider accepted the message
 * FAILED — we attempted and the provider/network rejected it
 * NOT ATTEMPTED — missing address, missing API key, or notifications gated off
 */
export type MessageSendStatus = "success" | "failed" | "not_attempted";

export type MessageSendResult =
  | { status: "success" }
  | { status: "failed"; error: string }
  | { status: "not_attempted"; reason: string };

export function messageWasSent(r: MessageSendResult | boolean | void): boolean {
  if (r && typeof r === "object") return r.status === "success";
  return r === true;
}

export function describeMessageSend(r: MessageSendResult): string {
  if (r.status === "success") return "sent";
  if (r.status === "failed") return r.error;
  return r.reason;
}

/** Query flag for post-action banners. Never "sent" unless success. */
export function messageSendQueryValue(r: MessageSendResult): MessageSendStatus {
  return r.status;
}

/** Combine email + SMS (or any fan-out). Failed wins; else success if any sent. */
export function combineMessageSends(
  results: readonly MessageSendResult[],
): MessageSendResult {
  if (results.length === 0) {
    return { status: "not_attempted", reason: "No send attempted." };
  }
  const failed = results.find((r) => r.status === "failed");
  if (failed) return failed;
  if (results.some((r) => r.status === "success")) return { status: "success" };
  const skip = results.find((r) => r.status === "not_attempted");
  return skip ?? { status: "not_attempted", reason: "No send attempted." };
}
