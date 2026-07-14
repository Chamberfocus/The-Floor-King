import type { CustomerScope, ScopeItem } from "@/lib/customer-scope";
import { flooringHighlights, scopeIsEmpty } from "@/lib/customer-scope";

/**
 * Renders a customer-facing scope: every room, product, and piece of work
 * described in words, with NO square footage, linear footage, quantities, or
 * prices. Shared by the printed estimate/invoice and the portal so the customer
 * sees the same thing on paper and on screen.
 *
 * `variant="full"` lists it room by room; `variant="condensed"` gives a tight
 * summary — the estimate's detailed/summary toggle chooses between them, but
 * neither ever exposes a number.
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

  return (
    <div className="space-y-4">
      {hasNarrative ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{narrative}</p>
      ) : null}

      {scopeIsEmpty(scope) ? (
        !hasNarrative ? (
          <p className="text-sm text-muted-foreground">
            Complete flooring project as described.
          </p>
        ) : null
      ) : variant === "condensed" ? (
        <CondensedScope scope={scope} />
      ) : (
        <FullScope scope={scope} />
      )}
    </div>
  );
}

function FullScope({ scope }: { scope: CustomerScope }) {
  return (
    <div className="space-y-4">
      {scope.rooms.map((room) => (
        <div key={room.name} className="break-inside-avoid">
          <h3 className="text-sm font-semibold">{room.name}</h3>
          <ItemList label="Flooring" items={room.flooring} />
          <ItemList label="Includes" items={room.included} />
        </div>
      ))}

      {scope.whole.flooring.length > 0 || scope.whole.included.length > 0 ? (
        <div className="break-inside-avoid">
          <h3 className="text-sm font-semibold">Throughout your home</h3>
          <ItemList label="Flooring" items={scope.whole.flooring} />
          <ItemList label="Includes" items={scope.whole.included} />
        </div>
      ) : null}

      {scope.conditions.length > 0 ? (
        <div className="break-inside-avoid">
          <h3 className="text-sm font-semibold">Site preparation</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
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

function CondensedScope({ scope }: { scope: CustomerScope }) {
  const highlights = flooringHighlights(scope);
  const rooms = scope.rooms.map((r) => r.name).filter(Boolean);
  return (
    <div className="space-y-3 text-sm">
      {rooms.length > 0 ? (
        <p>
          <span className="font-medium">Areas:</span> {rooms.join(", ")}
        </p>
      ) : null}
      {highlights.length > 0 ? (
        <div>
          <div className="font-medium">Materials</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {highlights.map((h, i) => (
              <li key={i}>
                {h.title}
                {h.detail ? <span className="text-muted-foreground"> · {h.detail}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-muted-foreground">
        Includes all materials, professional installation, trim &amp;
        transitions, site preparation, and haul-away as described.
      </p>
      {scope.notes.trim() ? (
        <p className="whitespace-pre-wrap text-muted-foreground">{scope.notes}</p>
      ) : null}
    </div>
  );
}

function ItemList({ label, items }: { label: string; items: ScopeItem[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-1">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <ul className="mt-0.5 space-y-0.5 text-sm">
        {items.map((it, i) => (
          <li key={i} className="flex gap-1.5">
            <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-current opacity-40" />
            <span>
              <span className="font-medium">{it.title}</span>
              {it.detail ? (
                <span className="text-muted-foreground"> — {it.detail}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
