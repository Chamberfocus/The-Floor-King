// Shared add-on checklist definitions — used by the smart estimate builder and
// the Settings → Default pricing page so there's one source of truth.

export type AddonGroup = "carpet" | "hard" | "custom";
export interface AddonDef {
  label: string;
  unit: string;
  labor: boolean;
  choices?: string[];
}

export const METAL_COLORS = ["Silver", "Titanium", "Gold"];

export const CARPET_ADDONS: AddonDef[] = [
  { label: "Carpet installation (labor)", unit: "sqyd", labor: true },
  { label: "Tear out & haul away old carpet & pad", unit: "sqft", labor: true },
  { label: "Tackstrip — wood subfloor", unit: "lnft", labor: true },
  { label: "Tackstrip — concrete (glue / concrete nail)", unit: "lnft", labor: true },
  { label: "Carpet / cover stairs", unit: "step", labor: true },
  { label: "Move furniture", unit: "room", labor: true },
  { label: "Disconnect / move appliances", unit: "each", labor: true },
  { label: "Door shaving", unit: "each", labor: true },
  { label: "Floor prep / leveling", unit: "sqft", labor: true },
  { label: "Subfloor repair / replace", unit: "sqft", labor: true },
  { label: "Flat metal", unit: "each", labor: false, choices: METAL_COLORS },
  { label: "Gripper metal", unit: "each", labor: false, choices: METAL_COLORS },
  { label: "Transition strips (carpet to hard)", unit: "each", labor: false },
  { label: "Place on curb", unit: "each", labor: true },
  { label: "Dumpster / disposal fee", unit: "each", labor: false },
  { label: "Delivery", unit: "each", labor: false }, // see the note in HARD_ADDONS
];

export const HARD_ADDONS: AddonDef[] = [
  { label: "Flooring installation (labor)", unit: "sqft", labor: true },
  { label: "Tear out & haul away old flooring", unit: "sqft", labor: true },
  { label: "Floor prep / self-leveling / skim coat", unit: "sqft", labor: true },
  { label: "Subfloor repair / replace", unit: "sqft", labor: true },
  { label: "Moisture barrier / underlayment", unit: "sqft", labor: false },
  { label: "Pull & reset toilet", unit: "each", labor: true },
  { label: "Disconnect / move appliances", unit: "each", labor: true },
  { label: "Move furniture", unit: "room", labor: true },
  { label: "Baseboard remove & reinstall", unit: "lnft", labor: true },
  { label: "Quarter round / shoe molding", unit: "lnft", labor: false },
  { label: "Flat metal", unit: "each", labor: false, choices: METAL_COLORS },
  { label: "Gripper metal", unit: "each", labor: false, choices: METAL_COLORS },
  { label: "Transition strips / thresholds", unit: "each", labor: false },
  { label: "Door shaving", unit: "each", labor: true },
  { label: "Stair nosing / cap stairs", unit: "step", labor: true },
  { label: "Grout sealing (tile)", unit: "sqft", labor: true },
  { label: "Place on curb", unit: "each", labor: true },
  { label: "Dumpster / disposal fee", unit: "each", labor: false },
  /**
   * The fuel / vehicle charge, recovered in the PRICE.
   *
   * It existed only as job_fuel_charge in settings — a memo the profit panel
   * noted as "already inside the price", which assumed someone had padded the
   * rates by hand. Nobody had, so it was never actually charged.
   *
   * As a real line it IS charged, it flows through to the invoice, and the
   * lines still sum to the subtotal. Labelled "Delivery" because that is what
   * it is to the customer; the gas and car allowance behind it stay internal,
   * in the profit panel. Set the amount in Settings -> Default pricing.
   */
  { label: "Delivery", unit: "each", labor: false },
];

/**
 * The full add-on checklist, deduped by label across carpet + hard surface, so
 * shared items (floor prep, move furniture, metals, dumpster…) appear ONCE.
 * The builder splits these into Labor vs Materials by the `labor` flag. Pad is
 * excluded — it's a roll good handled separately.
 */
export const STANDARD_ADDONS: AddonDef[] = (() => {
  const seen = new Set<string>();
  const out: AddonDef[] = [];
  for (const d of [...CARPET_ADDONS, ...HARD_ADDONS]) {
    if (!seen.has(d.label)) {
      seen.add(d.label);
      out.push(d);
    }
  }
  return out;
})();

/** Pad is a roll good but its default price lives with the add-on defaults. */
export const PAD_ADDON: AddonDef = {
  label: "Carpet pad",
  unit: "sqyd",
  labor: false,
};

/** Every standard add-on once (carpet + hard, deduped by label) + pad. */
export const ALL_ADDON_DEFS: AddonDef[] = (() => {
  const seen = new Set<string>();
  const out: AddonDef[] = [];
  for (const d of [PAD_ADDON, ...CARPET_ADDONS, ...HARD_ADDONS]) {
    if (!seen.has(d.label)) {
      seen.add(d.label);
      out.push(d);
    }
  }
  return out;
})();
