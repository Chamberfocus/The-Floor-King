"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { FileText, Upload, Trash2, Download, Ruler, ImagePlus } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CustomerDocument } from "@/lib/types";
import {
  uploadCustomerDocument,
  deleteCustomerDocument,
  type DocState,
} from "./document-actions";

const initial: DocState = { error: null };
const isImage = (d: CustomerDocument) => (d.mime ?? "").startsWith("image/");

export function CustomerDocuments({
  customerId,
  documents,
}: {
  customerId: string;
  documents: CustomerDocument[];
}) {
  const [state, action, pending] = useActionState(
    uploadCustomerDocument,
    initial,
  );
  const docFormRef = useRef<HTMLFormElement>(null);
  const measureFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      toast.success("Uploaded");
      docFormRef.current?.reset();
      measureFormRef.current?.reset();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state]);

  // Measurement diagrams lead; photos get their own thumbnail grid; the rest
  // are file attachments.
  const measurements = documents.filter((d) => d.kind === "measurement");
  const photos = documents.filter((d) => d.kind === "photo" && isImage(d));
  const others = documents.filter(
    (d) => d.kind !== "measurement" && !(d.kind === "photo" && isImage(d)),
  );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Photos, measurements &amp; files</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {/* Photo upload — phone offers Library / Take Photo / Browse */}
          <form action={action}>
            <input type="hidden" name="customer_id" value={customerId} />
            <input type="hidden" name="kind" value="photo" />
            <input
              id={`photo-upload-${customerId}`}
              type="file"
              name="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) e.currentTarget.form?.requestSubmit();
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                document.getElementById(`photo-upload-${customerId}`)?.click()
              }
            >
              <ImagePlus className="size-3.5" /> Add photo
            </Button>
          </form>
          {/* Measurement diagram upload (salesperson's sketch) */}
          <form ref={measureFormRef} action={action}>
            <input type="hidden" name="customer_id" value={customerId} />
            <input type="hidden" name="kind" value="measurement" />
            <input
              id={`measure-upload-${customerId}`}
              type="file"
              name="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) e.currentTarget.form?.requestSubmit();
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                document.getElementById(`measure-upload-${customerId}`)?.click()
              }
            >
              <Ruler className="size-3.5" /> Measurement diagram
            </Button>
          </form>
          {/* Any other document */}
          <form ref={docFormRef} action={action}>
            <input type="hidden" name="customer_id" value={customerId} />
            <input type="hidden" name="kind" value="other" />
            <input
              id={`doc-upload-${customerId}`}
              type="file"
              name="file"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) e.currentTarget.form?.requestSubmit();
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                document.getElementById(`doc-upload-${customerId}`)?.click()
              }
            >
              <Upload className="size-3.5" /> {pending ? "Uploading…" : "Upload"}
            </Button>
          </form>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No documents yet. Upload the salesperson&apos;s{" "}
            <strong>measurement diagram</strong> so it guides the estimate and the
            installers — plus contracts, photos, or order confirmations.
          </p>
        ) : null}

        {/* Measurement diagrams — shown big so they actually help */}
        {measurements.length > 0 ? (
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Ruler className="size-3.5" /> Measurement diagrams
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {measurements.map((d) => (
                <div key={d.id} className="overflow-hidden rounded-lg border">
                  {isImage(d) && d.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <a href={d.url} target="_blank" rel="noreferrer">
                      <img
                        src={d.url}
                        alt={d.name}
                        className="max-h-72 w-full bg-muted object-contain"
                      />
                    </a>
                  ) : (
                    <a
                      href={d.url ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 p-4 text-sm hover:underline"
                    >
                      <FileText className="size-5 text-muted-foreground" />
                      {d.name}
                    </a>
                  )}
                  <div className="flex items-center justify-between gap-2 border-t px-3 py-1.5 text-xs text-muted-foreground">
                    <span className="truncate">{d.name}</span>
                    <div className="flex shrink-0 items-center gap-2">
                      <span>{formatDate(d.created_at)}</span>
                      <DeleteBtn doc={d} customerId={customerId} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Photos — thumbnail grid */}
        {photos.length > 0 ? (
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <ImagePlus className="size-3.5" /> Photos
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {photos.map((d) => (
                <div key={d.id} className="group relative overflow-hidden rounded-lg border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <a href={d.url ?? "#"} target="_blank" rel="noreferrer">
                    <img
                      src={d.url ?? ""}
                      alt={d.name}
                      className="aspect-square w-full bg-muted object-cover"
                    />
                  </a>
                  <div className="absolute right-1 top-1 rounded-md bg-background/80 opacity-0 transition-opacity group-hover:opacity-100">
                    <DeleteBtn doc={d} customerId={customerId} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Everything else */}
        {others.length > 0 ? (
          <ul className="divide-y text-sm">
            {others.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3 py-2"
              >
                <a
                  href={d.url ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-w-0 items-center gap-2 hover:underline"
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{d.name}</span>
                </a>
                <div className="flex shrink-0 items-center gap-3 text-muted-foreground">
                  <span>{formatDate(d.created_at)}</span>
                  {d.url ? (
                    <a href={d.url} target="_blank" rel="noreferrer" aria-label="Download">
                      <Download className="size-4" />
                    </a>
                  ) : null}
                  <DeleteBtn doc={d} customerId={customerId} />
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DeleteBtn({
  doc,
  customerId,
}: {
  doc: CustomerDocument;
  customerId: string;
}) {
  return (
    <form action={deleteCustomerDocument}>
      <input type="hidden" name="id" value={doc.id} />
      <input type="hidden" name="path" value={doc.path} />
      <input type="hidden" name="customer_id" value={customerId} />
      <button type="submit" aria-label="Delete document">
        <Trash2 className={cn("size-4 hover:text-destructive")} />
      </button>
    </form>
  );
}
