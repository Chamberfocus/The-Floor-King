import {
  officialBooksBanner,
  type AcctBooksStatusLike,
} from "@/lib/accounting/control-center";
import { ACCOUNTING_NOT_BOOKS_MESSAGE } from "@/lib/accounting/types";

export function BooksStatusBanner(props: {
  books?: AcctBooksStatusLike | null;
  source?: "rpc" | "ts_fallback";
  fallbackReason?: string;
}) {
  const banner = officialBooksBanner(props.books);
  return (
    <div className="space-y-2">
      <div
        className={
          banner.tone === "warning"
            ? "rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
            : "rounded-lg border border-emerald-600/30 bg-emerald-500/10 p-3 text-sm"
        }
      >
        <div className="font-medium">{banner.title}</div>
        <p className="mt-1 text-xs text-muted-foreground">{banner.message}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          {ACCOUNTING_NOT_BOOKS_MESSAGE}
        </p>
      </div>
      {props.source === "ts_fallback" ? (
        <p className="text-xs text-muted-foreground">
          Using local TS report fallback
          {props.fallbackReason ? ` — ${props.fallbackReason}` : ""}. Apply
          migration 0177 for RPC authority.
        </p>
      ) : null}
    </div>
  );
}
