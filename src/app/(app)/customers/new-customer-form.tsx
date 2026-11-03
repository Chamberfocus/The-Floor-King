"use client";

import { useState } from "react";
import { ClipboardPaste } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { parsePastedLead, type PastedLead } from "@/lib/paste-lead";
import type { LeadSourceRow } from "@/lib/types";
import { CustomerForm, type CustomerPrefill } from "./customer-form";

function prefillFrom(lead: PastedLead, sources: LeadSourceRow[]): CustomerPrefill {
  const src = lead.sourceKey ? sources.find((s) => s.key === lead.sourceKey) : undefined;
  const detail = lead.sourceDetailLabel
    ? src?.details?.find(
        (d) => d.label.toLowerCase() === lead.sourceDetailLabel!.toLowerCase(),
      )
    : undefined;
  return {
    full_name: lead.fullName,
    company: lead.company,
    email: lead.email,
    phone: lead.phone,
    street: lead.street,
    city: lead.city,
    state: lead.state || undefined,
    zip: lead.zip,
    notes: lead.notes,
    source_id: src?.id ?? "",
    source_detail_id: detail?.id ?? "",
    source_detail_text: lead.campaign,
  };
}

function summary(lead: PastedLead): string {
  if (!lead.fullName && !lead.phone && !lead.email) {
    return "Nothing readable in that paste. Add the name and phone in the form.";
  }
  const bits = [lead.fullName, lead.phone, lead.email, lead.city].filter(Boolean);
  const where =
    lead.sourceKey === "facebook"
      ? "Facebook"
      : lead.sourceKey === "website"
        ? "Website"
        : "";
  const head = [...bits, where].filter(Boolean).join(" · ");
  if (lead.ready && lead.sourceKey) {
    return `${head}. Check it, assign a salesperson, and create the customer.`;
  }
  if (lead.ready) {
    return `${head}. Choose where this lead came from, assign a salesperson, and create the customer.`;
  }
  return `${head}. Add a name and a phone or email, then create the customer.`;
}

export function NewCustomerForm({
  sources,
  assignees,
}: {
  sources: LeadSourceRow[];
  assignees: { id: string; name: string }[];
}) {
  const [text, setText] = useState("");
  const [lead, setLead] = useState<PastedLead | null>(null);
  const [formKey, setFormKey] = useState(0);

  const read = () => {
    const parsed = parsePastedLead(text);
    setLead(parsed);
    setFormKey((k) => k + 1);
  };

  return (
    <div className="space-y-4">
      <div id="paste" className="scroll-mt-24 space-y-3 rounded-lg border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <ClipboardPaste className="size-4 text-muted-foreground" />
          <Label htmlFor="paste-lead">Paste a Facebook or website lead</Label>
        </div>
        <p className="text-sm text-muted-foreground">
          Copy the lead from the email or the lead screen and paste it here. The name, phone,
          email, address, and project notes fill the form so you can assign it.
        </p>
        <textarea
          id="paste-lead"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={"Full name: Jane Smith\nPhone number: (216) 555-0142\nEmail: jane@email.com\nStreet address: 1847 Euclid Avenue\nCity: Cleveland\nWhich rooms?: Living room"}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={read} disabled={!text.trim()}>
            Read lead
          </Button>
          {lead ? (
            <p className="text-sm text-muted-foreground" role="status">
              {summary(lead)}
            </p>
          ) : null}
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <CustomerForm
            key={formKey}
            sources={sources}
            assignees={assignees}
            prefill={lead ? prefillFrom(lead, sources) : undefined}
          />
        </CardContent>
      </Card>
    </div>
  );
}
