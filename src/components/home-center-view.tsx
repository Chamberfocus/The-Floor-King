import Link from "next/link";
import type { HomeCommandBoard } from "@/lib/data/home-center";

export function HomeCenterView({ board }: { board: HomeCommandBoard }) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{board.greeting}</h1>
        <p className="mt-1 text-sm text-muted-foreground">What needs attention.</p>
      </header>

      {board.unavailable ? (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          This list is temporarily unavailable. Please try again.
        </p>
      ) : null}

      {board.items.length === 0 && !board.unavailable ? (
        <p role="status" className="rounded-lg border bg-card px-4 py-3 text-sm">
          Nothing is waiting right now.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" aria-labelledby="home-work-heading">
          <li className="sr-only">
            <h2 id="home-work-heading">Work that needs attention</h2>
          </li>
          {board.items.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className="flex min-h-11 items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-base font-medium hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0">{item.text}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{item.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
