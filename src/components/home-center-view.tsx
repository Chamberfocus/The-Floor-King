import Link from "next/link";
import type { HomeCommandBoard } from "@/lib/data/home-center";
import type { HomePerson } from "@/lib/home-people";

export function HomeCenterView({
  board,
  people,
  customersHref,
}: {
  board: HomeCommandBoard;
  people: HomePerson[];
  customersHref?: string | null;
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{board.greeting}</h1>
          <p className="mt-1 text-sm text-muted-foreground">What needs you today.</p>
        </div>
        <div className="flex flex-wrap gap-4">
          <Link href="/shop-talk" className="text-sm font-medium text-primary hover:underline">
            Shop talk
          </Link>
          {customersHref ? (
            <Link href={customersHref} className="text-sm font-medium text-primary hover:underline">
              Customer list
            </Link>
          ) : null}
        </div>
      </header>

      {board.unavailable ? (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          This list is temporarily unavailable. Please try again.
        </p>
      ) : null}

      {people.length ? (
        <section aria-labelledby="home-people-heading">
          <h2 id="home-people-heading" className="text-sm font-semibold">
            Who needs you
          </h2>
          <ul className="mt-2 flex flex-col gap-2">
            {people.map((person) => (
              <li key={person.href}>
                <Link
                  href={person.href}
                  className="flex min-h-11 flex-col justify-center gap-0.5 rounded-lg border bg-card px-4 py-3 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="font-medium">{person.name}</span>
                  <span className="text-sm text-muted-foreground">{person.why}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {board.items.length === 0 && people.length === 0 && !board.unavailable ? (
        <p role="status" className="rounded-lg border bg-card px-4 py-3 text-sm">
          Nothing is waiting right now.
        </p>
      ) : board.items.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-labelledby="home-work-heading">
          <li className="sr-only">
            <h2 id="home-work-heading">Work that needs attention</h2>
          </li>
          {people.length ? (
            <li className="px-1 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Full lists
            </li>
          ) : null}
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
      ) : null}
    </div>
  );
}
