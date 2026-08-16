"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound, PlugZap, RefreshCw, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FeedKind, FeedTransport, SupplierFeed } from "@/lib/data/supplier-feeds";
import {
  fetchPricesNow,
  pullFromSftp,
  saveFeedConnection,
  testFeedConnection,
  testSftpConnection,
  uploadCatalogFile,
  type FeedState,
} from "./actions";

const initial: FeedState = { error: null };

const fieldClass =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const KINDS: { value: string; label: string; hint: string }[] = [
  {
    value: "fcb2b_rest",
    label: "fcB2B web services (live)",
    hint: "They gave you an endpoint URL and a ClientIdentifier. Prices can be pulled on demand and on a schedule.",
  },
  {
    value: "fcb2b_832",
    label: "fcB2B 832 price catalog (file)",
    hint: "They send the price list as an 832 document. Upload it below whenever a new one arrives.",
  },
  {
    value: "file",
    label: "Plain price list (CSV / Excel)",
    hint: "A spreadsheet from the rep. Use the catalog importer for these — this record just tracks the relationship.",
  },
  { value: "manual", label: "Keyed in by hand", hint: "No feed. Tracked so the history stays complete." },
];

export function ConnectionForm({
  supplierId,
  supplierName,
  feed,
  linkedWithSku,
}: {
  supplierId: string;
  supplierName: string;
  feed: SupplierFeed | null;
  linkedWithSku: number;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveFeedConnection, initial);
  const [upload, uploadAction, uploading] = useActionState(uploadCatalogFile, initial);
  const [kind, setKind] = useState<FeedKind>(feed?.kind ?? "fcb2b_rest");
  const [transport, setTransport] = useState<FeedTransport>(feed?.transport ?? "sftp");
  const [busy, startBusy] = useTransition();
  const [probe, setProbe] = useState<string | null>(null);

  useEffect(() => {
    if (state.ok) toast.success("Connection saved");
    if (state.error) toast.error(state.error);
  }, [state]);

  // An upload that produced a draft goes straight to review — the import is
  // worthless until a human looks at it, so don't make them go find it.
  useEffect(() => {
    if (upload.error) toast.error(upload.error);
    upload.warnings?.forEach((w) => toast.warning(w, { duration: 12000 }));
    if (upload.ok && upload.importId) {
      toast.success("Catalog read — review the changes");
      router.push(`/settings/suppliers/${supplierId}/imports/${upload.importId}`);
    }
  }, [upload, router, supplierId]);

  const run = (fn: () => Promise<FeedState>, okMessage: string) =>
    startBusy(async () => {
      const res = await fn();
      res.warnings?.forEach((w) => toast.warning(w, { duration: 12000 }));
      if (res.error) {
        toast.error(res.error, { duration: 12000 });
        return;
      }
      if (res.note) setProbe(res.note);
      toast.success(okMessage);
      if (res.importId) router.push(`/settings/suppliers/${supplierId}/imports/${res.importId}`);
    });

  const rest = kind === "fcb2b_rest";
  const file832 = kind === "fcb2b_832";
  const sftp = file832 && transport === "sftp";
  const pollable = rest || sftp;
  const active = KINDS.find((k) => k.value === kind);

  return (
    <>
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <PlugZap className="size-4 text-primary" /> How we connect to {supplierName}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form action={action} className="space-y-4">
            <input type="hidden" name="supplier_id" value={supplierId} />

            <div className="space-y-1.5">
              <Label htmlFor="kind">Connection type</Label>
              <select
                id="kind"
                name="kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as FeedKind)}
                className={fieldClass}
              >
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">{active?.hint}</p>
            </div>

            {file832 ? (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
                <Label htmlFor="transport" className="text-sm font-semibold">
                  How does the file reach us?
                </Label>
                <select
                  id="transport"
                  name="transport"
                  value={transport}
                  onChange={(e) => setTransport(e.target.value as FeedTransport)}
                  className={`${fieldClass} mt-1.5`}
                >
                  <option value="sftp">We collect it from their SFTP mailbox</option>
                  <option value="upload">Someone uploads it here</option>
                </select>
                {transport === "sftp" ? (
                  <>
                    <div className="mt-4 grid gap-4 sm:grid-cols-3">
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor="sftp_host">SFTP host</Label>
                        <Input
                          id="sftp_host"
                          name="sftp_host"
                          placeholder="shawedi.shawfloors.com"
                          defaultValue={feed?.sftp_host ?? ""}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="sftp_port">Port</Label>
                        <Input
                          id="sftp_port"
                          name="sftp_port"
                          type="number"
                          min="1"
                          placeholder="22"
                          defaultValue={feed?.sftp_port ?? 22}
                        />
                      </div>
                    </div>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="sftp_username">Username</Label>
                        <Input
                          id="sftp_username"
                          name="sftp_username"
                          placeholder="edi07639"
                          defaultValue={feed?.sftp_username ?? ""}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="sftp_remote_path">Directory</Label>
                        <Input
                          id="sftp_remote_path"
                          name="sftp_remote_path"
                          placeholder="leave blank for the home directory"
                          defaultValue={feed?.sftp_remote_path ?? ""}
                        />
                      </div>
                    </div>
                    <div className="mt-4 space-y-1.5">
                      <Label htmlFor="credential_key" className="flex items-center gap-1.5">
                        <KeyRound className="size-3.5" /> Password env var
                      </Label>
                      <Input
                        id="credential_key"
                        name="credential_key"
                        placeholder="SHAW_SFTP_PASSWORD"
                        defaultValue={feed?.credential_key ?? ""}
                        className="font-mono"
                      />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      The <em>name</em> of the Vercel environment variable holding the SFTP
                      password — never the password itself, and never in the database.
                    </p>
                  </>
                ) : null}
              </div>
            ) : null}

            {rest ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="endpoint_url">Endpoint URL</Label>
                    <Input
                      id="endpoint_url"
                      name="endpoint_url"
                      type="url"
                      inputMode="url"
                      placeholder="https://b2b.example.com/fcb2b"
                      defaultValue={feed?.endpoint_url ?? ""}
                    />
                    <p className="text-xs text-muted-foreground">
                      The base URL only — the service path is added per request.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="price_service_path">Price service path</Label>
                    <Input
                      id="price_service_path"
                      name="price_service_path"
                      placeholder="/priceinquiry"
                      defaultValue={feed?.price_service_path ?? ""}
                    />
                    <p className="text-xs text-muted-foreground">
                      Leave blank for <span className="font-mono">/priceinquiry</span>. Test the
                      connection below and their service list will tell you the real one.
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="client_identifier">ClientIdentifier</Label>
                    <Input
                      id="client_identifier"
                      name="client_identifier"
                      placeholder="The buyer code they issued"
                      defaultValue={feed?.client_identifier ?? ""}
                    />
                    <p className="text-xs text-muted-foreground">
                      Their code for us. Per the spec this is <strong>not</strong> the account
                      number.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="credential_key" className="flex items-center gap-1.5">
                      <KeyRound className="size-3.5" /> Credential env var
                    </Label>
                    <Input
                      id="credential_key"
                      name="credential_key"
                      placeholder="SHAW_FCB2B_TOKEN"
                      defaultValue={feed?.credential_key ?? ""}
                      className="font-mono"
                    />
                    <p className="text-xs text-muted-foreground">
                      The <em>name</em> of the Vercel environment variable holding the token or{" "}
                      <span className="font-mono">user:password</span>. The secret itself is never
                      stored in the database.
                    </p>
                  </div>
                </div>
              </>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cadence_days">Pull every (days)</Label>
                <Input
                  id="cadence_days"
                  name="cadence_days"
                  type="number"
                  min="0"
                  placeholder="7"
                  defaultValue={feed?.cadence_days ?? ""}
                  disabled={!pollable}
                />
                <p className="text-xs text-muted-foreground">
                  {pollable
                    ? "The nightly job collects this often and emails you when anything changed. Blank or 0 = only when you ask."
                    : "Scheduled pulls need a live web-service or SFTP connection."}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes</Label>
                <Input
                  id="notes"
                  name="notes"
                  placeholder="Their EDI contact, quirks, agreed discount basis…"
                  defaultValue={feed?.notes ?? ""}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="active"
                defaultChecked={feed?.active ?? true}
                className="size-4 rounded border-input"
              />
              Connection is active
            </label>

            {feed?.last_error ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                Last attempt failed: {feed.last_error}
              </p>
            ) : feed?.last_success_at ? (
              <p className="text-xs text-muted-foreground">
                Last successful contact {new Date(feed.last_success_at).toLocaleString()}.
              </p>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2">
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save connection"}
              </Button>
            </div>
          </form>

          {sftp && feed ? (
            <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => run(() => testSftpConnection(supplierId), "Signed in")}
              >
                <PlugZap className="size-4" /> Test SFTP login
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => run(() => pullFromSftp(supplierId), "Mailbox checked")}
              >
                <RefreshCw className="size-4" /> Collect catalogs now
              </Button>
              {linkedWithSku === 0 ? (
                <p className="self-center text-xs text-muted-foreground">
                  A catalog can be read now, but it will match nothing until products are
                  attributed to {supplierName}.
                </p>
              ) : null}
            </div>
          ) : null}

          {rest && feed ? (
            <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => run(() => testFeedConnection(supplierId), "Connected")}
              >
                <PlugZap className="size-4" /> Test connection
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy || linkedWithSku === 0}
                onClick={() => run(() => fetchPricesNow(supplierId), "Prices pulled")}
              >
                <RefreshCw className="size-4" /> Pull prices now
              </Button>
              {linkedWithSku === 0 ? (
                <p className="self-center text-xs text-muted-foreground">
                  Attribute some products to {supplierName} first — a pull asks about the items we
                  stock.
                </p>
              ) : null}
            </div>
          ) : null}

          {probe ? (
            <div className="mt-4 rounded-md border bg-muted/40 p-3">
              <div className="mb-1 text-xs font-semibold">They answered:</div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs text-muted-foreground">
                {probe}
              </pre>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {file832 || feed?.kind === "fcb2b_832" ? (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Upload className="size-4 text-primary" /> Upload a price catalog
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form action={uploadAction} className="space-y-3">
              <input type="hidden" name="supplier_id" value={supplierId} />
              <input
                type="file"
                name="file"
                accept=".832,.edi,.txt,.x12,text/plain"
                className={fieldClass}
              />
              <p className="text-xs text-muted-foreground">
                An 832 document from {supplierName}. Nothing changes when you upload — it is read,
                matched to our catalog, and held for you to review.
              </p>
              <div className="flex justify-end">
                <Button type="submit" disabled={uploading}>
                  {uploading ? "Reading…" : "Read catalog"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
