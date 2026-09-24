import Link from "next/link";
import { homeSectionCount, type HomeCenter, type HomeItem, type HomeSection } from "@/lib/home-actions";

const PRIORITY_LABEL = {
  urgent: "Urgent",
  today: "Today",
  upcoming: "Upcoming",
} as const;

export function HomeCenterView({ center }: { center: HomeCenter }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{center.greeting}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What needs you, what is happening today, and where to go next.
        </p>
      </header>

      {center.caughtUp ? (
        <p className="rounded-lg border bg-card px-4 py-3 text-sm" role="status">
          You&apos;re caught up. No urgent items and nothing due today.
        </p>
      ) : null}

      {center.sections.map((section) => (
        <HomeSectionBlock key={section.id} section={section} count={homeSectionCount(center, section.id)} />
      ))}
    </div>
  );
}

function HomeSectionBlock({ section, count }: { section: HomeSection; count: number }) {
  return (
    <section aria-labelledby={`home-${section.id}`}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id={`home-${section.id}`} className="text-lg font-semibold">
          {section.label}
        </h2>
        <p className="text-sm text-muted-foreground">
          {section.label} {count}
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {section.items.map((item) => (
          <li key={item.id}>
            <HomeCard item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function HomeCard({ item }: { item: HomeItem }) {
  return (
    <article className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {PRIORITY_LABEL[item.priority]}
          </p>
          <h3 className="mt-1 text-base font-semibold">{item.title}</h3>
          <p className="mt-1 text-sm">{item.why}</p>
          {item.subject ? <p className="mt-2 text-sm font-medium">{item.subject}</p> : null}
          {item.meta ? <p className="text-sm text-muted-foreground">{item.meta}</p> : null}
          {item.owner ? <p className="text-sm text-muted-foreground">{item.owner}</p> : null}
        </div>
        <Link
          href={item.href}
          className="inline-flex min-h-11 shrink-0 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {item.action}
        </Link>
      </div>
    </article>
  );
}
