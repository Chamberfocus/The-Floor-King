/**
 * Schönox self-leveler and primer quantities.
 *
 * This is the calculator at https://schonox.sika.com/calculator/
 * (the HPS page the Schönox site links as "Calculator"). Pulled 2026-11-20
 * from the page script and each product's calculator fields:
 *
 *   units = ceil(areaSqFt × rowValue / coefficient)
 *
 * The page tells you to add 5–10% for job conditions. That note is not part
 * of the calculation, so it is not added here.
 */

export type SchonoxRow = { label: string; value: number };

export type SchonoxProduct = {
  id: string;
  name: string;
  /** What the calculator column calls the result. */
  unit: "bag" | "each";
  coefficient: number;
  rows: SchonoxRow[];
};

function rows(labels: string, values: string): SchonoxRow[] {
  const names = labels.split(",").map((s) => s.trim());
  const nums = values.split(",").map((s) => Number(s.trim()));
  return names.map((label, i) => ({ label, value: nums[i]! }));
}

/** Floor levelers from the Schönox calculator, in the order the shop pours them. */
export const SCHONOX_LEVELERS: SchonoxProduct[] = [
  {
    id: "us",
    name: "Schönox US",
    unit: "bag",
    coefficient: 7,
    rows: rows(
      '1/8", 1/4", 3/8", 1/2", 3/4", 1", 1-1/4", 1-1/2", 1-3/4", 2", 2-1/4", 2-3/8", 3"',
      "0.125, 0.25, 0.375, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.375, 3",
    ),
  },
  {
    id: "s1500",
    name: "Schönox S1500",
    unit: "bag",
    coefficient: 6,
    rows: rows(
      '1/8", 1/4", 3/8", 1/2", 3/4", 1", 1-1/4", 1-1/2"',
      "0.125, 0.25, 0.375, 0.5, 0.75, 1, 1.25, 1.5",
    ),
  },
  {
    id: "zm",
    name: "Schönox ZM",
    unit: "bag",
    coefficient: 7.5,
    rows: rows(
      '1/8", 1/4", 3/8", 1/2", 5/8", 3/4", 7/8", 1.5"',
      "0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1.5",
    ),
  },
  {
    id: "zm-rapid",
    name: "Schönox ZM Rapid",
    unit: "bag",
    coefficient: 7.5,
    rows: rows(
      '1/8", 1/4", 3/8", 1/2", 5/8", 3/4", 7/8", 1", 1.5"',
      "0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1.0, 1.5",
    ),
  },
  {
    id: "xm",
    name: "Schönox XM",
    unit: "bag",
    coefficient: 7.5,
    rows: rows(
      '1/8", 1/4", 3/8", 1/2", 1"',
      "0.125, 0.25, 0.375, 0.5, 1.0",
    ),
  },
  {
    id: "ap",
    name: "Schönox AP",
    unit: "bag",
    coefficient: 7.5,
    rows: rows(
      '1/8", 1/4", 3/8", 1/2", 3/4", 1", 1-1/4", 1-1/2", 1-3/4", 2"',
      "0.125, 0.25, 0.375, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2",
    ),
  },
  {
    id: "ap-rapid",
    name: "Schönox AP Rapid",
    unit: "bag",
    coefficient: 7.5,
    rows: rows(
      '1/16", 1/8", 1/4", 3/8", 1/2"',
      "0.0625, 0.125, 0.25, 0.375, 0.5",
    ),
  },
  {
    id: "ap-rapid-plus",
    name: "Schönox AP Rapid Plus",
    unit: "bag",
    coefficient: 7,
    rows: rows(
      '1/8", 1/4", 3/8", 1/2", 3/4", 1", 1-1/4", 1-1/2", 1-3/4", 2", 3"',
      "0.125, 0.25, 0.375, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3",
    ),
  },
  {
    id: "apf",
    name: "Schönox APF",
    unit: "bag",
    coefficient: 7.5,
    rows: rows(
      '1/8", 1/4", 3/8", 1/2", 5/8"',
      "0.125, 0.25, 0.375, 0.5, 0.625",
    ),
  },
  {
    id: "am-plus",
    name: "Schönox AM PLUS",
    unit: "bag",
    coefficient: 6.5,
    rows: rows(
      '1/4", 3/8", 1/2", 3/4", 1", 1-1/4", 1-1/2", 1-3/4", 2"',
      "0.25, 0.375, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2",
    ),
  },
  {
    id: "dsp-plus",
    name: "Schönox DSP PLUS",
    unit: "bag",
    coefficient: 4.5,
    rows: rows(
      '3/8", 1/2", 3/4", 1", 1-1/4", 1-1/2", 1-3/4", 2"',
      "0.375, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2",
    ),
  },
];

/** Primers the Schönox calculator sizes before a pour. */
export const SCHONOX_PRIMERS: SchonoxProduct[] = [
  {
    id: "vd",
    name: "Schönox VD",
    unit: "each",
    coefficient: 1,
    rows: rows(
      "Undiluted, Diluted 1:1, Diluted 1:3",
      "0.00076923076, 0.00066666666, 0.0005",
    ),
  },
  {
    id: "kh-fix",
    name: "Schönox KH FIX",
    unit: "each",
    coefficient: 1,
    rows: rows(
      "Primer over porous surface, Primer over absorbent surface, Primer for Roll & Go using R&G roller",
      "0.00104166666, 0.00172413793, 0.0004",
    ),
  },
  {
    id: "shp",
    name: "Schönox SHP",
    unit: "each",
    coefficient: 1,
    rows: rows(
      "1 Gallon unit, 2.44 Gallon unit, 2.5 gallon unit",
      "0.00235294117, 0.00098522167, 0.00097560975",
    ),
  },
  {
    id: "fp",
    name: "Schönox FP",
    unit: "each",
    coefficient: 1,
    rows: rows(
      "Depending on porosity and layer thickness, When used to embed Renotex",
      "0.003333333, 0.00769230",
    ),
  },
  {
    id: "mr-18",
    name: "Schönox MR 18",
    unit: "each",
    coefficient: 1,
    rows: rows("One coat system, Two coat system", "0.001, 0.002"),
  },
  {
    id: "epa",
    name: "Schönox EPA",
    unit: "each",
    coefficient: 1,
    rows: rows("One coat system", "0.00344827586"),
  },
  {
    id: "epa-rapid",
    name: "Schönox EPA Rapid",
    unit: "each",
    coefficient: 1,
    rows: rows("One coat system", "0.00333333333"),
  },
];

/**
 * One tap from the substrate to the primer row Schönox prints for that floor.
 * Porous concrete is VD diluted 1:3. Gypsum is KH FIX at the absorbent rate.
 * Tile, vinyl, adhesive, plywood, and OSB are SHP.
 */
export const SCHONOX_SUBSTRATES: { id: string; label: string; primerId: string; row: string }[] = [
  { id: "porous-concrete", label: "Porous concrete", primerId: "vd", row: "Diluted 1:3" },
  { id: "gypsum", label: "Gypsum", primerId: "kh-fix", row: "Primer over absorbent surface" },
  { id: "nonporous", label: "Tile, vinyl, or old adhesive", primerId: "shp", row: "1 Gallon unit" },
  { id: "wood", label: "Plywood or OSB", primerId: "shp", row: "1 Gallon unit" },
];

const ALL = [...SCHONOX_LEVELERS, ...SCHONOX_PRIMERS];

export function schonoxProduct(id: string | null | undefined): SchonoxProduct | null {
  const key = (id ?? "").trim();
  if (!key) return null;
  return ALL.find((p) => p.id === key) ?? null;
}

export type SchonoxCount = {
  units: number;
  unit: "bag" | "each";
  name: string;
  rowLabel: string;
  /** Square feet one bag or unit covers at this row. */
  coverageSqft: number;
  /** Pour thickness in inches. Null for a primer. */
  thicknessIn: number | null;
};

/**
 * Units for one Schönox product row. Null when the product or row is not
 * on the calculator, or the area is not a positive number.
 */
export function schonoxCount(
  areaSqFt: number,
  productId: string | null | undefined,
  rowLabel: string | null | undefined,
): SchonoxCount | null {
  const product = schonoxProduct(productId);
  const label = (rowLabel ?? "").trim();
  const area = Number(areaSqFt);
  if (!product || !label || !(area > 0)) return null;
  const row = product.rows.find((r) => r.label === label);
  if (!row || !(row.value > 0) || !(product.coefficient > 0)) return null;
  const units = Math.ceil((area * row.value) / product.coefficient);
  if (!(units > 0)) return null;
  return {
    units,
    unit: product.unit,
    name: product.name,
    rowLabel: row.label,
    coverageSqft: product.coefficient / row.value,
    thicknessIn: product.unit === "bag" ? row.value : null,
  };
}
