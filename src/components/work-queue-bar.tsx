import Link from "next/link";
import { cn } from "@/lib/utils";

export function WorkQueueBar({
  action,
  query,
  placeholder,
  hidden,
  chips,
  countLabel,
}: {
  action: string;
  query: string;
  placeholder: string;
  hidden?: { name: string; value: string }[];
  chips: { href: string; label: string; active: boolean }[];
  countLabel: string;
}) {
  return (
    <div className="mb-4 space-y-3">
      <form action={action} method="get" className="flex flex-col gap-2 sm:flex-row">
        {(hidden ?? []).map((field) => (
          <input key={field.name} type="hidden" name={field.name} value={field.value} />
        ))}
        <input
          name="q"
          defaultValue={query}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-11 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 text-sm"
        />
        <button
          type="submit"
          className="h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
        >
          Search
        </button>
      </form>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <Link
            key={chip.href + chip.label}
            href={chip.href}
            aria-current={chip.active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center rounded-full border px-3 text-sm font-medium",
              chip.active
                ? "border-foreground bg-foreground text-background"
                : "border-input text-muted-foreground hover:text-foreground",
            )}
          >
            {chip.label}
          </Link>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{countLabel}</p>
    </div>
  );
}

export function WorkQueuePager({
  page,
  pages,
  hrefFor,
}: {
  page: number;
  pages: number;
  hrefFor: (page: number) => string;
}) {
  if (pages <= 1) return null;
  return (
    <nav className="mt-4 flex items-center justify-between gap-3 text-sm" aria-label="Pages">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className="inline-flex min-h-11 items-center font-medium underline-offset-4 hover:underline">
          Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-muted-foreground">
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <Link href={hrefFor(page + 1)} className="inline-flex min-h-11 items-center font-medium underline-offset-4 hover:underline">
          Next
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
