/**
 * Canonical knowledge questions.
 *
 * Flooring family → install system → these keys. The questionnaire table
 * stores labels/options; this registry is the domain overlay so adding a
 * family later is a map entry + permitted systems, not a JSX maze.
 *
 * Every question has a purpose. Quantity questions name their unit so we
 * never ask for square feet of quarter round or tack strip.
 */

import type { KnowledgeWhen, QuestionPurpose, ShowIfClause } from "@/lib/types";
import type { FlooringFamily, InstallSystem } from "./families";
import { showIfReferencedKeys } from "./show-if";

/** Conversation phase — the estimator order, not the SQL position. */
export type EstimatorPhase =
  | "area"
  | "product"
  | "measure"
  | "existing"
  | "install"
  | "prep"
  | "details"
  | "review";

export type KnowledgeQtyUnit = "sqft" | "sqyd" | "lnft" | "each" | "box" | "roll" | "sheet" | "bag";

export interface KnowledgeQuestionDef {
  key: string;
  purpose: QuestionPurpose;
  phase: EstimatorPhase;
  families?: FlooringFamily[];
  systems?: InstallSystem[];
  attachedPad?: "yes" | "no" | "any";
  /** When the answer is a quantity, the only valid unit. */
  quantityUnit?: KnowledgeQtyUnit;
  /** Overlay require — hide once the gate is answered with something else. */
  require?: { key: string; in: string[] };
  /**
   * OR of family/system/substrate clauses. Use this when SQL show_if is
   * `{ any: … }` (hardwood OR glue-down, floating/glue OR concrete) so the
   * overlay does not AND those branches together.
   */
  any?: {
    families?: FlooringFamily[];
    systems?: InstallSystem[];
    substrate?: string[];
    subfloor?: string[];
    demo?: string[];
  }[];
}

export const KNOWLEDGE_QUESTIONS: KnowledgeQuestionDef[] = [
  { key: "project_type", purpose: "SCOPE", phase: "area" },
  // Product
  /**
   * Hard-surface family picker. Exclusive carpet hides this via
   * CARPET_ONLY_HIDES_KEYS — LVP / hardwood / laminate / tile / sheet vinyl
   * are not a carpet-only job. Mixed Carpet + LVP still asks. Unanswered HS
   * stays open (0142). Do not SQL-gate surface_type on carpet_install.
   */
  { key: "surface_type", purpose: "MATERIAL", phase: "product" },
  /**
   * Gate for per-room prep. Must sit with Measure (before rooms) so "set it by
   * room" can live on the rooms step — not back at SQL position 4, in front of
   * "what are we installing?"
   */
  { key: "prep_scope", purpose: "PREP", phase: "measure" },
  // Measure / layout (after the product is in play)
  { key: "vinyl_layout", purpose: "WAREHOUSE", phase: "measure", families: ["vinyl"] },
  /**
   * Carpet product + (for broadloom) the cut list. Exclusive carpet tile keeps
   * this step so the salesperson can pick the SKU; the cut rows hide in the UI
   * and order follows measured area + waste. Catalog category stays `carpet`.
   */
  { key: "carpet_cuts", purpose: "WAREHOUSE", phase: "measure", families: ["carpet"] },
  /**
   * Roll-goods seam matching. Exclusive carpet tile hides this via
   * CARPET_TILE_HIDES_KEYS — modular tiles are not a seam plan.
   * Stretch-in / glue-down keep it. Unanswered stays open (0142).
   */
  { key: "pattern_match", purpose: "WAREHOUSE", phase: "measure", families: ["carpet"] },
  {
    key: "pattern_repeat",
    purpose: "WAREHOUSE",
    phase: "measure",
    families: ["carpet"],
    require: { key: "pattern_match", in: ["Pattern match required"] },
  },
  /**
   * Roll direction / seam notes. Exclusive carpet tile hides this — there is
   * no roll to run. Glue-down broadloom still asks.
   */
  { key: "carpet_direction", purpose: "WAREHOUSE", phase: "measure", families: ["carpet"] },
  {
    key: "hs_direction",
    purpose: "WAREHOUSE",
    phase: "measure",
    families: ["lvp", "laminate", "hardwood"],
  },

  // Existing
  /**
   * Replacement vs new construction. Positive exclusive "New construction"
   * hides tear-out questions (demo, pad, bond, asbestos, disposal). Mixed
   * Replacement + New construction still asks. Unanswered stays open.
   */
  { key: "work_type", purpose: "SCOPE", phase: "existing" },
  /**
   * Pad removal follows EXISTING carpet, not only a new-carpet job.
   * Installing carpet still asks it. LVP/hardwood/tile over carpet asks it
   * once hs_demo is Carpet. Sit after hs_demo so the follow-up is not behind
   * the salesperson (0142). Exclusive LVP / hardwood / ceramic / luan /
   * sheet vinyl tear-out hides via NON_CARPET_DEMO_PAD_HIDES_KEYS — that
   * demo is not old carpet. None / Other stay open. Unanswered stays open.
   * Do not SQL-gate existing_pad on hs_demo (0142).
   */
  {
    key: "existing_pad",
    purpose: "LABOR",
    phase: "existing",
    any: [{ families: ["carpet"] }, { demo: ["Carpet"] }],
  },
  /**
   * Old tack strip follows EXISTING carpet, not only new stretch-in.
   * New stretch-in tack_strip stays on the install step. Sit after pad so
   * the follow-up is not behind the salesperson (0142). Exclusive non-carpet
   * tear-out hides via NON_CARPET_DEMO_PAD_HIDES_KEYS with existing_pad.
   * Do not SQL-gate existing_tack on hs_demo (0142).
   */
  {
    key: "existing_tack",
    purpose: "LABOR",
    phase: "existing",
    any: [{ families: ["carpet"] }, { demo: ["Carpet"] }],
  },
  { key: "hs_demo", purpose: "LABOR", phase: "existing" },
  /**
   * Glued vs floating only after demo is a click/glue hard surface.
   * Carpet / ceramic / nailed hardwood already named the bond on the demo pick.
   */
  {
    key: "existing_bond",
    purpose: "LABOR",
    phase: "existing",
    require: { key: "hs_demo", in: ["LVP", "Laminate", "Sheet vinyl", "LVP / Vinyl"] },
  },
  { key: "demo_disposal", purpose: "LABOR", phase: "existing" },
  /**
   * Municipal pickup day after the old floor is going to the curb.
   * Keyless in 0142 (UUID only) so overlay/review could not attach.
   * New construction hides this with the other tear-out questions unless
   * Replacement is also in play. Unanswered stays open.
   * Exclusive None demo hides this with demo_disposal via
   * NONE_DEMO_DISPOSAL_HIDES_KEYS — nothing is coming up, so nothing goes
   * to the curb. Unanswered disposal stays open in overlay require; live
   * SQL show_if still waits for Placed at curb (0142). Do not invent a
   * dumpster fee. Do not SQL-gate bulk_pickup on hs_demo.
   */
  {
    key: "bulk_pickup",
    purpose: "SCHEDULING",
    phase: "existing",
    require: { key: "demo_disposal", in: ["Placed at curb"] },
  },
  {
    key: "asbestos_risk",
    purpose: "WARNING",
    phase: "existing",
    require: {
      key: "hs_demo",
      in: ["Ceramic WITH mortar bed", "Ceramic WITHOUT mortar bed", "Sheet vinyl"],
    },
  },

  // Install
  /**
   * Hard-surface method picker. Exclusive carpet hides this via
   * CARPET_ONLY_HIDES_KEYS — stretch-in / glue / tile stay on carpet_install.
   * Exclusive tile hides this via EXCLUSIVE_TILE_METHOD_HIDES_KEYS — thinset
   * stays on tile_setting, not Floating / Glue-down / Nail-down. Mixed LVP +
   * tile still asks. Unanswered HS stays open (0142). Do not SQL-gate
   * install_method on carpet_install or surface_type.
   */
  { key: "install_method", purpose: "INSTALLATION", phase: "install" },
  { key: "carpet_install", purpose: "INSTALLATION", phase: "install", families: ["carpet"] },
  /**
   * Floating only. Solid hardwood hides this via SOLID_HARDWOOD_HIDES_KEYS
   * even before a method is picked — floating is not a permitted system.
   * Engineered / LVP / laminate keep it. Unanswered HS stays open (0142).
   */
  { key: "attached_pad", purpose: "MATERIAL", phase: "install", families: ["lvp", "laminate", "hardwood"], systems: ["floating"] },
  /** Residential pad is stretch-in. Glue-down / carpet tile hide this. */
  { key: "carpet_pad", purpose: "MATERIAL", phase: "install", families: ["carpet"], systems: ["stretch_in"],
    require: { key: "carpet_install", in: ["Stretch-in"] } },
  /** Glue-down of any family, or carpet tile (pressure-sensitive / glue). */
  { key: "adhesive", purpose: "MATERIAL", phase: "install", systems: ["glue", "carpet_tile"] },
  { key: "hs_underlayment", purpose: "MATERIAL", phase: "install", systems: ["floating"] },
  /**
   * Nail / staple fasteners. Overlay families hardwood so exclusive LVP /
   * laminate / vinyl / tile hide once the surface is known. Live 0191
   * knowledge_when is systems-only — leftover Nail-down still matches SQL
   * show_if and would reopen this without NON_HARDWOOD_FASTENER_HIDES_KEYS.
   * Unanswered HS stays open (surfacePending). Mixed LVP + hardwood still
   * asks. Do not SQL-gate hardwood_fasteners on surface_type (0142).
   */
  {
    key: "hardwood_fasteners",
    purpose: "MATERIAL",
    phase: "install",
    families: ["hardwood"],
    systems: ["nail", "staple"],
  },
  /**
   * Prefinished vs unfinished (site finish). Catalog has no sand/finish labor —
   * capture as scope. Overlay families hardwood so laminate/LVP hide once the
   * surface is known; unanswered HS stays open (surfacePending).
   */
  { key: "hardwood_finish", purpose: "SCOPE", phase: "product", families: ["hardwood"] },
  /**
   * Hardwood (solid or engineered) OR glue-down of any family — including
   * glue-down carpet — OR carpet tile (pressure-sensitive / glue). Laminate
   * floating / stretch-in carpet / thinset tile hide this.
   */
  {
    key: "acclimation",
    purpose: "INSTALLATION",
    phase: "install",
    any: [{ families: ["hardwood"] }, { systems: ["glue", "carpet_tile"] }],
  },
  { key: "construction_grade", purpose: "INSTALLATION", phase: "install",
    any: [
      { families: ["hardwood", "lvp", "laminate", "vinyl", "tile"] },
      { systems: ["glue", "carpet_tile"] },
    ],
  },
  { key: "radiant_heat", purpose: "WARNING", phase: "install" },
  { key: "laminate_expansion", purpose: "SCOPE", phase: "install", systems: ["floating"] },
  /**
   * Floor vs wall. Exclusive Wall hides floor-only follow-ups in
   * questionApplies (TILE_WALL_HIDES_KEYS) — not via SQL show_if, so
   * unanswered and mixed carpet/LVP + wall tile stay open (0142).
   */
  { key: "tile_application", purpose: "INSTALLATION", phase: "install", families: ["tile"] },
  { key: "tile_body", purpose: "INSTALLATION", phase: "install", families: ["tile"] },
  { key: "tile_format", purpose: "INSTALLATION", phase: "install", families: ["tile"] },
  { key: "tile_layout", purpose: "INSTALLATION", phase: "install", families: ["tile"] },
  { key: "tile_setting", purpose: "MATERIAL", phase: "install", families: ["tile"] },
  { key: "tack_strip", purpose: "ACCESSORY", phase: "install", families: ["carpet"], systems: ["stretch_in"],
    require: { key: "carpet_install", in: ["Stretch-in"] } },
  {
    key: "tack_strip_qty",
    purpose: "ACCESSORY",
    phase: "install",
    families: ["carpet"],
    systems: ["stretch_in"],
    quantityUnit: "lnft",
    require: { key: "tack_strip", in: ["Replace / new tack strip"] },
  },
  { key: "climate_control", purpose: "INSTALLATION", phase: "install" },
  /**
   * Leftover yes/no from before 0142 merged AC + heat into climate_control.
   * Kept so climateControlConfirmed still reads old Yes answers. Overlay
   * always hides them (MERGED_CLIMATE_HIDES_KEYS) — climate_control is SOT.
   * Do not SQL-gate climate_control on install_method or tile_application.
   */
  { key: "ac_available", purpose: "INSTALLATION", phase: "install" },
  { key: "heat_available", purpose: "INSTALLATION", phase: "install" },

  // Prep
  { key: "substrate", purpose: "PREP", phase: "prep" },
  /**
   * Floor flatness / cracks / moisture. Exclusive wall tile hides this via
   * TILE_WALL_HIDES_KEYS — a backsplash is not a floor pour. Mixed LVP + wall
   * still asks. Unanswered stays open (0142).
   */
  { key: "subfloor_condition", purpose: "PREP", phase: "prep" },
  /**
   * Matches 0190/0198 show_if: floating/glue OR concrete substrate.
   * Nail-down hardwood over a slab still needs this question; stretch-in
   * carpet over plywood does not. Exclusive tile hides this via
   * TILE_THINSET_HIDES_KEYS — thinset is not a 6-mil click-floor vapor
   * barrier; membranes stay on tile_setting. Exclusive carpet tile hides
   * this via CARPET_TILE_VAPOR_HIDES_KEYS — modular tile uses adhesive,
   * not a floating-floor sheet; Aqua bar stays on moisture_mitigation.
   * Exclusive glue-down over plywood hides via GLUE_WOOD_VAPOR_HIDES_KEYS —
   * you cannot glue to 6-mil poly. Exclusive plywood (floating, glue, or
   * mixed) hides via WOOD_DECK_VAPOR_HIDES_KEYS — 6-mil is a slab sheet, not
   * a wood-deck underlayment. Exclusive glue-down over existing flooring
   * hides via GLUE_EXISTING_VAPOR_HIDES_KEYS — you glue to the existing floor
   * or tear it out. Exclusive existing flooring (floating, glue, or mixed)
   * also hides via EXISTING_FLOOR_VAPOR_HIDES_KEYS — 6-mil is a slab sheet,
   * not an existing-floor underlayment. Exclusive loose-lay hides via
   * LOOSE_LAY_VAPOR_HIDES_KEYS — loose-lay is not a click-floor 6-mil sheet.
   * Mixed floating + loose-lay still asks. Mixed Carpet + LVP loose-lay
   * still asks. Exclusive glue / carpet tile over plywood also hides Aqua
   * bar via WOOD_DECK_AQUA_HIDES_KEYS; exclusive glue / carpet tile over
   * existing flooring hides Aqua bar via EXISTING_FLOOR_AQUA_HIDES_KEYS —
   * Aqua bar is a slab system. Glue over concrete still asks both. Mixed
   * plywood + concrete still asks vapor. Mixed existing + concrete still
   * asks vapor. Unanswered substrate stays open. Do not SQL-gate
   * vapor_barrier on surface_type, carpet_install, substrate, or
   * install_method (0142).
   */
  {
    key: "vapor_barrier",
    purpose: "PREP",
    phase: "prep",
    any: [{ systems: ["floating", "glue"] }, { substrate: ["Concrete"] }],
  },
  /**
   * Hardwood OR glue-down OR carpet tile OR the salesperson flagged moisture
   * concerns on the substrate — laminate floating still hides this unless
   * condition says so. Stretch-in hides it. Exclusive hardwood nail/staple/
   * floating over plywood hides via WOOD_DECK_MOISTURE_HIDES_KEYS — 0190 is
   * glue-down or wood over concrete, not a wood deck.
   */
  {
    key: "moisture_test",
    purpose: "PREP",
    phase: "prep",
    any: [
      { families: ["hardwood"] },
      { systems: ["glue", "carpet_tile"] },
      { subfloor: ["Moisture concerns"] },
    ],
  },
  /**
   * Same gate as moisture_test: hardwood OR glue OR carpet tile OR a
   * moisture-concern flag. Floating laminate without that flag hides Aqua bar.
   * Exclusive glue-down / carpet tile over plywood hides via
   * WOOD_DECK_AQUA_HIDES_KEYS — Aqua bar is a slab coating, not a wood-deck
   * primer. Moisture test still asks (wood MC). Glue over concrete still
   * asks. A moisture-concern flag still asks. Unanswered substrate stays
   * open (0142).
   */
  {
    key: "moisture_mitigation",
    purpose: "PREP",
    phase: "prep",
    any: [
      { families: ["hardwood"] },
      { systems: ["glue", "carpet_tile"] },
      { subfloor: ["Moisture concerns"] },
    ],
  },
  { key: "prep_confidence", purpose: "PREP", phase: "prep" },
  { key: "hs_prep", purpose: "PREP", phase: "prep" },
  /**
   * Bag-count yes/no. SQL show_if is hs_prep Self-leveling (0120/0206).
   * Overlay require matches so a leftover Hard-surface-only show_if cannot
   * hide bags on a carpet job that actually self-levels — and None still hides.
   */
  {
    key: "selflevel_needed",
    purpose: "PREP",
    phase: "prep",
    require: { key: "hs_prep", in: ["Self-leveling"] },
  },
  /**
   * 4×8 plywood overlay. Exclusive Concrete hides this via CONCRETE_HIDES_KEYS
   * — a slab is patch / self-level, not sheets. Plywood / wood / existing /
   * Unknown stay open. Unanswered stays open (0142).
   */
  { key: "subfloor_needed", purpose: "PREP", phase: "prep" },
  /**
   * Embossed existing vinyl often needs a skim coat before new sheet vinyl.
   * Exclusive non-vinyl tear-out (carpet / LVP / hardwood / ceramic / luan)
   * hides this via NON_VINYL_DEMO_SKIM_HIDES_KEYS — that demo is not existing
   * vinyl. None / Other stay open (encapsulation or unknown existing). Sheet
   * vinyl demo still asks. Unanswered stays open (0142). New construction
   * already hides via REMOVAL_QUESTION_KEYS. Do not SQL-gate vinyl_skim on
   * hs_demo (0142).
   */
  { key: "vinyl_skim", purpose: "PREP", phase: "prep", families: ["vinyl"] },

  // Details
  /**
   * Generic stair gate — leftover yes/no. Live questions are carpet_stairs /
   * carpet_tile_stairs / hs_plank_stairs. Overlay hides this via
   * DEAD_STAIR_GATE_HIDES_KEYS once a family-specific stair question is in
   * play. Exclusive wall tile hides this via TILE_WALL_HIDES_KEYS.
   * Mixed carpet or LVP + wall still asks the family-specific questions.
   * Unanswered project_type stays open (0142). Landings / open sides hide
   * via DEAD_STAIR_FOLLOWUP_HIDES_KEYS until a family stair question is Yes.
   */
  { key: "stairs", purpose: "MEASUREMENT", phase: "details" },
  {
    key: "carpet_stairs",
    purpose: "MEASUREMENT",
    phase: "details",
    families: ["carpet"],
    require: { key: "carpet_install", in: ["Stretch-in", "Glue-down", "Unknown / field verify"] },
  },
  {
    key: "carpet_tile_stairs",
    purpose: "MEASUREMENT",
    phase: "details",
    families: ["carpet"],
    systems: ["carpet_tile"],
    require: { key: "carpet_install", in: ["Carpet tile"] },
  },
  {
    key: "carpet_tile_stair_count",
    purpose: "MEASUREMENT",
    phase: "details",
    families: ["carpet"],
    systems: ["carpet_tile"],
    quantityUnit: "each",
    require: { key: "carpet_tile_stairs", in: ["Yes"] },
  },
  { key: "hs_plank_stairs", purpose: "MEASUREMENT", phase: "details", families: ["lvp", "hardwood", "laminate", "vinyl", "tile"] },
  /**
   * Gripper / flat binder bars for roll-goods carpet at doorways. Exclusive
   * carpet tile hides this via CARPET_TILE_HIDES_KEYS — modular tile is not
   * a binder-bar plan. Stretch-in / glue-down keep it. Unanswered stays
   * open (0142). Mixed LVP + exclusive tile uses hs_transitions.
   */
  { key: "metals_needed", purpose: "ACCESSORY", phase: "details", families: ["carpet"] },
  {
    key: "metals_qty",
    purpose: "ACCESSORY",
    phase: "details",
    families: ["carpet"],
    quantityUnit: "each",
    require: { key: "metals_needed", in: ["Yes"] },
  },
  {
    key: "metal_type",
    purpose: "ACCESSORY",
    phase: "details",
    families: ["carpet"],
    require: { key: "metals_needed", in: ["Yes"] },
  },
  {
    key: "metal_color",
    purpose: "ACCESSORY",
    phase: "details",
    families: ["carpet"],
    require: { key: "metals_needed", in: ["Yes"] },
  },
  {
    key: "hs_transitions",
    purpose: "ACCESSORY",
    phase: "details",
    families: ["lvp", "hardwood", "laminate", "vinyl", "tile"],
    quantityUnit: "each",
  },
  {
    key: "hs_base_trim",
    purpose: "ACCESSORY",
    phase: "details",
    families: ["lvp", "hardwood", "laminate", "vinyl", "tile"],
    quantityUnit: "lnft",
  },
  { key: "vents_registers", purpose: "ACCESSORY", phase: "details", quantityUnit: "each" },
  /**
   * Live landing count. Overlay require reads leftover stairs=Yes. Once the
   * dead gate is hidden, unanswered require would keep this open forever.
   * Hide via DEAD_STAIR_FOLLOWUP_HIDES_KEYS until a family stair question
   * is Yes. Exclusive wall already hides this. Unanswered project_type
   * stays open (0142). Do not SQL-gate stair_landings on carpet_stairs.
   */
  {
    key: "stair_landings",
    purpose: "MEASUREMENT",
    phase: "details",
    quantityUnit: "each",
    require: { key: "stairs", in: ["Yes"] },
  },
  /**
   * Same leftover-parent hole as stair_landings. Hide until a family stair
   * question is Yes.
   */
  {
    key: "stair_open_sides",
    purpose: "MEASUREMENT",
    phase: "details",
    require: { key: "stairs", in: ["Yes"] },
  },
  { key: "occupancy", purpose: "SCHEDULING", phase: "details" },
  /**
   * Bath / laundry / mudroom. Catalog has no waterproof column — capture as
   * scope and warn. Do not invent a waterproof SKU or a ban.
   * Exclusive carpet hides this via CARPET_ONLY_BATH_HIDES_KEYS — a
   * carpet-only job is not a wet-area floor. Mixed carpet + hard surface
   * still asks. Unanswered project type stays open (0142). Do not SQL-gate
   * wet_area on project_type.
   */
  { key: "wet_area", purpose: "WARNING", phase: "details" },
  { key: "access_conditions", purpose: "SCHEDULING", phase: "details" },
  { key: "crew_entry", purpose: "SCHEDULING", phase: "details" },
  { key: "furniture_level", purpose: "LABOR", phase: "details" },
  { key: "furniture_heavy", purpose: "SCOPE", phase: "details" },
  /**
   * Pull-and-reset. Hard-surface baths still ask. Exclusive carpet hides
   * this via CARPET_ONLY_BATH_HIDES_KEYS — there is no normal carpet
   * scenario that pulls a toilet. Mixed carpet + hard surface still asks.
   * Exclusive new construction hides via NEW_CONSTRUCTION_HIDES_KEYS.
   * Unanswered project type stays open (0142). Do not SQL-gate toilets on
   * project_type or carpet_install.
   */
  { key: "toilets", purpose: "LABOR", phase: "details", quantityUnit: "each" },
  { key: "appliances", purpose: "LABOR", phase: "details", quantityUnit: "each" },
  { key: "doors_shave", purpose: "LABOR", phase: "details", quantityUnit: "each" },
  { key: "delivery_scope", purpose: "PURCHASING", phase: "details" },
  /**
   * Leftover yes/no from before 0142 merged Placed on the curb into
   * demo_disposal ("Placed at curb"). Overlay always hides it
   * (MERGED_CURB_HIDES_KEYS). Review SPECIAL_KEYS still bucket leftover
   * answers. bulk_pickup still waits for Placed at curb. Do not SQL-gate
   * bulk_pickup on demo_disposal (0142).
   */
  { key: "carpet_curb", purpose: "LABOR", phase: "details", families: ["carpet"] },
];

export const DEFAULT_KNOWLEDGE_WHEN: Record<string, KnowledgeWhen> = Object.fromEntries(
  KNOWLEDGE_QUESTIONS.map((q) => [
    q.key,
    {
      ...(q.families ? { families: q.families } : {}),
      ...(q.systems ? { systems: q.systems } : {}),
      ...(q.any ? { any: q.any } : {}),
      ...(q.attachedPad ? { attachedPad: q.attachedPad } : {}),
      ...(q.require ? { require: q.require } : {}),
      purpose: q.purpose,
    } satisfies KnowledgeWhen,
  ]),
);

export function knowledgeQuestionByKey(key: string): KnowledgeQuestionDef | undefined {
  return KNOWLEDGE_QUESTIONS.find((q) => q.key === key);
}

/**
 * Unit shown next to a number answer. Registry quantityUnit wins so we never
 * label toilets or vents as square feet just because the emit is missing.
 */
export function amountUnitLabelForQuestion(q: {
  key?: string | null;
  config?: { emit?: { unit?: string } | null };
}): string {
  if (q.key === "pattern_repeat") return "inches of repeat — not an order qty";
  const keyed = q.key ? knowledgeQuestionByKey(q.key)?.quantityUnit : undefined;
  const raw = keyed || q.config?.emit?.unit || "";
  if (!raw) return "";
  if (raw === "lnft") return "ln ft";
  if (raw === "sqft") return "sq ft";
  if (raw === "sqyd") return "sq yd";
  if (raw === "each") return "each";
  if (raw === "box") return "carton";
  return raw;
}

/** Conversation order the salesperson walks — not SQL `position`. */
export const ESTIMATOR_PHASE_ORDER: EstimatorPhase[] = [
  "area",
  "product",
  "measure",
  "existing",
  "install",
  "prep",
  "details",
  "review",
];

export const ESTIMATOR_PHASE_LABELS: Record<EstimatorPhase, string> = {
  area: "Area",
  product: "Product",
  measure: "Measure",
  existing: "Existing",
  install: "Installation",
  prep: "Prep",
  details: "Details",
  review: "Review",
};

export function estimatorPhaseRank(phase: EstimatorPhase): number {
  const i = ESTIMATOR_PHASE_ORDER.indexOf(phase);
  return i < 0 ? ESTIMATOR_PHASE_ORDER.length : i;
}

export function estimatorPhaseLabel(phase: EstimatorPhase): string {
  return ESTIMATOR_PHASE_LABELS[phase];
}

/** Tear-out questions hidden once work_type is New construction. */
export const REMOVAL_QUESTION_KEYS = [
  "hs_demo",
  "existing_bond",
  "existing_pad",
  "existing_tack",
  "demo_disposal",
  "bulk_pickup",
  "asbestos_risk",
  "vinyl_skim",
] as const;

/**
 * Pull-and-reset is replacement work. Exclusive New construction hides these.
 * Mixed Replacement + New construction still asks. Unanswered and Unknown
 * stay open. Do not SQL-gate toilets on work_type (0142).
 * Appliances and door shaves stay — those can still apply on a new slab.
 */
export const NEW_CONSTRUCTION_HIDES_KEYS = ["toilets"] as const;

/**
 * Leftover AC / heat yes-no merged into climate_control (0142). Always hide —
 * no family/system gate. climateControlConfirmed still reads Yes answers so
 * old estimates do not lose the acclimation warning. Do not SQL-gate
 * climate_control on install_method or tile_application (0142).
 */
export const MERGED_CLIMATE_HIDES_KEYS = ["ac_available", "heat_available"] as const;

/**
 * Leftover Placed-on-the-curb yes-no merged into demo_disposal (0142).
 * Always hide — curb is a disposal chip, not a second yes/no. Review still
 * buckets leftover answers as specials. Do not SQL-gate bulk_pickup on
 * demo_disposal (0142).
 */
export const MERGED_CURB_HIDES_KEYS = ["carpet_curb"] as const;

/**
 * Hard-surface Install method and Surface type hidden once the job is
 * exclusive carpet. Stretch-in / glue-down / carpet tile stay on
 * carpet_install. Mixed Carpet + LVP still asks. Unanswered HS stays open
 * (0142). Do not SQL-gate install_method or surface_type on carpet_install.
 */
export const CARPET_ONLY_HIDES_KEYS = ["install_method", "surface_type"] as const;

/**
 * Wet-area construction and toilet pull/reset. Those are hard-surface bath
 * questions. Exclusive carpet (stretch-in, glue-down, or carpet tile) hides
 * them. Floor registers stay — carpet is cut around them. Mixed carpet +
 * LVP / tile / vinyl / hardwood / laminate still asks. Unanswered project
 * type stays open (0142). Do not SQL-gate wet_area or toilets on
 * carpet_install. Do not invent a carpet wet-area scenario to keep them.
 */
export const CARPET_ONLY_BATH_HIDES_KEYS = ["wet_area", "toilets"] as const;

/**
 * Leftover generic stairs yes/no. Live stair questions are carpet_stairs /
 * carpet_tile_stairs / hs_plank_stairs. Landings still read stairs=Yes via
 * synthesizeStairGate. Hide this dead gate once a family-specific stair
 * question is in play. Unanswered project_type stays open (0142). Exclusive
 * wall already hides stairs via TILE_WALL_HIDES_KEYS. Do not SQL-gate
 * stair_landings on carpet_stairs.
 */
export const DEAD_STAIR_GATE_HIDES_KEYS = ["stairs"] as const;

/**
 * Leftover landings / open sides. The dead stairs yes/no is overlay-hidden
 * once family stairs are live, so unanswered require would keep these
 * children open forever. Hide them until Carpet stairs, Carpet tile stairs,
 * or hard-surface plank stairs is Yes. Unanswered project_type stays open
 * (0142). Exclusive wall already hides them via TILE_WALL_HIDES_KEYS. Do
 * not SQL-gate stair_landings on carpet_stairs.
 */
export const DEAD_STAIR_FOLLOWUP_HIDES_KEYS = ["stair_landings", "stair_open_sides"] as const;

/**
 * Floor-only follow-ups hidden once tile_application is exclusively Wall
 * and the job has no other floor-covering family (carpet / LVP / hardwood /
 * laminate / sheet vinyl). Unanswered and Unknown stay visible. Wet area,
 * appliances, floor prep, and tile setting stay — showers and backsplashes
 * still need them. Do not SQL-gate toilets on tile_application (0142).
 */
export const TILE_WALL_HIDES_KEYS = [
  "toilets",
  "vents_registers",
  "doors_shave",
  "hs_plank_stairs",
  "construction_grade",
  "radiant_heat",
  "hs_transitions",
  "subfloor_needed",
  "selflevel_needed",
  "vapor_barrier",
  "moisture_mitigation",
  "moisture_test",
  "subfloor_condition",
  "stairs",
  "stair_landings",
  "stair_open_sides",
  "existing_pad",
  "existing_tack",
  "existing_bond",
  "climate_control",
  "acclimation",
] as const;

/**
 * Furniture moving is for occupied floor jobs. Vacant hides these. Exclusive
 * wall tile hides them too (a backsplash is not a furniture-moving job).
 * Exclusive new construction hides them — a new slab has no furniture to
 * move. Mixed Replacement + New construction stays open. Unanswered and
 * Unknown stay open (0142). Do not SQL-gate furniture on occupancy,
 * tile_application, or work_type.
 */
export const FURNITURE_MOVING_KEYS = ["furniture_level", "furniture_heavy"] as const;

/**
 * Roll-goods layout and binder-bar follow-ups hidden once carpet_install is
 * exclusively Carpet tile. Unanswered stays visible. Stretch-in / glue-down
 * mixed with tile still ask them — those rooms still need a cut plan and
 * doorway metals. Mixed LVP + exclusive tile hides metals (LVP uses
 * hs_transitions). Do not SQL-gate pattern_match or metals_needed on
 * carpet_install (0142).
 */
export const CARPET_TILE_HIDES_KEYS = [
  "pattern_match",
  "pattern_repeat",
  "carpet_direction",
  "metals_needed",
  "metals_qty",
  "metal_type",
  "metal_color",
] as const;

/**
 * Floating-floor follow-ups hidden once the surface is exclusive solid
 * hardwood. Unanswered HS and engineered stay open. Mixed Hardwood +
 * Engineered hardwood stays open so floating engineered rooms still ask.
 * Do not SQL-gate attached_pad on surface_type (0142).
 */
export const SOLID_HARDWOOD_HIDES_KEYS = [
  "attached_pad",
  "hs_underlayment",
  "laminate_expansion",
] as const;

/**
 * 6-mil click-floor vapor barrier hidden once the job is exclusive tile
 * (floor or wall). Thinset / mortar uses backer and uncoupling membranes
 * on tile_setting — not a floating-floor vapor sheet. Unanswered HS and
 * mixed LVP or hardwood + tile stay open. Do not SQL-gate vapor_barrier
 * on surface_type (0142).
 */
export const TILE_THINSET_HIDES_KEYS = ["vapor_barrier"] as const;

/**
 * 6-mil click-floor vapor barrier hidden once carpet_install is exclusively
 * Carpet tile and no click/glue hard-surface family is also on the job.
 * Modular tile uses adhesive (Aqua bar on moisture_mitigation) — not a
 * floating-floor sheet. Mixed LVP / laminate / hardwood / sheet vinyl still
 * asks. Unanswered carpet install and mixed stretch-in / glue-down stay
 * open (0142). Do not SQL-gate vapor_barrier on carpet_install.
 */
export const CARPET_TILE_VAPOR_HIDES_KEYS = ["vapor_barrier"] as const;

/**
 * 4×8 plywood overlay hidden once the substrate is exclusively Concrete.
 * A slab gets patch / self-level, not sheets. Plywood / wood / existing
 * flooring / Unknown stay open. Unanswered stays open (0142). Do not
 * SQL-gate subfloor_needed on substrate.
 */
export const CONCRETE_HIDES_KEYS = ["subfloor_needed"] as const;

/**
 * Slab moisture test / Aqua bar hidden once the substrate is exclusively
 * plywood / OSB / wood AND the job is exclusive hardwood that is not
 * glue-down. 0190: moisture test is glue-down or wood over concrete — not
 * nail-down over a wood deck and not floating click. Mixed LVP / glue /
 * unanswered substrate / moisture-concern flags stay open. Do not SQL-gate
 * moisture_test on substrate (0142).
 */
export const WOOD_DECK_MOISTURE_HIDES_KEYS = ["moisture_test", "moisture_mitigation"] as const;

/**
 * 6-mil click-floor vapor sheet hidden once the job is exclusive glue-down
 * (no floating) over plywood / OSB / wood. You cannot glue to 6-mil poly.
 * Aqua bar hides separately via WOOD_DECK_AQUA_HIDES_KEYS. Glue over
 * concrete still asks. Mixed floating + glue over exclusive plywood hides
 * via WOOD_DECK_VAPOR_HIDES_KEYS. Unanswered
 * substrate stays open (0142). Do not SQL-gate vapor_barrier on substrate.
 */
export const GLUE_WOOD_VAPOR_HIDES_KEYS = ["vapor_barrier"] as const;

/**
 * Aqua bar / primer hidden once the substrate is exclusively plywood / OSB /
 * wood AND the job is glue-down or carpet tile. Aqua bar is a slab coating —
 * not a wood-deck primer. Moisture test still asks (wood moisture content).
 * Glue over concrete still asks. Mixed plywood + concrete stays open. A
 * moisture-concern flag still asks. Unanswered substrate and unanswered
 * method stay open (0142). Do not SQL-gate moisture_mitigation on substrate.
 */
export const WOOD_DECK_AQUA_HIDES_KEYS = ["moisture_mitigation"] as const;

/**
 * 6-mil click-floor vapor sheet hidden once every substrate pick is plywood
 * / OSB / wood. 6-mil is a slab sheet — not a wood-deck underlayment.
 * Exclusive floating, glue, and mixed floating + glue over plywood all
 * hide. Glue / floating over concrete still ask. Mixed plywood + concrete
 * stays open. Unanswered substrate and unanswered method stay open (0142).
 * Do not SQL-gate vapor_barrier on substrate.
 */
export const WOOD_DECK_VAPOR_HIDES_KEYS = ["vapor_barrier"] as const;

/**
 * 6-mil click-floor vapor hidden once the job is exclusive glue-down over
 * Existing flooring. You glue to the existing floor or tear it out — not
 * to 6-mil poly. Mixed floating + glue over exclusive existing flooring
 * hides via EXISTING_FLOOR_VAPOR_HIDES_KEYS. Glue over concrete still asks.
 * Unanswered substrate stays open (0142). Do not SQL-gate vapor_barrier on
 * substrate.
 */
export const GLUE_EXISTING_VAPOR_HIDES_KEYS = ["vapor_barrier"] as const;

/**
 * Aqua bar / primer hidden once every substrate pick is Existing flooring.
 * Aqua bar is a slab coating, not an existing-floor primer — exclusive
 * glue / carpet tile (0290) and exclusive hardwood nail / staple / floating
 * all hide. Moisture test still asks (unknown what's under). Mixed existing
 * + concrete stays open. A moisture-concern flag still asks. Unanswered
 * substrate stays open (0142). Do not SQL-gate moisture_mitigation on
 * substrate.
 */
export const EXISTING_FLOOR_AQUA_HIDES_KEYS = ["moisture_mitigation"] as const;

/**
 * 6-mil click-floor vapor sheet hidden once every substrate pick is
 * Existing flooring. 6-mil is a slab sheet — not an existing-floor
 * underlayment. Exclusive floating, glue, and mixed floating + glue over
 * existing flooring all hide. Glue / floating over concrete still ask.
 * Mixed existing + concrete stays open. Unanswered substrate and
 * unanswered method stay open (0142). Do not SQL-gate vapor_barrier on
 * substrate.
 */
export const EXISTING_FLOOR_VAPOR_HIDES_KEYS = ["vapor_barrier"] as const;

/**
 * 6-mil click-floor vapor hidden once the only install system is loose-lay.
 * Loose-lay is not a click-floor sheet and not glue-down — do not ask for
 * 6-mil poly, including over concrete. Mixed floating + loose-lay stays
 * open. Mixed glue + loose-lay stays open. Mixed Carpet + LVP loose-lay
 * stays open so stretch / glue over concrete still asks. Leftover Loose-lay
 * on exclusive carpet does not hide (carpet scope). Leftover Loose-lay on
 * laminate / vinyl / tile coalesces to the legal system and still asks over
 * concrete. Leftover Loose-lay on hardwood does not hide (0142 leftover
 * chips do not gate). Unanswered LVP stays open. Do not SQL-gate
 * vapor_barrier on install_method.
 */
export const LOOSE_LAY_VAPOR_HIDES_KEYS = ["vapor_barrier"] as const;

/**
 * Existing-vinyl skim hidden once every demo pick names a non-vinyl floor
 * (carpet / LVP / laminate / hardwood / ceramic / luan). That tear-out is
 * not embossed vinyl. None stays open — encapsulating existing vinyl has no
 * tear-out chip. Other / Unknown / field verify stay open. Sheet vinyl demo
 * still asks. Mixed Carpet + Sheet vinyl stays open. Unanswered stays open
 * (0142). New construction already hides. Do not SQL-gate vinyl_skim on
 * hs_demo.
 */
export const NON_VINYL_DEMO_SKIM_HIDES_KEYS = ["vinyl_skim"] as const;

/**
 * Nail / staple fasteners hidden once the surface is exclusive LVP /
 * laminate / vinyl / tile. Leftover Nail-down on LVP still matches SQL
 * show_if and live 0191 knowledge_when (systems only) — this overlay hide
 * is the positive evidence those leftover chips must not reopen fasteners.
 * Mixed LVP + hardwood still asks. Unanswered HS stays open (0142).
 * Do not SQL-gate hardwood_fasteners on surface_type.
 */
export const NON_HARDWOOD_FASTENER_HIDES_KEYS = ["hardwood_fasteners"] as const;

/**
 * Existing pad / tack hidden once every demo pick names a non-carpet floor
 * (LVP / laminate / hardwood / ceramic / luan / sheet vinyl). That tear-out
 * is not old carpet. Carpet demo still asks. Mixed Carpet + LVP stays open.
 * None / Other / Unknown stay open. Unanswered stays open (0142). New
 * construction and exclusive wall already hide. Do not SQL-gate existing_pad
 * or existing_tack on hs_demo.
 */
export const NON_CARPET_DEMO_PAD_HIDES_KEYS = ["existing_pad", "existing_tack"] as const;

/**
 * Haul-away / dumpster / curb and bulk pickup hidden once every demo pick
 * is None. Nothing is coming up, so there is nothing to dispose. Carpet /
 * LVP / ceramic demo still asks. Mixed None + Carpet stays open. Other /
 * Unknown stay open. Unanswered stays open (0142). New construction
 * already hides. Do not SQL-gate demo_disposal or bulk_pickup on hs_demo.
 */
export const NONE_DEMO_DISPOSAL_HIDES_KEYS = ["demo_disposal", "bulk_pickup"] as const;

/**
 * Hard-surface Install method hidden once the job is exclusive tile.
 * Thinset lives on tile_setting — not a floating / glue / nail picker.
 * Mixed LVP + tile still asks. Unanswered HS stays open (0142). Exclusive
 * wall and exclusive floor both hide. Do not SQL-gate install_method on
 * surface_type or tile_application.
 */
export const EXCLUSIVE_TILE_METHOD_HIDES_KEYS = ["install_method"] as const;

/**
 * Floating-floor vapor sheet bundled with underlayment. Glue-down, carpet tile,
 * nail/staple, and stretch-in hide this chip — you cannot glue to 6-mil poly.
 * Unanswered LVP / engineered still offer it (0142). Do not SQL-remove the
 * option (mixed floating + glue still needs it).
 */
export function vaporBarrierHidesUnderlaymentOptionLabel(label: string): boolean {
  const t = label.trim();
  if (!t) return false;
  return /included with underlayment/i.test(t);
}

/**
 * Floor-prep chips that pour or grind a floor. Exclusive wall keeps Patch / skim
 * and None — showers still skim. Do not SQL-remove these options (mixed and
 * unanswered floor-vs-wall still need them).
 */
export function tileWallHidesPrepOptionLabel(label: string): boolean {
  const t = label.trim();
  if (!t) return false;
  return /self-?level/i.test(t) || /grind/i.test(t);
}

/**
 * Floor-covering tear-out chips. Exclusive wall keeps ceramic mortar / none /
 * other — showers and backsplashes still demo existing tile. Do not SQL-remove
 * carpet/LVP/hardwood options (mixed and unanswered floor-vs-wall still need them).
 */
export function tileWallHidesDemoOptionLabel(label: string): boolean {
  const t = label.trim();
  if (!t) return false;
  if (/^none$/i.test(t) || /^other$/i.test(t) || /unknown|field verify|tbd/i.test(t)) return false;
  if (/ceramic/i.test(t)) return false;
  return /carpet|sheet vinyl|luan|\blvp\b|laminate|hardwood/i.test(t);
}

export interface SortableEstimateQuestion {
  id: string;
  key?: string | null;
  kind?: string;
  section?: string | null;
  position: number;
  config?: { show_if?: ShowIfClause | null; trim_list?: boolean };
}

function sectionPhase(section: string | null | undefined): EstimatorPhase | null {
  const s = (section ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "start") return "area";
  if (s === "measure") return "measure";
  if (s.includes("demo") || s.includes("disposal") || s.includes("existing")) return "existing";
  if (s.includes("prep")) return "prep";
  if (s.includes("stair")) return "details";
  if (s.includes("site") || s.includes("schedule") || s.includes("trim")) return "details";
  return null;
}

function kindPhase(kind: string | undefined, trimList?: boolean): EstimatorPhase | null {
  if (kind === "areas") return "measure";
  if (kind === "floor_map") return "product";
  if (kind === "product") return trimList ? "details" : "product";
  if (kind === "cuts") return "measure";
  if (kind === "stairs" || kind === "hs_stairs") return "details";
  if (kind === "subfloor" || kind === "selflevel") return "prep";
  return null;
}

/**
 * Native phase for one question. Registry key wins; kind/section are fallbacks
 * so unkeyed catalog questions still walk Area → Product → Measure → …
 */
export function estimatorPhaseForQuestion(q: SortableEstimateQuestion): EstimatorPhase {
  if (q.key) {
    const def = knowledgeQuestionByKey(q.key);
    if (def) return def.phase;
  }
  const fromKind = kindPhase(q.kind, q.config?.trim_list);
  if (fromKind) return fromKind;
  const fromSection = sectionPhase(q.section);
  if (fromSection) return fromSection;
  return "details";
}

/**
 * Phase after 0142-style bumps: a dependent is never earlier than its `show_if`
 * gate, and floor_map waits until rooms (measure) exist.
 */
export function questionPhaseMap(questions: SortableEstimateQuestion[]): Map<string, EstimatorPhase> {
  const phase = new Map<string, EstimatorPhase>();
  const byKey = new Map<string, SortableEstimateQuestion>();
  for (const q of questions) {
    phase.set(q.id, estimatorPhaseForQuestion(q));
    if (q.key) byKey.set(q.key, q);
  }
  const hasAreas = questions.some((q) => q.kind === "areas");
  if (hasAreas) {
    for (const q of questions) {
      if (q.kind !== "floor_map") continue;
      const cur = phase.get(q.id) ?? "details";
      if (estimatorPhaseRank(cur) < estimatorPhaseRank("measure")) phase.set(q.id, "measure");
    }
  }
  let changed = true;
  let guard = 0;
  while (changed && guard++ < questions.length + 2) {
    changed = false;
    for (const q of questions) {
      for (const k of showIfReferencedKeys(q.config?.show_if)) {
        const gate = byKey.get(k);
        if (!gate) continue;
        const dep = phase.get(q.id) ?? "details";
        const g = phase.get(gate.id) ?? "details";
        if (estimatorPhaseRank(dep) < estimatorPhaseRank(g)) {
          phase.set(q.id, g);
          changed = true;
        }
      }
    }
  }
  return phase;
}

function ancestorIds(
  q: SortableEstimateQuestion,
  questions: SortableEstimateQuestion[],
  byKey: Map<string, SortableEstimateQuestion>,
): Set<string> {
  const seen = new Set<string>();
  const walk = (node: SortableEstimateQuestion) => {
    if (node.kind === "floor_map" || node.kind === "cuts") {
      for (const other of questions) {
        if (other.kind === "areas" && other.id !== node.id && !seen.has(other.id)) {
          seen.add(other.id);
        }
      }
    }
    for (const k of showIfReferencedKeys(node.config?.show_if)) {
      const gate = byKey.get(k);
      if (!gate || gate.id === node.id || seen.has(gate.id)) continue;
      seen.add(gate.id);
      walk(gate);
    }
  };
  walk(q);
  return seen;
}

/**
 * Walk order: Area → Product → Measure → Existing → Installation → Prep →
 * Details. Within a phase, `show_if` gates come first (position is the
 * tie-break) so a newly visible follow-up never appears behind the salesperson.
 */
export function sortEstimateQuestions<T extends SortableEstimateQuestion>(questions: T[]): T[] {
  const phase = questionPhaseMap(questions);
  const byKey = new Map<string, SortableEstimateQuestion>();
  for (const q of questions) if (q.key) byKey.set(q.key, q);
  const anc = new Map<string, Set<string>>();
  for (const q of questions) anc.set(q.id, ancestorIds(q, questions, byKey));
  return [...questions].sort((a, b) => {
    const pr =
      estimatorPhaseRank(phase.get(a.id) ?? "details") -
      estimatorPhaseRank(phase.get(b.id) ?? "details");
    if (pr) return pr;
    const aAnc = anc.get(a.id) ?? new Set();
    const bAnc = anc.get(b.id) ?? new Set();
    const aOnB = aAnc.has(b.id);
    const bOnA = bAnc.has(a.id);
    if (aOnB && !bOnA) return 1;
    if (bOnA && !aOnB) return -1;
    if (a.position !== b.position) return a.position - b.position;
    return a.id.localeCompare(b.id);
  });
}
