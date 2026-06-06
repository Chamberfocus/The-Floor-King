"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { FileText, Upload, Trash2, Download } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import type { CustomerDocument } from "@/lib/types";
import {
  uploadCustomerDocument,
  deleteCustomerDocument,
  type DocState,
} from "./document-actions";

const initial: DocState = { error: null };

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
  const formRef = useRef<HTMLFormElement>(null);
  const inputId = `doc-upload-${customerId}`;

  useEffect(() => {
    if (state.ok) {
      toast.success("Document uploaded");
      formRef.current?.reset();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Documents</CardTitle>
        <form ref={formRef} action={action}>
          <input type="hidden" name="customer_id" value={customerId} />
          <input
            id={inputId}
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
            onClick={() => document.getElementById(inputId)?.click()}
          >
            <Upload className="size-3.5" /> {pending ? "Uploading…" : "Upload"}
          </Button>
        </form>
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No documents yet. Upload contracts, measurements, photos, order
            confirmations, or anything else for this customer.
          </p>
        ) : (
          <ul className="divide-y text-sm">
            {documents.map((d) => (
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
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Download"
                    >
                      <Download className="size-4" />
                    </a>
                  ) : null}
                  <form action={deleteCustomerDocument}>
                    <input type="hidden" name="id" value={d.id} />
                    <input type="hidden" name="path" value={d.path} />
                    <input
                      type="hidden"
                      name="customer_id"
                      value={customerId}
                    />
                    <button type="submit" aria-label="Delete document">
                      <Trash2 className="size-4 hover:text-destructive" />
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
