import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { SaleFocusPath } from "@/components/sale-focus-path";
import { SaleFocusPin } from "@/components/sale-focus-pin";
import type { SaleFocusBoard } from "@/lib/data/sale-focus";
import { cn } from "@/lib/utils";

export function SaleFocusHome({ board }: { board: SaleFocusBoard }) {
  const focus = board.focus;
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <SaleFocusPin
        customerId={focus?.id ?? ""}
        customerName={focus?.name ?? ""}
        active={!!focus}
      />
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{board.greeting}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {focus
            ? `Stay with ${focus.name} until this sale moves on.`
            : "One customer at a time."}
        </p>
      </header>

      {board.unavailable ? (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          This list is temporarily unavailable. Please try again.
        </p>
      ) : null}

      {focus ? (
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{focus.name}</h2>
          {focus.city ? <p className="text-sm text-muted-foreground">{focus.city}</p> : null}
          <div className="mt-3">
            <SaleFocusPath focus={focus.path} customerName={focus.name} />
          </div>
        </div>
      ) : !board.unavailable ? (
        <div className="rounded-lg border bg-card px-4 py-4 text-sm">
          <p>No open sale is waiting.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/customers/new" className={cn(buttonVariants({ size: "lg" }), "min-h-11")}>
              Add a customer
            </Link>
            <Link
              href="/customers"
              className={cn(buttonVariants({ size: "lg", variant: "outline" }), "min-h-11")}
            >
              Open the customer list
            </Link>
          </div>
        </div>
      ) : null}

      {board.others.length ? (
        <section aria-labelledby="other-sales">
          <h2 id="other-sales" className="text-sm font-semibold">
            Switch customer
          </h2>
          <ul className="mt-2 flex flex-col gap-2">
            {board.others.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/customers/${row.id}`}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-sm hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{row.name}</span>
                    {row.city ? (
                      <span className="block text-xs text-muted-foreground">{row.city}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{row.stepTitle}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
