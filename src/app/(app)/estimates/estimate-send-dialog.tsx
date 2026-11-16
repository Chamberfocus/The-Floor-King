"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, MessageSquare, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { sendEstimatePreview } from "./send-preview-actions";

export function EstimateSendDialog({
  estimateId,
  customerName,
  email,
  phone,
  startOpen = false,
  label = "Preview & send",
  textFirst = false,
  variant = "default",
}: {
  estimateId: string;
  customerName: string | null;
  email: string | null;
  phone: string | null;
  startOpen?: boolean;
  label?: string;
  /** Opened from “Text the quote”: text is on, email follows whether an address is already on file. */
  textFirst?: boolean;
  variant?: "default" | "outline";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(startOpen);
  const [toEmail, setToEmail] = useState(email ?? "");
  const [toPhone, setToPhone] = useState(phone ?? "");
  const [extraEmails, setExtraEmails] = useState("");
  const [extraPhones, setExtraPhones] = useState("");
  const [sendEmailOn, setSendEmailOn] = useState(textFirst ? Boolean(email?.trim()) : true);
  const [sendTextOn, setSendTextOn] = useState(textFirst ? true : Boolean(phone?.trim()));
  const [saveOnCustomer, setSaveOnCustomer] = useState(true);
  const [pending, setPending] = useState(false);
  const who = customerName?.trim() || "the customer";

  const send = async () => {
    if (!sendEmailOn && !sendTextOn) {
      toast.error("Choose email, text, or both.");
      return;
    }
    setPending(true);
    try {
      const result = await sendEstimatePreview({
        estimateId,
        email: toEmail,
        phone: toPhone,
        extraEmails,
        extraPhones,
        sendEmail: sendEmailOn,
        sendText: sendTextOn,
        saveOnCustomer,
      });
      if (result.ok) {
        toast.success(result.message);
        setOpen(false);
        router.replace(`/estimates/${estimateId}`);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    } catch {
      toast.error("This estimate was not sent.");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Button type="button" size="lg" variant={variant} onClick={() => setOpen(true)}>
        <Send className="size-4" /> {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {open ? (
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Preview before you send</DialogTitle>
            <DialogDescription>
              This is the customer copy for {who}. Confirm the email and phone, change them, or add someone else. Nothing goes out until you send.
            </DialogDescription>
          </DialogHeader>
          <iframe
            title="Estimate preview"
            src={`/estimates/${estimateId}?preview=1`}
            className="h-80 w-full rounded-md border bg-white"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Email</span>
              <Input
                value={toEmail}
                onChange={(e) => setToEmail(e.target.value)}
                type="email"
                autoComplete="email"
                placeholder="name@email.com"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Phone</span>
              <Input
                value={toPhone}
                onChange={(e) => setToPhone(e.target.value)}
                type="tel"
                autoComplete="tel"
                placeholder="(216) 555-0100"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Additional emails</span>
              <Input
                value={extraEmails}
                onChange={(e) => setExtraEmails(e.target.value)}
                placeholder="spouse@email.com, another@email.com"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Additional phones</span>
              <Input
                value={extraPhones}
                onChange={(e) => setExtraPhones(e.target.value)}
                placeholder="216-555-0199"
              />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Additional people get this send only. They are not saved on the customer.
          </p>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={sendEmailOn}
                onChange={(e) => setSendEmailOn(e.target.checked)}
                className="size-4 accent-primary"
              />
              <Mail className="size-4" /> Email the estimate
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={sendTextOn}
                onChange={(e) => setSendTextOn(e.target.checked)}
                className="size-4 accent-primary"
              />
              <MessageSquare className="size-4" /> Text the quote
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={saveOnCustomer}
                onChange={(e) => setSaveOnCustomer(e.target.checked)}
                className="size-4 accent-primary"
              />
              Save this email and phone on the customer
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" onClick={send} disabled={pending}>
              <Send className="size-4" /> {pending ? "Sending…" : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
