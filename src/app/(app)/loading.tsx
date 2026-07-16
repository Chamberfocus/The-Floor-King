// Shown instantly while a screen loads — so tapping between pages feels like a
// native app (immediate response) instead of a web pause on a blank screen.
// Deliberately SHAPE-AGNOSTIC (a header + a few generic blocks) so it reads fine
// on both list pages and forms, instead of a list-with-avatars that looks wrong
// on a settings/builder screen.
export default function Loading() {
  return (
    <div className="animate-pulse space-y-5" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <div className="h-7 w-48 rounded-md bg-muted" />
        <div className="h-4 w-72 rounded bg-muted/70" />
      </div>
      <div className="space-y-3">
        <div className="h-24 rounded-xl border bg-muted/30" />
        <div className="h-24 rounded-xl border bg-muted/30" />
        <div className="h-24 rounded-xl border bg-muted/30" />
      </div>
    </div>
  );
}
