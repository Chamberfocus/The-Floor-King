import {
  Send,
  MailCheck,
  Eye,
  MousePointerClick,
  TriangleAlert,
  CircleSlash,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatWallDateTime } from "@/lib/format";

export interface EstimateDelivery {
  sent_at: string | null;
  delivered_at: string | null;
  bounced_at: string | null;
  complained_at: string | null;
  view_count: number;
  first_viewed_at: string | null;
  last_viewed_at: string | null;
  email_open_count: number;
  last_email_open_at: string | null;
  click_count: number;
}

const when = (iso: string | null) => (iso ? formatWallDateTime(iso) : null);

function Row({
  icon: Icon,
  label,
  value,
  detail,
  tone = "muted",
}: {
  icon: typeof Send;
  label: string;
  value: string;
  detail?: string | null;
  tone?: "good" | "bad" | "muted" | "wait";
}) {
  return (
    <div className="flex items-start gap-3 py-2">
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          tone === "good" && "text-emerald-600",
          tone === "bad" && "text-destructive",
          tone === "wait" && "text-amber-600",
          tone === "muted" && "text-muted-foreground",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-sm font-medium">{label}</span>
          <span
            className={cn(
              "text-sm",
              tone === "bad" ? "font-semibold text-destructive" : "text-muted-foreground",
            )}
          >
            {value}
          </span>
        </div>
        {detail ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Did it land, and did they read it?
 *
 * Two open numbers on purpose. "Opened" counts real loads of the estimate page
 * — a person. The email pixel is shown separately and hedged, because Apple
 * Mail Privacy Protection fires it without anyone looking and Gmail caches it
 * so repeat reads never register. Presenting the pixel as the headline number
 * would quietly overstate interest, which is the opposite of useful when you're
 * deciding whether to chase a quote.
 */
export function EstimateDeliveryCard({ d }: { d: EstimateDelivery }) {
  if (!d.sent_at) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Not sent yet.</span> Delivery
        and opens start recording the moment you send it.
      </div>
    );
  }

  const bounced = !!d.bounced_at;
  const opened = d.view_count > 0;
  const pixelOnly = !opened && d.email_open_count > 0;

  return (
    <div className="rounded-lg border">
      <div className="divide-y px-4 py-1">
        <Row
          icon={Send}
          label="Sent"
          value={when(d.sent_at) ?? "—"}
          tone="good"
        />

        {bounced ? (
          <Row
            icon={TriangleAlert}
            label="Did not arrive"
            value={when(d.bounced_at) ?? "Bounced"}
            detail="Their mail server rejected it. Check the address — they never got this."
            tone="bad"
          />
        ) : (
          <Row
            icon={MailCheck}
            label="Delivered"
            value={
              d.delivered_at
                ? (when(d.delivered_at) ?? "Yes")
                : "Not confirmed yet"
            }
            detail={
              d.delivered_at
                ? undefined
                : "The mail provider hasn't reported back. Usually seconds; if it stays like this, delivery tracking isn't switched on."
            }
            tone={d.delivered_at ? "good" : "wait"}
          />
        )}

        <Row
          icon={Eye}
          label="Opened"
          value={
            opened
              ? `${d.view_count} ${d.view_count === 1 ? "time" : "times"}`
              : "Not yet"
          }
          detail={
            opened
              ? [
                  d.first_viewed_at ? `First ${when(d.first_viewed_at)}` : null,
                  d.view_count > 1 && d.last_viewed_at
                    ? `last ${when(d.last_viewed_at)}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : pixelOnly
                ? "The email was opened, but they haven't opened the estimate itself."
                : undefined
          }
          tone={opened ? "good" : "muted"}
        />

        {d.email_open_count > 0 ? (
          <Row
            icon={MousePointerClick}
            label="Email opened"
            value={`${d.email_open_count}×`}
            detail="A rough signal only — some mail apps open it automatically, others hide repeat opens."
            tone="muted"
          />
        ) : null}

        {d.complained_at ? (
          <Row
            icon={CircleSlash}
            label="Marked as spam"
            value={when(d.complained_at) ?? "Yes"}
            detail="Don't email this address again — call instead."
            tone="bad"
          />
        ) : null}
      </div>

      {!bounced && !opened ? (
        <p className="border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          {d.delivered_at
            ? "It arrived. They just haven't opened it — worth a call."
            : "Nothing back from the mail provider yet."}
        </p>
      ) : null}
    </div>
  );
}
