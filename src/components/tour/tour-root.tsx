"use client";

// This component intentionally synchronizes React state with external systems
// (localStorage prefs/progress on mount, and the current route) inside effects —
// the SSR-safe way to read a browser store — so the set-state-in-effect guard is
// relaxed here.
/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { HelpCircle, X, ChevronRight, ChevronLeft, Check, GraduationCap } from "lucide-react";
import type { UserRole } from "@/lib/types";
import { toursForRole, routeMatches, type Tour, type TourStep } from "@/lib/tours";

/**
 * In-app guided tours. Mounted once in the app shell (survives navigation), so a
 * tour can walk across pages. Highlights REAL elements by their data-tour key;
 * a missing target is skipped, never a crash. Dismissible, re-startable from the
 * "?" button, and fully turn-off-able. Persists progress + preferences in
 * localStorage (per user) — no migration, nothing forced.
 */
export function TourRoot({ role, userId }: { role: UserRole; userId: string }) {
  const tours = useMemo(() => toursForRole(role), [role]);
  const router = useRouter();
  const pathname = usePathname();

  const offKey = `tour:off:${userId}`;
  const offeredKey = `tour:offered:${userId}`;
  const progressKey = `tour:progress:${userId}`;

  const [ready, setReady] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [offered, setOffered] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState<{ id: string; step: number } | null>(null);

  // Restore prefs + any in-progress tour (resumes across a full reload).
  useEffect(() => {
    try {
      setDisabled(localStorage.getItem(offKey) === "1");
      setOffered(localStorage.getItem(offeredKey) === "1");
      const raw = localStorage.getItem(progressKey);
      if (raw) {
        const p = JSON.parse(raw) as { id: string; step: number };
        if (tours.some((t) => t.id === p.id)) setActive(p);
      }
    } catch {
      /* ignore */
    }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeTour: Tour | null = active
    ? (tours.find((t) => t.id === active.id) ?? null)
    : null;
  const step: TourStep | null =
    activeTour && active ? (activeTour.steps[active.step] ?? null) : null;

  const persist = useCallback(
    (next: { id: string; step: number } | null) => {
      try {
        if (next) localStorage.setItem(progressKey, JSON.stringify(next));
        else localStorage.removeItem(progressKey);
      } catch {
        /* ignore */
      }
    },
    [progressKey],
  );

  const start = useCallback(
    (id: string) => {
      const t = tours.find((x) => x.id === id);
      if (!t) return;
      setMenuOpen(false);
      const next = { id, step: 0 };
      setActive(next);
      persist(next);
      try {
        localStorage.setItem(offeredKey, "1");
      } catch {
        /* ignore */
      }
      setOffered(true);
      // Jump to the first step's page if it's a static route we know.
      const s0 = t.steps[0];
      if (s0?.href && !routeMatches(s0.route, pathname)) router.push(s0.href);
    },
    [tours, persist, offeredKey, pathname, router],
  );

  const stop = useCallback(() => {
    setActive(null);
    persist(null);
  }, [persist]);

  const go = useCallback(
    (dir: 1 | -1) => {
      if (!activeTour || !active) return;
      const nextIdx = active.step + dir;
      if (nextIdx < 0) return;
      if (nextIdx >= activeTour.steps.length) {
        stop();
        return;
      }
      const next = { id: active.id, step: nextIdx };
      setActive(next);
      persist(next);
      const ns = activeTour.steps[nextIdx];
      if (dir === 1 && ns.href && !routeMatches(ns.route, pathname)) router.push(ns.href);
    },
    [activeTour, active, persist, pathname, router, stop],
  );

  // Follow the user's real navigation: when the route changes, if the current
  // step no longer matches but a later step does, advance to it.
  useEffect(() => {
    if (!activeTour || !active) return;
    const cur = activeTour.steps[active.step];
    if (cur && routeMatches(cur.route, pathname)) return;
    for (let j = active.step + 1; j < activeTour.steps.length; j++) {
      if (routeMatches(activeTour.steps[j].route, pathname)) {
        const next = { id: active.id, step: j };
        setActive(next);
        persist(next);
        return;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const turnOff = () => {
    stop();
    setMenuOpen(false);
    setDisabled(true);
    try {
      localStorage.setItem(offKey, "1");
    } catch {
      /* ignore */
    }
  };
  const turnOn = () => {
    setDisabled(false);
    try {
      localStorage.setItem(offKey, "0");
    } catch {
      /* ignore */
    }
  };
  const dismissOffer = () => {
    setOffered(true);
    try {
      localStorage.setItem(offeredKey, "1");
    } catch {
      /* ignore */
    }
  };

  if (!ready || !tours.length) return null;

  const showOffer = !disabled && !offered && !active;

  return (
    <>
      {active && step ? (
        <TourOverlay
          step={step}
          index={active.step}
          total={activeTour!.steps.length}
          onNext={() => go(1)}
          onBack={() => go(-1)}
          onExit={stop}
          routeMatched={routeMatches(step.route, pathname)}
        />
      ) : null}

      {/* Auto-offer on first login (per user), dismissible, never forced */}
      {showOffer ? (
        <div className="fixed bottom-20 right-4 z-[70] w-72 rounded-xl border bg-card p-4 shadow-lg md:bottom-6 print:hidden">
          <div className="flex items-start gap-2">
            <GraduationCap className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">New here? Take a quick tour</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                A 2-minute walkthrough of {tours[0].label.toLowerCase()} for your role.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => start(tours[0].id)}
                  className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Start tour
                </button>
                <button
                  type="button"
                  onClick={dismissOffer}
                  className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                >
                  Not now
                </button>
                <button
                  type="button"
                  onClick={turnOff}
                  className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Turn off
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Always-reachable launcher */}
      <div className="fixed bottom-20 right-4 z-[60] print:hidden md:bottom-6">
        {menuOpen ? (
          <div className="mb-2 w-64 rounded-xl border bg-card p-2 shadow-lg">
            <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Guided tours
            </div>
            {disabled ? (
              <p className="px-2 pb-1 text-xs text-muted-foreground">
                Tutorials are off. Turn them on to get the first-login offer back.
              </p>
            ) : null}
            {tours.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => start(t.id)}
                className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted"
              >
                <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>
                  <span className="block text-sm font-medium">{t.label}</span>
                  <span className="block text-xs text-muted-foreground">{t.description}</span>
                </span>
              </button>
            ))}
            <div className="mt-1 border-t pt-1">
              <button
                type="button"
                onClick={disabled ? turnOn : turnOff}
                className="w-full rounded-lg px-2 py-1.5 text-left text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {disabled ? "Turn tutorials on" : "Turn tutorials off"}
              </button>
            </div>
          </div>
        ) : null}
        <button
          type="button"
          aria-label="Help & guided tours"
          onClick={() => setMenuOpen((v) => !v)}
          className="flex size-11 items-center justify-center rounded-full border bg-card text-primary shadow-lg transition-colors hover:bg-muted"
        >
          {menuOpen ? <X className="size-5" /> : <HelpCircle className="size-5" />}
        </button>
      </div>
    </>
  );
}

/** The spotlight + tooltip for one step. Finds the target by data-tour key,
 *  dims around it, points an arrow at it, and offers Back / Next / Skip. */
function TourOverlay({
  step,
  index,
  total,
  onNext,
  onBack,
  onExit,
  routeMatched,
}: {
  step: TourStep;
  index: number;
  total: number;
  onNext: () => void;
  onBack: () => void;
  onExit: () => void;
  routeMatched: boolean;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [missing, setMissing] = useState(false);
  const scrolledFor = useRef<string>("");

  // Locate + track the target (poll briefly, then reposition on scroll/resize).
  useEffect(() => {
    setRect(null);
    setMissing(false);
    if (!step.target || !routeMatched) return;
    // Open a tab-gated target's tab (via #hash) so it renders before we point.
    if (step.hash && window.location.hash.replace("#", "") !== step.hash) {
      window.location.hash = step.hash;
    }
    let raf = 0;
    let tries = 0;
    const locate = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      if (el) {
        const key = `${step.target}:${index}`;
        if (scrolledFor.current !== key) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          scrolledFor.current = key;
        }
        setRect(el.getBoundingClientRect());
        return true;
      }
      return false;
    };
    const tick = () => {
      if (locate()) return;
      tries += 1;
      if (tries > 60) {
        setMissing(true); // ~3s, target never showed → let the user skip on
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    const onMove = () => locate();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [step.target, step.hash, index, routeMatched]);

  // Esc exits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  const centered = !step.target || !routeMatched || (missing && !rect);

  const controls = (
    <div className="mt-3 flex items-center justify-between gap-2">
      <span className="text-[11px] text-muted-foreground">
        Step {index + 1} of {total}
      </span>
      <div className="flex items-center gap-1.5">
        {index > 0 ? (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
          >
            <ChevronLeft className="size-3.5" /> Back
          </button>
        ) : null}
        <button
          type="button"
          onClick={onExit}
          className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={onNext}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          {index + 1 >= total ? (
            <>
              <Check className="size-3.5" /> Done
            </>
          ) : (
            <>
              Next <ChevronRight className="size-3.5" />
            </>
          )}
        </button>
      </div>
    </div>
  );

  // Not on the right page yet (or target still loading) → a small, NON-BLOCKING
  // coach card pinned to the bottom. It never covers the screen, so the tour can
  // never trap the user; the app stays fully usable behind it.
  if (centered) {
    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[80] flex justify-center px-4 print:hidden">
        <div className="pointer-events-auto w-[24rem] max-w-[calc(100vw-2rem)] rounded-xl border bg-card p-4 shadow-2xl ring-1 ring-primary/20">
          <p className="text-sm font-semibold">{step.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
          {step.target && !routeMatched ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Do this step in the app to continue — the tour follows along.
            </p>
          ) : null}
          {missing && routeMatched ? (
            <p className="mt-2 text-xs text-amber-600">
              That control isn&apos;t on this screen right now — Next to continue.
            </p>
          ) : null}
          {controls}
        </div>
      </div>
    );
  }

  // Spotlight around the target. The dim layer is click-through (pointer-events
  // none) so the real element stays usable; only the tooltip captures clicks.
  const pad = 6;
  const r = rect!;
  const top = r.top - pad;
  const left = r.left - pad;
  const width = r.width + pad * 2;
  const height = r.height + pad * 2;
  const place = step.placement ?? (r.top > window.innerHeight / 2 ? "top" : "bottom");
  const tipStyle: React.CSSProperties =
    place === "top"
      ? { top: r.top - 12, left: Math.min(Math.max(r.left, 12), window.innerWidth - 340), transform: "translateY(-100%)" }
      : place === "left"
        ? { top: r.top, left: r.left - 12, transform: "translateX(-100%)" }
        : place === "right"
          ? { top: r.top, left: r.right + 12 }
          : { top: r.bottom + 12, left: Math.min(Math.max(r.left, 12), window.innerWidth - 340) };

  return (
    <div className="pointer-events-none fixed inset-0 z-[80] print:hidden">
      <div
        className="absolute rounded-lg ring-2 ring-primary transition-all"
        style={{
          top,
          left,
          width,
          height,
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
        }}
      />
      <div
        className="pointer-events-auto absolute w-[20rem] max-w-[calc(100vw-1.5rem)] rounded-xl border bg-card p-3.5 shadow-2xl"
        style={tipStyle}
      >
        <p className="text-sm font-semibold">{step.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
        {controls}
      </div>
    </div>
  );
}
