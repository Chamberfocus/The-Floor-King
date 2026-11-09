/**
 * Words for installer days off. Safe to import from the phone screen.
 * The database read stays in src/lib/data/crew-availability.ts.
 */
export type AvailabilityKind = "off" | "busy";

/** Words the installer and the office both use for the same two kinds. */
export function availabilityKindLabel(kind: AvailabilityKind): string {
  return kind === "busy" ? "Cannot work" : "Day off";
}

/** Office label. A private block stays "Unavailable". A custom note is kept. */
export function officeAvailabilityLabel(block: {
  kind: AvailabilityKind;
  label: string;
  is_private: boolean;
}): string {
  if (block.is_private) return "Unavailable";
  if (!block.label || block.label === "Time off" || block.label === "Busy") {
    return availabilityKindLabel(block.kind);
  }
  return block.label;
}
