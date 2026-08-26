/**
 * What a product needs to be described, by what it IS.
 *
 * Adding a product asked every product the same questions: a carpet was offered
 * coverage-per-bag, a bag of patch was offered a roll width, and none of them
 * were asked the things that actually identify them. All the information was on
 * screen and most of it didn't pertain, which is exactly as unhelpful as having
 * none of it.
 *
 * The sets below are what the trade publishes on a data sheet — carpet is sold
 * on face weight and fibre off a 12' or 15' roll; sheet vinyl on wear layer and
 * gauge off a 6' or 12' roll; LVP on wear layer, thickness and coverage per box;
 * laminate on its AC class; tile on PEI. Getting this right is what makes the
 * quote read like it came from a flooring company.
 */

export interface SpecField {
  /** Column on `products`. */
  key: string;
  label: string;
  /** Short hint under the input — the unit, or the range you'd expect. */
  hint?: string;
  kind: "number" | "text" | "choice";
  /** For `choice`, the options; for `number`, ignored. */
  options?: string[];
  /** Shown first and worth nudging for — the field that defines the product. */
  primary?: boolean;
}

const ROLL_WIDTH_CARPET: SpecField = {
  key: "roll_width_ft",
  label: "Roll width",
  hint: "Broadloom comes 12' or 15'",
  kind: "choice",
  options: ["12", "15"],
  primary: true,
};

const ROLL_WIDTH_SHEET: SpecField = {
  key: "roll_width_ft",
  label: "Roll width",
  hint: "Sheet vinyl is usually 6' or 12'",
  kind: "choice",
  options: ["6", "12"],
  primary: true,
};

const WEAR_LAYER: SpecField = {
  key: "wear_layer_mil",
  label: "Wear layer",
  hint: "mils — 6 to 12 residential, 20+ commercial",
  kind: "number",
  primary: true,
};

const THICKNESS: SpecField = {
  key: "thickness_mm",
  label: "Thickness",
  hint: "mm — overall gauge",
  kind: "number",
};

const SQFT_PER_BOX: SpecField = {
  key: "sqft_per_box",
  label: "Sq ft per box",
  hint: "Drives the box count on the order",
  kind: "number",
  primary: true,
};

/**
 * The fields worth asking for, per category. Anything not listed simply isn't
 * shown — that's the point.
 */
export function specFieldsFor(category: string | null | undefined): SpecField[] {
  switch (category) {
    case "carpet":
      return [
        ROLL_WIDTH_CARPET,
        {
          key: "face_weight_oz",
          label: "Face weight",
          hint: "oz per sq yd — the quality number",
          kind: "number",
          primary: true,
        },
        {
          key: "fiber",
          label: "Fibre",
          kind: "choice",
          options: ["Nylon 6,6", "Nylon 6", "Polyester", "Triexta", "Olefin", "Wool"],
        },
      ];

    case "vinyl": // sheet vinyl — a roll good, like carpet
      return [
        ROLL_WIDTH_SHEET,
        WEAR_LAYER,
        { ...THICKNESS, hint: "mm — gauge, e.g. 1.3 or 1.4" },
      ];

    case "lvp":
      return [
        WEAR_LAYER,
        { ...THICKNESS, hint: "mm — plank thickness incl. any attached pad" },
        SQFT_PER_BOX,
      ];

    case "laminate":
      return [
        {
          key: "wear_rating",
          label: "AC rating",
          hint: "Abrasion class — AC3 residential, AC4/AC5 commercial",
          kind: "choice",
          options: ["AC1", "AC2", "AC3", "AC4", "AC5"],
          primary: true,
        },
        THICKNESS,
        SQFT_PER_BOX,
      ];

    case "hardwood":
      return [
        {
          key: "species",
          label: "Species & construction",
          hint: "e.g. White oak, engineered",
          kind: "text",
          primary: true,
        },
        { ...THICKNESS, hint: "mm — overall" },
        SQFT_PER_BOX,
      ];

    case "tile":
      return [
        {
          key: "wear_rating",
          label: "PEI rating",
          hint: "Abrasion — III residential floors, IV/V heavy traffic",
          kind: "choice",
          options: ["PEI I", "PEI II", "PEI III", "PEI IV", "PEI V"],
          primary: true,
        },
        SQFT_PER_BOX,
      ];

    case "underlayment":
      return [
        {
          key: "roll_width_ft",
          label: "Roll width",
          hint: "feet",
          kind: "number",
        },
        { ...THICKNESS, hint: "mm" },
      ];

    case "trim":
      return [
        {
          key: "piece_length_in",
          label: "Piece length",
          hint: "inches per stick — turns a measured run into pieces",
          kind: "number",
          primary: true,
        },
      ];

    // Prep goods (patch, self-leveller) are bought by the bag and sized from
    // coverage, which the add form asks for separately.
    default:
      return [];
  }
}

/** A one-line spec summary for a product, in the order the trade says it. */
export function specSummary(p: Record<string, unknown>): string | null {
  const bits: string[] = [];
  const n = (k: string) => {
    const v = p[k];
    return v === null || v === undefined || v === "" ? null : String(v);
  };
  if (n("face_weight_oz")) bits.push(`${n("face_weight_oz")} oz`);
  if (n("fiber")) bits.push(String(p.fiber));
  if (n("wear_layer_mil")) bits.push(`${n("wear_layer_mil")} mil wear layer`);
  if (n("thickness_mm")) bits.push(`${n("thickness_mm")} mm`);
  if (n("wear_rating")) bits.push(String(p.wear_rating));
  if (n("species")) bits.push(String(p.species));
  if (n("roll_width_ft")) bits.push(`${n("roll_width_ft")}' roll`);
  if (n("sqft_per_box")) bits.push(`${n("sqft_per_box")} sq ft/box`);
  return bits.length ? bits.join(" · ") : null;
}
