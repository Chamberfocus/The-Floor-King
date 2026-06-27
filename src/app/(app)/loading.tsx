// Shown instantly while a screen loads — so tapping between pages feels like a
// native app (immediate response) instead of a web pause on a blank screen.
export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Loading">
      {/* Page header */}
      <div className="space-y-2">
        <div className="h-7 w-44 rounded-md bg-muted" />
        <div className="h-4 w-64 rounded bg-muted/70" />
      </div>
      {/* Content rows */}
      <div className="space-y-2.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
            <div className="size-9 shrink-0 rounded-full bg-muted" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-1/2 rounded bg-muted" />
              <div className="h-3 w-1/3 rounded bg-muted/70" />
            </div>
            <div className="h-5 w-14 rounded-full bg-muted/70" />
          </div>
        ))}
      </div>
    </div>
  );
}
