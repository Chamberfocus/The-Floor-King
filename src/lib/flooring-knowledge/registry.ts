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
   * Replacement vs new construction. Positive "New construction" hides tear-out
   * questions (demo, pad, bond, asbestos, disposal). Unanswered stays open.
   */
  { key: "work_type", purpose: "SCOPE", phase: "existing" },
  /**
   * Pad removal follows EXISTING carpet, not only a new-carpet job.
   * Installing carpet still asks it. LVP/hardwood/tile over carpet asks it
   * once hs_demo is Carpet. Sit after hs_demo so the follow-up is not behind
   * the salesperson (0142).
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
   * the follow-up is not behind the salesperson (0142).
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
  { key: "install_method", purpose: "INSTALLATION", phase: "install" },
  { key: "carpet_install", purpose: "INSTALLATION", phase: "install", families: ["carpet"] },
  { key: "attached_pad", purpose: "MATERIAL", phase: "install", families: ["lvp", "laminate", "hardwood"], systems: ["floating"] },
  /** Residential pad is stretch-in. Glue-down / carpet tile hide this. */
  { key: "carpet_pad", purpose: "MATERIAL", phase: "install", families: ["carpet"], systems: ["stretch_in"],
    require: { key: "carpet_install", in: ["Stretch-in"] } },
  /** Glue-down of any family, or carpet tile (pressure-sensitive / glue). */
  { key: "adhesive", purpose: "MATERIAL", phase: "install", systems: ["glue", "carpet_tile"] },
  { key: "hs_underlayment", purpose: "MATERIAL", phase: "install", systems: ["floating"] },
  { key: "hardwood_fasteners", purpose: "MATERIAL", phase: "install", systems: ["nail", "staple"] },
  /**
   * Prefinished vs unfinished (site finish). Catalog has no sand/finish labor —
   * capture as scope. Overlay families hardwood so laminate/LVP hide once the
   * surface is known; unanswered HS stays open (surfacePending).
   */
  { key: "hardwood_finish", purpose: "SCOPE", phase: "product", families: ["hardwood"] },
  /**
   * Hardwood (solid or engineered) OR glue-down of any family — including
   * glue-down carpet. Laminate floating / stretch-in carpet / thinset tile hide this.
   */
  {
    key: "acclimation",
    purpose: "INSTALLATION",
    phase: "install",
    any: [{ families: ["hardwood"] }, { systems: ["glue"] }],
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
   * carpet over plywood does not.
   */
  {
    key: "vapor_barrier",
    purpose: "PREP",
    phase: "prep",
    any: [{ systems: ["floating", "glue"] }, { substrate: ["Concrete"] }],
  },
  /**
   * Hardwood OR glue-down OR the salesperson flagged moisture concerns on
   * the substrate — laminate floating still hides this unless condition says so.
   */
  {
    key: "moisture_test",
    purpose: "PREP",
    phase: "prep",
    any: [
      { families: ["hardwood"] },
      { systems: ["glue"] },
      { subfloor: ["Moisture concerns"] },
    ],
  },
  /**
   * Same gate as moisture_test: hardwood OR glue OR a moisture-concern flag.
   * Floating laminate without that flag hides Aqua bar / primer.
   */
  {
    key: "moisture_mitigation",
    purpose: "PREP",
    phase: "prep",
    any: [
      { families: ["hardwood"] },
      { systems: ["glue"] },
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
  { key: "subfloor_needed", purpose: "PREP", phase: "prep" },
  { key: "vinyl_skim", purpose: "PREP", phase: "prep", families: ["vinyl"] },

  // Details
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
  {
    key: "stair_landings",
    purpose: "MEASUREMENT",
    phase: "details",
    quantityUnit: "each",
    require: { key: "stairs", in: ["Yes"] },
  },
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
   */
  { key: "wet_area", purpose: "WARNING", phase: "details" },
  { key: "access_conditions", purpose: "SCHEDULING", phase: "details" },
  { key: "crew_entry", purpose: "SCHEDULING", phase: "details" },
  { key: "furniture_level", purpose: "LABOR", phase: "details" },
  { key: "furniture_heavy", purpose: "SCOPE", phase: "details" },
  { key: "toilets", purpose: "LABOR", phase: "details", quantityUnit: "each" },
  { key: "appliances", purpose: "LABOR", phase: "details", quantityUnit: "each" },
  { key: "doors_shave", purpose: "LABOR", phase: "details", quantityUnit: "each" },
  { key: "delivery_scope", purpose: "PURCHASING", phase: "details" },
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
  "asbestos_risk",
  "vinyl_skim",
] as const;

/**
 * Pull-and-reset is replacement work. New construction hides these.
 * Unanswered and Unknown stay open. Do not SQL-gate toilets on work_type (0142).
 * Appliances and door shaves stay — those can still apply on a new slab.
 */
export const NEW_CONSTRUCTION_HIDES_KEYS = ["toilets"] as const;

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
] as const;

/**
 * Furniture moving is for occupied homes. Vacant hides these. Unanswered
 * and Unknown stay open (0142). Do not SQL-gate furniture on occupancy.
 */
export const FURNITURE_MOVING_KEYS = ["furniture_level", "furniture_heavy"] as const;

/**
 * Roll-goods layout follow-ups hidden once carpet_install is exclusively
 * Carpet tile. Unanswered stays visible. Stretch-in / glue-down mixed with
 * tile still ask them — those rooms still need a cut plan. Do not SQL-gate
 * pattern_match on carpet_install (0142).
 */
export const CARPET_TILE_HIDES_KEYS = [
  "pattern_match",
  "pattern_repeat",
  "carpet_direction",
] as const;

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
