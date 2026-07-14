// Regression tests for the accessory logic. Run: node scripts/test-accessories.ts
import {
  accessoryItemName,
  accessoryQuantity,
  defaultsForType,
  displayVariant,
  isColorPolluted,
  linearFeetForPieces,
  parseAccessoryType,
  piecesForLinearFeet,
  styleIsNotALine,
  variantKey,
} from "../src/lib/accessories.ts";

let pass = 0;
let fail = 0;
function eq(actual: unknown, expected: unknown, what: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
    fail++;
    console.log(`  ✗ ${what}\n      expected ${e}\n      got      ${a}`);
  }
}

console.log("── variantKey: case/spacing variants MUST collapse to one item ──");
eq(variantKey("Gunstock Oak"), "gunstock oak", "title case");
eq(variantKey("GUNSTOCK OAK"), "gunstock oak", "all caps → same key");
eq(variantKey("gunstock-oak"), "gunstock oak", "hyphen → same key");
eq(variantKey("  Gunstock   Oak "), "gunstock oak", "extra spaces → same key");
eq(variantKey("Rabun/Base Camp"), "rabun base camp", "slash");
eq(variantKey(null), "", "null");
eq(
  new Set(["Natural", "NATURAL", "natural"].map(variantKey)).size,
  1,
  "the 120 real case-variant colors collapse to ONE",
);

console.log("── displayVariant ──");
eq(displayVariant("GUNSTOCK OAK"), "Gunstock Oak", "all caps → title");
eq(displayVariant("crisp linen"), "Crisp Linen", "lower → title");
eq(displayVariant("VIVID 3D"), "Vivid 3d", "all caps w/ digits");
eq(displayVariant("McKinley"), "McKinley", "deliberate casing preserved");

console.log("── piecesForLinearFeet: ALWAYS round up (can't buy 2.3 sticks) ──");
eq(piecesForLinearFeet(94 / 12, 94), 1, "exactly one stick");
eq(piecesForLinearFeet(8, 94), 2, "8 lnft (96in) → 2 sticks, not 1.02");
eq(piecesForLinearFeet(7.83, 94), 1, "just under one stick → 1");
eq(piecesForLinearFeet(24, 94), 4, "24 lnft → 4 sticks (3.06 → 4)");
eq(piecesForLinearFeet(0, 94), 0, "zero → zero");
eq(piecesForLinearFeet(-5, 94), 0, "negative → zero");
eq(piecesForLinearFeet(10, 0), 0, "zero stick length → zero, no divide-by-zero");
eq(linearFeetForPieces(4, 94), 31.33, "4 sticks cover 31.33 lnft");

console.log("── accessoryQuantity: unit decides the quantity ──");
eq(
  accessoryQuantity({ linearFeet: 24, unit: "each", pieceLengthIn: 94 }),
  4,
  "each → whole pieces",
);
eq(
  accessoryQuantity({ linearFeet: 24, unit: "lnft" }),
  24,
  "lnft → the run itself",
);
eq(
  accessoryQuantity({ linearFeet: 24.567, unit: "lnft" }),
  24.57,
  "lnft rounds to cents",
);

console.log("── parseAccessoryType: modifiers must NOT collapse into the base ──");
eq(parseAccessoryType("OVERLAP REDUCER MERINGUE"), "Overlap Reducer", "overlap reducer");
eq(parseAccessoryType("FLUSH REDUCER BIANCO"), "Flush Reducer", "flush reducer");
eq(parseAccessoryType("O STAIRNOSE MACAROON"), "Overlap Stair Nose", "O = overlap");
eq(parseAccessoryType("OVERLAP STAIRNOSING BIANCO"), "Overlap Stair Nose", "-NOSING (the 412 that failed before)");
eq(parseAccessoryType("OVERLAP STRNOSE CREME BRULEE"), "Overlap Stair Nose", "STRNOSE abbrev");
eq(parseAccessoryType("ADVANTAGE T MOLD 2X94"), "T-Mold", "T MOLD");
eq(parseAccessoryType("PIETRA T MOLDING"), "T-Mold", "T MOLDING");
eq(parseAccessoryType("QTR ROUND WE MAYFAIR"), "Quarter Round", "QTR ROUND");
eq(parseAccessoryType("THRESHOLD MAYFAIR"), "Threshold", "threshold");
eq(parseAccessoryType("IFC Canopy Comfort Rabun Round Flush Stair Nose"), "Flush Stair Nose", "flush wins over round");
eq(parseAccessoryType("Liberty Bar Harbor Tread 48\" (Flush Stair)"), "Flush Stair Tread", "tread");
eq(parseAccessoryType("Some Quarter Round Thing"), "Quarter Round", "'round' in quarter round is NOT a modifier");
eq(parseAccessoryType("Johnson Lombardy Moisture Resist"), null, "no type → null, never guessed");
eq(parseAccessoryType("Esd Vinyl Galaxy"), null, "no type → null");

console.log("── defaultsForType: millwork varies by SIZE, not color ──");
eq(defaultsForType("Baseboard"), { unit: "lnft", axis: "size" }, "baseboard: primed, sold by the foot");
eq(defaultsForType("Shoe Molding"), { unit: "lnft", axis: "size" }, "shoe: size");
eq(defaultsForType("T-Mold"), { unit: "each", axis: "color" }, "t-mold: color-matched, by the piece");
eq(defaultsForType("Stair Nose"), { unit: "each", axis: "color" }, "stair nose: color");

console.log("── accessoryItemName: must be unambiguous (Driftwood is on 5 mfrs) ──");
eq(
  accessoryItemName({ manufacturer: "Mannington", style: "Adura Max", typeName: "T-Mold", variant: "DRIFTWOOD" }),
  "Mannington Adura Max T-Mold — Driftwood",
  "fully qualified",
);
eq(
  accessoryItemName({ manufacturer: "Mannington", style: "Adura Max", typeName: "Baseboard", variant: '3¼"' }),
  'Mannington Adura Max Baseboard — 3¼"',
  "size variant",
);
eq(
  accessoryItemName({ manufacturer: null, style: null, typeName: "T-Mold", variant: null }),
  "T-Mold",
  "no line, no variant",
);

console.log("── data-quality guards ──");
eq(isColorPolluted("Mr Quarter Round Cork Essence"), true, "the 97 polluted rows are caught");
eq(isColorPolluted("Gunstock Oak"), false, "a real color is not");
eq(styleIsNotALine("OVERLAP REDUCER"), true, "style that just repeats the type");
eq(styleIsNotALine("THRESHOLD"), true, "style = a type word");
eq(styleIsNotALine("Adura Max"), false, "a real line");
eq(styleIsNotALine("Canopy Comfort"), false, "a real line");
eq(styleIsNotALine(""), true, "blank style");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
