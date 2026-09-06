/**
 * Canonical invoice issue / void helpers.
 * When accounting invoice pilot is ON, DB trigger blocks draft→sent/partial/paid
 * unless finalize_invoice_safe (or void_invoice_safe) set the session flag.
 * App paths must use these helpers — never rely on "operational discipline."
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type LooseSupabase = {
  rpc: (fn: string, args?: Record<string, unknown>) => any;
  from: (table: string) => any;
};

export type InvoiceIssueResult = {
  ok: boolean;
  error?: string;
  /** True when migration RPC is missing (pre-0165) — legacy update used. */
  rpcMissing?: boolean;
  duplicate?: boolean;
};

function rpcMissing(err: { message: string } | null | undefined, name: string): boolean {
  return !!err?.message.includes(name);
}

/** draft → sent (+ same-TX invoice_issue outbox when accounting eligible). */
export async function finalizeInvoiceSafe(
  supabase: LooseSupabase,
  invoiceId: string,
  actorId: string | null,
): Promise<InvoiceIssueResult> {
  const { data, error } = await supabase.rpc("finalize_invoice_safe", {
    p_invoice_id: invoiceId,
    p_actor: actorId,
  });
  if (rpcMissing(error, "finalize_invoice_safe")) {
    const { error: updErr } = await supabase
      .from("invoices")
      .update({ status: "sent" })
      .eq("id", invoiceId);
    if (updErr) return { ok: false, error: updErr.message, rpcMissing: true };
    return { ok: true, rpcMissing: true };
  }
  if (error) return { ok: false, error: error.message };
  const res = data as { ok?: boolean; error?: string; duplicate?: boolean };
  if (!res?.ok) return { ok: false, error: res?.error ?? "Finalize failed." };
  return { ok: true, duplicate: !!res.duplicate };
}

/** Void invoice (+ same-TX invoice_void outbox when accounting eligible). */
export async function voidInvoiceSafe(
  supabase: LooseSupabase,
  invoiceId: string,
  actorId: string | null,
  reason?: string,
): Promise<InvoiceIssueResult> {
  const { data, error } = await supabase.rpc("void_invoice_safe", {
    p_invoice_id: invoiceId,
    p_voided_by: actorId,
    p_void_reason: reason ?? "Voided by staff",
  });
  if (rpcMissing(error, "void_invoice_safe")) {
    const { data: pays } = await supabase
      .from("payments")
      .select("id, status")
      .eq("invoice_id", invoiceId);
    if (
      (pays ?? []).some(
        (p: { status?: string }) => ((p.status as string) ?? "active") !== "void",
      )
    ) {
      return {
        ok: false,
        error: "Cannot void an invoice with active payments. Void payments first.",
        rpcMissing: true,
      };
    }
    const { error: updErr } = await supabase
      .from("invoices")
      .update({ status: "void" })
      .eq("id", invoiceId);
    if (updErr) return { ok: false, error: updErr.message, rpcMissing: true };
    return { ok: true, rpcMissing: true };
  }
  if (error) return { ok: false, error: error.message };
  const res = data as { ok?: boolean; error?: string; duplicate?: boolean };
  if (!res?.ok) return { ok: false, error: res?.error ?? "Void failed." };
  return { ok: true, duplicate: !!res.duplicate };
}

const ISSUED = new Set(["sent", "partial", "paid"]);

/**
 * If current status is draft and target is issued, finalize first.
 * Then caller may update to partial/paid (allowed after sent).
 */
export async function ensureInvoiceIssued(
  supabase: LooseSupabase,
  args: {
    invoiceId: string;
    currentStatus: string;
    targetStatus: string;
    actorId: string | null;
  },
): Promise<InvoiceIssueResult> {
  if (args.currentStatus === "draft" && ISSUED.has(args.targetStatus)) {
    return finalizeInvoiceSafe(supabase, args.invoiceId, args.actorId);
  }
  return { ok: true };
}
