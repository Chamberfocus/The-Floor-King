"use client";

import { useEffect, useState } from "react";
import { lookupVersatrimTransitions } from "./versatrim-actions";
import {
  VERSATRIM_PROFILE_LABEL,
  VERSATRIM_PROFILES,
  type VersatrimHit,
  type VersatrimMatch,
  type VersatrimProfile,
  type VersatrimQuery,
} from "@/lib/versatrim";

function queryKey(product: VersatrimQuery): string {
  return [product.manufacturer, product.style, product.color, product.label]
    .map((part) => (part ?? "").trim().toLowerCase())
    .join("|");
}

const memory = new Map<string, VersatrimMatch>();

export function VersatrimMatchCard({
  product,
  profile,
  onUse,
}: {
  product: VersatrimQuery;
  /** One trim row asks about one profile. The product card shows all four. */
  profile?: VersatrimProfile | null;
  onUse?: (hit: VersatrimHit) => void;
}) {
  const manufacturer = product.manufacturer ?? "";
  const style = product.style ?? "";
  const color = product.color ?? "";
  const label = product.label ?? "";
  const key = queryKey(product);
  const cached = memory.get(key) ?? null;
  const [fetched, setFetched] = useState<{ key: string; match: VersatrimMatch } | null>(null);
  const match = cached ?? (fetched?.key === key ? fetched.match : null);
  const pending = !match;

  useEffect(() => {
    if (memory.has(key)) return;
    const query = { manufacturer, style, color, label };
    let cancelled = false;
    lookupVersatrimTransitions(query)
      .then((next) => {
        memory.set(key, next);
        if (!cancelled) setFetched({ key, match: next });
      })
      .catch(() => {
        if (cancelled) return;
        const failed: VersatrimMatch = {
          ok: false,
          term: color || style || null,
          searchUrl: null,
          message: "Versatrim did not answer. Check versatrim.com before you order.",
          profiles: { stair_nose: null, end_cap: null, t_mold: null, reducer: null },
        };
        memory.set(key, failed);
        setFetched({ key, match: failed });
      });
    return () => {
      cancelled = true;
    };
  }, [key, manufacturer, style, color, label]);

  const name = (product.color || product.style || product.label || "this floor").trim();
  const profiles = profile ? [profile] : [...VERSATRIM_PROFILES];

  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 px-2.5 py-2 text-xs">
      <div className="font-semibold">Versatrim for {name}</div>
      {pending ? <p className="mt-1 text-muted-foreground">Checking Versatrim…</p> : null}
      {!pending && match?.message ? (
        <p className="mt-1 text-muted-foreground">
          {match.message}{" "}
          {match.searchUrl ? (
            <a href={match.searchUrl} target="_blank" rel="noreferrer" className="underline">
              Open Versatrim
            </a>
          ) : null}
        </p>
      ) : null}
      {!pending && match && !match.message ? (
        <ul className="mt-1 space-y-1">
          {profiles.map((kind) => {
            const hit = match.profiles[kind];
            const label = VERSATRIM_PROFILE_LABEL[kind];
            return (
              <li key={kind} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-medium">{label}</span>
                {hit ? (
                  <>
                    <a href={hit.url || match.searchUrl || "https://versatrim.com"} target="_blank" rel="noreferrer" className="underline">
                      {hit.sku || hit.title}
                      {hit.brand ? ` · ${hit.brand}` : ""}
                      {hit.via === "slim_trim" ? " · SlimTrim" : ""}
                      {hit.via === "versaedge" ? " · VersaEdge" : ""}
                    </a>
                    {onUse ? (
                      <button
                        type="button"
                        className="font-medium text-primary underline"
                        onClick={() => onUse(hit)}
                      >
                        Use on this line
                      </button>
                    ) : null}
                  </>
                ) : (
                  <span className="text-muted-foreground">
                    Not listed. Order the matching {label.toLowerCase()} from{" "}
                    {product.manufacturer?.trim() || "the flooring manufacturer"}.
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
