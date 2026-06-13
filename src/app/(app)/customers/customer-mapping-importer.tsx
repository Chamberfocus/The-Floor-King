"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileUp, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SearchPicker } from "@/components/ui/search-picker";
import { cn } from "@/lib/utils";
import { fileToGrid } from "@/lib/pdf-client";
import type { ClientRow } from "@/lib/extract";
import { importClients } from "./import-actions";

const FIELDS: { key: keyof ClientRow; label: string; syn: string[] }[] = [
  { key: "full_name", label: "Name", syn: ["name", "fullname", "customer", "customername", "contact", "client"] },
  { key: "company", label: "Company", syn: ["company", "business", "organization", "account"] },
  { key: "email", label: "Email", syn: ["email", "emailaddress", "e-mail"] },
  { key: "phone", label: "Phone", syn: ["phone", "phonenumber", "mobile", "cell", "tel", "telephone"] },
  { key: "street", label: "Street", syn: ["street", "address", "address1", "streetaddress", "addr"] },
  { key: "city", label: "City", syn: ["city", "town"] },
  { key: "state", label: "State", syn: ["state", "province", "region"] },
  { key: "zip", label: "Zip", syn: ["zip", "zipcode", "postal", "postalcode", "postcode"] },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function CustomerMappingImporter() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [map, setMap] = useState<Record<string, number>>({});
  const [parsing, startParse] = useTransition();
  const [importing, startImport] = useTransition();
  const [done, setDone] = useState<number | null>(null);

  const load = (f: File) =>
    startParse(async () => {
      try {
        const grid = await fileToGrid(f);
        if (grid.length < 2) {
          toast.error("That file has no data rows.");
          return;
        }
        const head = grid[0];
        const data = grid.slice(1).filter((r) => r.some((c) => c.trim()));
        const guess: Record<string, number> = {};
        const normHead = head.map(norm);
        for (const fld of FIELDS) {
          guess[fld.key] = -1;
          for (const s of fld.syn) {
            const i = normHead.indexOf(norm(s));
            if (i >= 0) {
              guess[fld.key] = i;
              break;
            }
          }
        }
        setFile(f);
        setHeaders(head);
        setRows(data);
        setMap(guess);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't read that file.");
      }
    });

  const reset = () => {
    setFile(null);
    setHeaders([]);
    setRows([]);
    setMap({});
  };

  const colOptions = [
    { value: "-1", label: "— Not in file —" },
    ...headers.map((h, i) => ({ value: String(i), label: h || `Column ${i + 1}` })),
  ];

  const build = (): ClientRow[] => {
    const cell = (r: string[], key: string) => {
      const i = map[key];
      return i >= 0 ? (r[i] ?? "").trim() : "";
    };
    const out: ClientRow[] = [];
    for (const r of rows) {
      const full_name = cell(r, "full_name");
      const company = cell(r, "company");
      if (!full_name && !company) continue;
      out.push({
        full_name: full_name || company,
        company: company || null,
        email: cell(r, "email") || null,
        phone: cell(r, "phone") || null,
        street: cell(r, "street") || null,
        city: cell(r, "city") || null,
        state: cell(r, "state") || null,
        zip: cell(r, "zip") || null,
      });
    }
    return out;
  };

  const preview = build();

  const doImport = () =>
    startImport(async () => {
      const built = build();
      if (!built.length) {
        toast.error("Map at least the Name (or Company) column.");
        return;
      }
      const res = await importClients(built);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setDone(res.count ?? built.length);
      reset();
    });

  if (!file) {
    return (
      <>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) load(f);
          }}
          onClick={() => document.getElementById("cust-map-file")?.click()}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-8 text-center transition-colors",
            dragOver ? "border-primary bg-primary/5" : "border-input hover:border-primary/50 hover:bg-muted/40",
          )}
        >
          <Zap className="size-6 text-primary" />
          <span className="text-sm font-medium">
            {parsing ? "Reading…" : "Drop an Excel or CSV client list — or click to choose"}
          </span>
          <span className="text-xs text-muted-foreground">
            Instant import, no AI. .xlsx, .xls, or .csv
          </span>
          <input
            id="cust-map-file"
            type="file"
            accept=".xlsx,.xls,.csv,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) load(f);
            }}
          />
        </div>
        <Done done={done} onClose={() => setDone(null)} router={router} />
      </>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <FileUp className="size-4 text-muted-foreground" />
        <span className="font-medium">{file.name}</span>
        <span className="text-muted-foreground">· {rows.length} rows</span>
        <button
          type="button"
          onClick={reset}
          className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" /> Choose a different file
        </button>
      </div>

      <div className="rounded-lg border bg-muted/30 p-3">
        <p className="mb-2 text-sm font-medium">Match your columns</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.key} className="flex items-center gap-2">
              <span className="w-24 shrink-0 text-xs text-muted-foreground">
                {f.label}
                {f.key === "full_name" ? " *" : ""}
              </span>
              <SearchPicker
                className="flex-1"
                value={String(map[f.key] ?? -1)}
                onChange={(v) => setMap((m) => ({ ...m, [f.key]: Number(v) }))}
                options={colOptions}
              />
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs text-muted-foreground">
          Preview — {preview.length} customers will import
        </p>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left">Name</th>
                <th className="px-2 py-1.5 text-left">Phone</th>
                <th className="px-2 py-1.5 text-left">Email</th>
                <th className="px-2 py-1.5 text-left">City</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {preview.slice(0, 6).map((c, i) => (
                <tr key={i}>
                  <td className="px-2 py-1">{c.full_name}</td>
                  <td className="px-2 py-1 text-muted-foreground">{c.phone ?? "—"}</td>
                  <td className="px-2 py-1 text-muted-foreground">{c.email ?? "—"}</td>
                  <td className="px-2 py-1 text-muted-foreground">{c.city ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="button" onClick={doImport} disabled={importing || !preview.length}>
          {importing ? "Importing…" : `Import ${preview.length} customers`}
        </Button>
      </div>

      <Done done={done} onClose={() => setDone(null)} router={router} />
    </div>
  );
}

function Done({
  done,
  onClose,
  router,
}: {
  done: number | null;
  onClose: () => void;
  router: ReturnType<typeof useRouter>;
}) {
  return (
    <Dialog open={done !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import complete</DialogTitle>
          <DialogDescription>
            Added <strong className="text-foreground">{done} customers</strong>.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Import another
          </Button>
          <Button
            onClick={() => {
              onClose();
              router.push("/customers");
            }}
          >
            View customers
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
