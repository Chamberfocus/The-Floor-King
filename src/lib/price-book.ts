// Cleveland Floor King price book — the real per-item COSTS for labor and
// materials, grouped the way the estimator thinks about a job. One source of
// truth: the estimate builders surface these as a searchable picker so a line
// drops in with the cost already filled (and editable per job).
//
// `cost` is OUR cost; the builder marks it up to the sell price at the job's
// margin. `labor` items price as labor (no material markup line), everything
// else as material. Units match the builder's add-on units
// (sqft | sqyd | lnft | each | step).

export interface PriceItem {
  label: string;
  unit: "sqft" | "sqyd" | "lnft" | "each" | "step";
  labor: boolean;
  cost: number;
}
export interface PriceGroup {
  group: string;
  items: PriceItem[];
}

export const PRICE_BOOK: PriceGroup[] = [
  {
    group: "Installation labor",
    items: [
      { label: "Vinyl plank basic installation", unit: "sqft", labor: true, cost: 3.62 },
      { label: "Laminate basic installation", unit: "sqft", labor: true, cost: 3.15 },
      { label: "Hardwood basic installation", unit: "sqft", labor: true, cost: 5.25 },
      { label: "Hardwood basic glue installation", unit: "sqft", labor: true, cost: 5.95 },
      { label: "Carpet basic labor", unit: "sqyd", labor: true, cost: 8.5 },
      { label: "Hollywood steps", unit: "step", labor: true, cost: 18.5 },
    ],
  },
  {
    group: "Tear-out / demo",
    items: [
      { label: "Demo carpet", unit: "sqft", labor: true, cost: 1.0 },
      { label: "Demo hardwood", unit: "sqft", labor: true, cost: 1.67 },
      { label: "Demo LVP / laminate", unit: "sqft", labor: true, cost: 1.05 },
      { label: "Ceramic tear out", unit: "sqft", labor: true, cost: 4.16 },
    ],
  },
  {
    group: "Floor prep",
    items: [
      { label: "Skimcoat with labor", unit: "sqft", labor: true, cost: 1.65 },
      { label: "Prime with labor", unit: "sqft", labor: true, cost: 1.05 },
      { label: "Self leveling (per bag)", unit: "each", labor: false, cost: 84.0 },
      { label: "Pressure sensitive adhesive", unit: "sqft", labor: false, cost: 0.24 },
    ],
  },
  {
    group: "Shoe / quarter round / wallbase",
    items: [
      { label: "Painted shoe molding", unit: "lnft", labor: false, cost: 1.57 },
      { label: "Primed shoe molding", unit: "lnft", labor: false, cost: 1.57 },
      { label: "Painted quarter round", unit: "lnft", labor: false, cost: 2.78 },
      { label: "Primed quarter round", unit: "lnft", labor: false, cost: 2.78 },
      { label: '4 1/4" primed wallbase', unit: "lnft", labor: false, cost: 2.95 },
      { label: '5 1/4" painted wallbase', unit: "lnft", labor: false, cost: 2.95 },
      { label: '4" cove base', unit: "lnft", labor: false, cost: 2.27 },
      { label: '6" cove base', unit: "lnft", labor: false, cost: 2.76 },
    ],
  },
  {
    group: "Transitions",
    items: [
      { label: "Stairnose", unit: "each", labor: false, cost: 50.0 },
      { label: "Hardwood stairnose", unit: "each", labor: false, cost: 92.0 },
      { label: "Reducer", unit: "each", labor: false, cost: 50.0 },
      { label: "T-mold", unit: "each", labor: false, cost: 50.0 },
      { label: "End cap", unit: "each", labor: false, cost: 50.0 },
    ],
  },
  {
    group: "Metals",
    items: [
      { label: "Flat metal", unit: "lnft", labor: false, cost: 1.48 },
      { label: "Grip metal", unit: "lnft", labor: false, cost: 1.48 },
    ],
  },
  {
    group: "J-channel",
    items: [
      { label: "2-3mm J-channel", unit: "lnft", labor: false, cost: 1.72 },
      { label: "5mm J-channel", unit: "lnft", labor: false, cost: 1.76 },
      { label: "6-7mm J-channel", unit: "lnft", labor: false, cost: 1.94 },
      { label: "8mm J-channel (8ft)", unit: "lnft", labor: false, cost: 3.08 },
      { label: "10mm J-channel — laminate Titanium ONLY (8ft)", unit: "lnft", labor: false, cost: 3.28 },
      { label: "2-3mm stairnose J-channel", unit: "lnft", labor: false, cost: 3.91 },
      { label: "5mm stairnose J-channel", unit: "lnft", labor: false, cost: 4.11 },
      { label: "6-7mm stairnose J-channel", unit: "lnft", labor: false, cost: 5.44 },
      { label: "8mm stairnose J-channel (8ft)", unit: "lnft", labor: false, cost: 6.25 },
    ],
  },
  {
    group: "Subfloor (per sheet)",
    items: [
      { label: '1/4" subfloor', unit: "each", labor: false, cost: 47.25 },
      { label: '3/8" subfloor', unit: "each", labor: false, cost: 68.75 },
      { label: '1/2" subfloor', unit: "each", labor: false, cost: 69.8 },
      { label: '5/8" subfloor', unit: "each", labor: false, cost: 78.85 },
      { label: '3/4" subfloor', unit: "each", labor: false, cost: 89.94 },
    ],
  },
  {
    group: "Carpet padding",
    items: [
      { label: "7/16 6lb padding", unit: "sqyd", labor: false, cost: 1.91 },
      { label: "7/16 8lb padding", unit: "sqyd", labor: false, cost: 2.25 },
      { label: "7/16 8lb padding with moisture", unit: "sqyd", labor: false, cost: 2.56 },
      { label: "1/2 8lb padding", unit: "sqyd", labor: false, cost: 2.79 },
    ],
  },
  {
    group: "Other",
    items: [
      { label: "Dumpster", unit: "each", labor: false, cost: 350.0 },
      { label: "Pull & reset toilet / sink", unit: "each", labor: true, cost: 75.0 },
      { label: "Furniture moves", unit: "sqft", labor: true, cost: 0.34 },
    ],
  },
];

/** Flat list of every price-book item (for search / lookup). */
export const PRICE_BOOK_ITEMS: PriceItem[] = PRICE_BOOK.flatMap((g) => g.items);
