"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles, Upload, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ClientRow } from "@/lib/extract";
import { parseClients, importClients } from "./import-actions";

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
  const [reading, startReading] = useTransition();
  const [importing, startImport] = useTransition();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const read = () =>
    startReading(async () => {
      try {
        const fd = new FormData();
        fd.set("text", textRef.current?.value ?? "");
        const f = fileRef.current?.files?.[0];
        if (f) fd.set("file", f);
        const res = await parseClients(fd);
        if (res.error) {
          toast.error(res.error);
          if (!res.rows?.length) return;
        }
        setRows(res.rows ?? []);
        if (res.rows?.length)
          toast.success(`Found ${res.rows.length} customers — review & import`);
      } catch (e) {
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
        toast.success(`Imported ${res.count} customers`);
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
        <label className="block text-sm text-muted-foreground">
          …or upload a file (PDF / image):
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,image/*"
            className="ml-2 text-sm"
          />
        </label>
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
      </div>

      {rows && rows.length > 0 ? (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
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
              {rows.length} customer{rows.length === 1 ? "" : "s"} ready. This
              only adds new records — nothing existing is changed.
            </p>
            <Button type="button" onClick={doImport} disabled={importing}>
              {importing ? "Importing…" : `Import ${rows.length} customers`}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
