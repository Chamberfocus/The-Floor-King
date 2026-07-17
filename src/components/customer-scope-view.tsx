import type { CustomerScope, ScopeItem } from "@/lib/customer-scope";
import { flooringHighlights, scopeIsEmpty } from "@/lib/customer-scope";

/**
 * Renders a customer-facing scope: every room, product, and piece of work
 * described in words, with NO square footage, linear footage, quantities, or
 * prices. Shared by the printed estimate/invoice and the portal so the customer
 * sees the same thing on paper and on screen.
 *
 * The flooring the customer is buying is FEATURED up top (large, bold). Then:
 * `variant="full"` lists the project room by room with site preparation;
 * `variant="condensed"` keeps just the featured materials + an all-inclusive
 * line. Neither ever exposes a number.
 */
export function CustomerScopeView({
  scope,
  variant = "full",
  narrative,
}: {
  scope: CustomerScope;
  variant?: "full" | "condensed";
  narrative?: string | null;
}) {
  const hasNarrative = !!narrative && narrative.trim().length > 0;
  const highlights = flooringHighlights(scope);
  const empty = scopeIsEmpty(scope);

  return (
    <div className="space-y-4">
      <FeaturedFlooring highlights={highlights} />

      {variant === "condensed" ? (
        <p className="text-base leading-relaxed text-gray-700 dark:text-gray-300">
          Includes all materials, professional installation, trim &amp;
          transitions, site preparation, and haul-away as described — for one
          all-inclusive price.
        </p>
      ) : (
        <>
          {hasNarrative ? (
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{narrative}</p>
          ) : null}
          {empty ? (
            !hasNarrative && highlights.length === 0 ? (
              <p className="text-[15px] text-muted-foreground">
                Complete flooring project as described.
              </p>
            ) : null
          ) : (
            <FullScope scope={scope} />
          )}
        </>
      )}

      {variant === "condensed" && scope.notes.trim() ? (
        <p className="whitespace-pre-wrap text-[15px] text-muted-foreground">{scope.notes}</p>
      ) : null}
    </div>
  );
}

/** The flooring the customer is getting, featured large & bold. Shared by the
 *  lump-sum and itemized customer copies so materials always stand out. */
export function FeaturedFlooring({ highlights }: { highlights: ScopeItem[] }) {
  if (!highlights.length) return null;
  return (
    <div className="break-inside-avoid rounded-xl border-2 border-gray-300 px-4 py-3 dark:border-gray-600">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
        Your new flooring
      </div>
      <ul className="space-y-1">
        {highlights.map((h, i) => (
          <li key={i} className="leading-snug">
            <span className="text-lg font-bold sm:text-xl">{h.title}</span>
            {h.detail ? (
              <span className="ml-1.5 text-[15px] text-gray-600 dark:text-gray-300">— {h.detail}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FullScope({ scope }: { scope: CustomerScope }) {
  return (
    <div className="space-y-3">
      {scope.rooms.map((room) => (
        <div key={room.name} className="break-inside-avoid">
          <h3 className="text-base font-bold">{room.name}</h3>
          <ItemList label="Flooring" items={room.flooring} />
          <ItemList label="Includes" items={room.included} />
        </div>
      ))}

      {scope.whole.flooring.length > 0 || scope.whole.included.length > 0 ? (
        <div className="break-inside-avoid">
          <h3 className="text-base font-bold">Throughout your home</h3>
          <ItemList label="Flooring" items={scope.whole.flooring} />
          <ItemList label="Includes" items={scope.whole.included} />
        </div>
      ) : null}

      {scope.conditions.length > 0 ? (
        <div className="break-inside-avoid">
          <h3 className="text-base font-bold">Site preparation</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm leading-relaxed">
            {scope.conditions.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {scope.notes.trim() ? (
        <p className="whitespace-pre-wrap break-inside-avoid text-sm text-muted-foreground">
          {scope.notes}
        </p>
      ) : null}
    </div>
  );
}

function ItemList({ label, items }: { label: string; items: ScopeItem[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-1">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <ul className="mt-0.5 space-y-0.5 text-sm leading-snug">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-current opacity-40" />
            <span>
              <span className="font-semibold">{it.title}</span>
              {it.detail ? (
                <span className="text-gray-600 dark:text-gray-300"> — {it.detail}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
