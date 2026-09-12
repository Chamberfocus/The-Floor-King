"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles, Upload, Trash2, FileUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { pdfToText, spreadsheetToText, chunkText } from "@/lib/pdf-client";
import type { ClientRow } from "@/lib/extract";
import { parseClients, importClients, previewImportClients } from "./import-actions";
import type { ClassifiedImportRow } from "./import-actions";
import {
  ImportClassBadge,
  ImportClassSummary,
  classForIndex,
} from "./import-class-summary";

const inputSm =
  "h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const COLS: { key: keyof ClientRow; label: string; w?: string }[] = [
  { key: "full_name", label: "Name", w: "min-w-40" },
  { key: "company", label: "Company" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone", w: "w-28" },
  { key: "street", label: "Street" },
  { key: "city", label: "City", w: "w-24" },
  { key: "state", label: "State", w: "w-14" },
  { key: "zip", label: "Zip", w: "w-20" },
];

export function ClientImporter() {
  const router = useRouter();
  const [rows, setRows] = useState<ClientRow[] | null>(null);
  const [classified, setClassified] = useState<ClassifiedImportRow[]>([]);
  const [importSummary, setImportSummary] = useState<{
    new: number;
    matchedExisting: number;
    possibleDuplicates: number;
    invalid: number;
  } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [reading, startReading] = useTransition();
  const [importing, startImport] = useTransition();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!rows?.length) {
      setClassified([]);
      setImportSummary(null);
      return;
    }
    let live = true;
    previewImportClients(rows).then((p) => {
      if (!live) return;
      setClassified(p.classified);
      setImportSummary(p.summary);
    });
    return () => {
      live = false;
    };
  }, [rows]);

  // Parse long text in chunks so big lists never hit server limits.
  const parseTextChunks = async (text: string): Promise<ClientRow[]> => {
    const chunks = chunkText(text);
    const out: ClientRow[] = [];
    for (let i = 0; i < chunks.length; i++) {
      if (chunks.length > 1)
        setStatus(`Parsing part ${i + 1} of ${chunks.length}…`);
      const fd = new FormData();
      fd.set("text", chunks[i]);
      try {
        const res = await parseClients(fd);
        if (res.rows?.length) out.push(...res.rows);
        else if (res.error && chunks.length === 1) toast.error(res.error);
      } catch {
        /* skip a bad chunk, keep going */
      }
    }
    return out;
  };

  // Upload to storage and parse via signed URL (for images / scanned docs).
  const parseViaStorage = async (f: File): Promise<ClientRow[]> => {
    const supabase = createClient();
    const path = `imports/${crypto.randomUUID()}-${f.name}`;
    const { error: upErr } = await supabase.storage
      .from("documents")
      .upload(path, f, { contentType: f.type || undefined });
    if (upErr) {
      toast.error(`Upload failed: ${upErr.message}`);
      return [];
    }
    const fd = new FormData();
    fd.set("storage_path", path);
    fd.set("storage_mime", f.type ?? "");
    const res = await parseClients(fd);
    if (res.error && !res.rows?.length) toast.error(res.error);
    return res.rows ?? [];
  };

  const read = () =>
    startReading(async () => {
      setStatus(null);
      try {
        const f = file;
        const pasted = textRef.current?.value ?? "";
        const name = (f?.name ?? "").toLowerCase();
        const type = f?.type ?? "";
        const isPdf = type === "application/pdf" || name.endsWith(".pdf");
        const isExcel =
          name.endsWith(".xlsx") ||
          name.endsWith(".xls") ||
          type.includes("spreadsheet") ||
          type.includes("excel");
        const isCsvTxt =
          name.endsWith(".csv") ||
          name.endsWith(".txt") ||
          type === "text/csv" ||
          type === "text/plain";
        const isImage = type.startsWith("image/");
        let rows: ClientRow[] = [];

        if (f && isPdf) {
          setStatus("Reading the PDF in your browser…");
          let text = "";
          try {
            text = (await pdfToText(f)).text;
          } catch {
            /* fall through to image mode */
          }
          if (text.trim().length >= 20) rows = await parseTextChunks(text);
          else {
            setStatus("No selectable text found — reading it as an image…");
            rows = await parseViaStorage(f);
          }
        } else if (f && isExcel) {
          setStatus("Reading the spreadsheet in your browser…");
          rows = await parseTextChunks(await spreadsheetToText(f));
        } else if (f && isCsvTxt) {
          setStatus("Reading the file…");
          rows = await parseTextChunks(await f.text());
        } else if (f && isImage) {
          setStatus("Reading the image…");
          rows = await parseViaStorage(f);
        } else if (f) {
          setStatus("Reading the file…");
          const text = await f.text().catch(() => "");
          if (text.trim().length >= 20) rows = await parseTextChunks(text);
          else rows = await parseViaStorage(f);
        } else if (pasted.trim()) {
          setStatus("Parsing pasted text…");
          rows = await parseTextChunks(pasted);
        } else {
          toast.error("Paste a customer list or choose a file.");
          return;
        }

        setRows(rows);
        setStatus(null);
        if (rows.length)
          toast.success(`Found ${rows.length} customers — review & import`);
        else toast.error("No customers found — try pasting the rows as text.");
      } catch (e) {
        setStatus(null);
        toast.error(e instanceof Error ? e.message : "Couldn't read that.");
      }
    });

  const update = (i: number, key: keyof ClientRow, value: string) =>
    setRows((prev) =>
      prev ? prev.map((r, j) => (j === i ? { ...r, [key]: value } : r)) : prev,
    );
  const remove = (i: number) =>
    setRows((prev) => (prev ? prev.filter((_, j) => j !== i) : prev));

  const doImport = () =>
    startImport(async () => {
      if (!rows?.length) return;
      try {
        const res = await importClients(rows);
        if (res.error) {
          toast.error(res.error);
          return;
        }
        toast.success(
          `Imported ${res.count ?? 0} new customers` +
            (res.summary
              ? ` · ${res.summary.matchedExisting} already on file · ${res.summary.possibleDuplicates} possible duplicates skipped`
              : ""),
        );
        router.push("/customers");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Import failed.");
      }
    });

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium">
            Paste your client list
          </label>
          <textarea
            ref={textRef}
            rows={8}
            placeholder={
              "Paste from a spreadsheet, contacts export, or email — any format.\nExample:\nJohn Smith, 216-555-1212, john@email.com, 123 Main St Cleveland OH 44111\nJane Doe  (440) 555-0099  jane@email.com"
            }
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const dropped = e.dataTransfer.files?.[0];
            if (dropped) setFile(dropped);
          }}
          onClick={() => fileRef.current?.click()}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
            dragOver
              ? "border-primary bg-primary/5"
              : "border-input hover:border-primary/50 hover:bg-muted/40",
          )}
        >
          <FileUp className="size-6 text-muted-foreground" />
          {file ? (
            <span className="flex items-center gap-2 text-sm font-medium">
              {file.name}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setFile(null);
                  if (fileRef.current) fileRef.current.value = "";
                }}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Remove file"
              >
                <X className="size-4" />
              </button>
            </span>
          ) : (
            <>
              <span className="text-sm font-medium">
                Drag &amp; drop a file here, or click to choose
              </span>
              <span className="text-xs text-muted-foreground">
                Excel (.xlsx, .xls), CSV, PDF, or an image
              </span>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.xlsx,.xls,.csv,.txt,image/*"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <Button type="button" onClick={read} disabled={reading}>
          {reading ? (
            <>
              <Sparkles className="size-4 animate-pulse" /> Reading…
            </>
          ) : (
            <>
              <Upload className="size-4" /> Read list
            </>
          )}
        </Button>
        {status ? (
          <p className="text-xs text-muted-foreground">{status}</p>
        ) : null}
      </div>

      {rows && rows.length > 0 ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 p-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">
                Step 2 — review matches, then import new rows only.
              </p>
              {importSummary ? <ImportClassSummary summary={importSummary} /> : null}
            </div>
            <Button
              type="button"
              onClick={doImport}
              disabled={importing || (importSummary != null && importSummary.new === 0)}
            >
              {importing
                ? "Importing…"
                : `Import ${importSummary?.new ?? 0} new`}
            </Button>
          </div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 text-left">Match</th>
                  {COLS.map((c) => (
                    <th key={c.key} className="px-2 py-2 text-left">
                      {c.label}
                    </th>
                  ))}
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1">
                      <ImportClassBadge cls={classForIndex(classified, i)} />
                    </td>
                    {COLS.map((c) => (
                      <td key={c.key} className="px-2 py-1">
                        <input
                          value={(r[c.key] as string) ?? ""}
                          onChange={(e) => update(i, c.key, e.target.value)}
                          className={cn(inputSm, c.w)}
                        />
                      </td>
                    ))}
                    <td className="px-2 py-1 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Remove"
                        onClick={() => remove(i)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Possible duplicates and already-on-file rows are skipped. Existing
              records are never updated or merged.
            </p>
            <Button
              type="button"
              onClick={doImport}
              disabled={importing || (importSummary != null && importSummary.new === 0)}
            >
              {importing
                ? "Importing…"
                : `Import ${importSummary?.new ?? 0} new`}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
