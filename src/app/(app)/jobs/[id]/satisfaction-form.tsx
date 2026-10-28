"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Star, RotateCcw, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import {
  paymentChoiceLabel,
  signoffNeedsPaymentChoice,
  signoffPriceAlertCopy,
  type SignoffPaymentChoice,
  type SignoffPriceAlert,
} from "@/lib/signoff-sheet";
import { saveJobSatisfaction, type WOState } from "./wo-actions";
import type { JobSatisfaction } from "@/lib/data/jobs";

const initial: WOState = { error: null };

/** Canvas signature pad → writes a PNG data-URL into a hidden input. */
function SignaturePad({ name }: { name: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);
  const sized = useRef(false);

  const prepare = () => {
    const canvas = canvasRef.current;
    if (!canvas || sized.current) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
    sized.current = true;
  };

  useEffect(() => {
    prepare();
  }, []);

  const write = () => {
    if (inputRef.current && canvasRef.current && hasInk.current) {
      inputRef.current.value = canvasRef.current.toDataURL("image/png");
    }
  };

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    prepare();
    drawing.current = true;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.1, y);
    ctx.stroke();
    hasInk.current = true;
    write();
    canvas.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d");
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    hasInk.current = true;
    write();
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    write();
  };
  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasInk.current = false;
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-sm font-medium">Customer signature</label>
        <button type="button" onClick={clear} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <RotateCcw className="size-3" /> Clear
        </button>
      </div>
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
        className="h-48 w-full touch-none rounded-lg border-2 border-dashed border-input bg-white"
      />
      <input ref={inputRef} type="hidden" name={name} />
    </div>
  );
}

function StarsRow({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn("size-4", n <= rating ? "fill-amber-400 text-amber-400" : "text-muted")}
        />
      ))}
    </div>
  );
}

function SignedCard({
  existing,
  paymentChoice,
  alert,
  canCollect,
  balance,
}: {
  existing: JobSatisfaction | null;
  paymentChoice: SignoffPaymentChoice | null;
  alert: SignoffPriceAlert;
  canCollect: boolean;
  balance: number;
}) {
  const copy = signoffPriceAlertCopy(alert, formatMoney);
  return (
    <Card className="border-emerald-500/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Check className="size-4 text-emerald-600" /> Customer signed the finished job
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {copy ? (
          <div role="alert" className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-50">
            <p className="font-semibold">{copy.title}</p>
            <p className="mt-1">{copy.detail}</p>
          </div>
        ) : null}
        {paymentChoice ? (
          <p className="font-medium">{paymentChoiceLabel(paymentChoice)}</p>
        ) : null}
        {paymentChoice === "pay_now" && canCollect && balance > 0 ? (
          <p className="text-muted-foreground">Take the payment on this phone.</p>
        ) : null}
        {paymentChoice === "pay_now" && balance > 0 && !canCollect ? (
          <p className="text-muted-foreground">The store will take the payment. The salesperson has been told.</p>
        ) : null}
        {paymentChoice === "contact_store" ? (
          <p className="text-muted-foreground">They will contact the store to pay. The salesperson has been told.</p>
        ) : null}
        {existing?.rating ? <StarsRow rating={existing.rating} /> : null}
        {existing?.comments ? <p className="text-muted-foreground">“{existing.comments}”</p> : null}
        {existing?.signature ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={existing.signature} alt="Customer signature" className="h-20 rounded border bg-white" />
        ) : null}
        <p className="text-xs text-muted-foreground">
          {existing?.signed_name ? `${existing.signed_name} · ` : ""}
          {existing?.signed_at ? new Date(existing.signed_at).toLocaleString() : "Just signed"}
        </p>
      </CardContent>
    </Card>
  );
}

export function SatisfactionForm({
  jobId,
  existing,
  customerName,
  balance,
  alert,
  canCollect,
}: {
  jobId: string;
  existing: JobSatisfaction | null;
  customerName: string;
  balance: number;
  alert: SignoffPriceAlert;
  canCollect: boolean;
}) {
  const [state, action, pending] = useActionState(saveJobSatisfaction, initial);
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [choice, setChoice] = useState<SignoffPaymentChoice | "">("");

  useEffect(() => {
    if (state.ok) toast.success("Sign-off saved");
  }, [state.ok]);

  const savedChoice = existing?.payment_choice ?? state.paymentChoice ?? null;
  if (existing || state.ok) {
    return (
      <SignedCard
        existing={existing}
        paymentChoice={savedChoice}
        alert={alert}
        canCollect={canCollect}
        balance={balance}
      />
    );
  }

  const copy = signoffPriceAlertCopy(alert, formatMoney);
  const mustChoose = signoffNeedsPaymentChoice({
    balance,
    uninvoicedExtraTotal: alert.uninvoicedExtraTotal,
  });
  const owed = balance > 0.009 ? formatMoney(balance) : null;

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle className="text-lg">Have the customer sign</CardTitle>
        <p className="text-sm text-muted-foreground">
          Hand {customerName} the phone. This is the finished-job sign-off.
        </p>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <input type="hidden" name="job_id" value={jobId} />
          <input type="hidden" name="rating" value={rating} />
          {copy ? (
            <div role="alert" className="rounded-lg border-2 border-amber-500 bg-amber-50 px-3 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-50">
              <p className="font-semibold">{copy.title}</p>
              <p className="mt-1">{copy.detail}</p>
            </div>
          ) : null}
          <div className="rounded-lg bg-muted/60 px-3 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Balance</p>
            <p className={cn("font-semibold tabular-nums", owed ? "text-2xl" : "text-base")}>
              {owed ??
                (alert.uninvoicedExtraTotal > 0.009
                  ? "Change order is not on the invoice yet"
                  : "No balance is due")}
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Overall rating</label>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} stars`} className="min-h-11 min-w-11">
                  <Star className={cn("size-8", n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Comments (optional)</label>
            <textarea
              name="comments"
              rows={2}
              placeholder="How did everything go?"
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor={`signed-name-${jobId}`}>
              Customer name
            </label>
            <Input
              id={`signed-name-${jobId}`}
              name="signed_name"
              required
              placeholder="Printed name"
              autoComplete="name"
              className="h-12 text-base"
            />
          </div>
          <SignaturePad name="signature" />
          {mustChoose ? (
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-semibold">How will you pay the balance?</legend>
              <Choice
                value="pay_now"
                selected={choice === "pay_now"}
                onSelect={() => setChoice("pay_now")}
                title="Pay the balance now"
                detail={
                  canCollect && owed
                    ? `${owed} on this phone after you sign`
                    : owed
                      ? `${owed}. The store will take the payment, and your salesperson is told.`
                      : "The store will take the payment, and your salesperson is told."
                }
              />
              <Choice
                value="contact_store"
                selected={choice === "contact_store"}
                onSelect={() => setChoice("contact_store")}
                title="I will contact the store to pay"
                detail="Your salesperson is told to expect your call."
              />
            </fieldset>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing is owed, so no payment choice is needed.</p>
          )}
          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          <Button type="submit" size="lg" className="min-h-12 w-full text-base" disabled={pending}>
            {pending ? "Saving…" : "Save signed sign-off"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Choice({
  value,
  selected,
  onSelect,
  title,
  detail,
}: {
  value: SignoffPaymentChoice;
  selected: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
}) {
  return (
    <label
      className={cn(
        "flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border-2 px-4 py-3",
        selected ? "border-primary bg-primary/5" : "border-input",
      )}
    >
      <input
        type="radio"
        name="payment_choice"
        value={value}
        required
        checked={selected}
        onChange={onSelect}
        className="mt-1 size-5"
      />
      <span>
        <span className="block text-base font-semibold">{title}</span>
        <span className="block text-sm text-muted-foreground">{detail}</span>
      </span>
    </label>
  );
}
