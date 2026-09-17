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
  { key: "pattern_match", purpose: "WAREHOUSE", phase: "measure", families: ["carpet"] },
  { key: "carpet_direction", purpose: "WAREHOUSE", phase: "measure", families: ["carpet"] },

  // Existing
  { key: "existing_pad", purpose: "LABOR", phase: "existing", families: ["carpet"] },
  { key: "hs_demo", purpose: "LABOR", phase: "existing" },
  { key: "existing_bond", purpose: "LABOR", phase: "existing" },
  { key: "demo_disposal", purpose: "LABOR", phase: "existing" },

  // Install
  { key: "install_method", purpose: "INSTALLATION", phase: "install" },
  { key: "carpet_install", purpose: "INSTALLATION", phase: "install", families: ["carpet"] },
  { key: "attached_pad", purpose: "MATERIAL", phase: "install", families: ["lvp", "laminate", "hardwood"], systems: ["floating"] },
  { key: "adhesive", purpose: "MATERIAL", phase: "install", systems: ["glue"] },
  { key: "hs_underlayment", purpose: "MATERIAL", phase: "install", systems: ["floating"] },
  { key: "hardwood_fasteners", purpose: "MATERIAL", phase: "install", systems: ["nail", "staple"] },
  { key: "acclimation", purpose: "INSTALLATION", phase: "install" },
  { key: "construction_grade", purpose: "INSTALLATION", phase: "install", families: ["hardwood", "lvp", "laminate", "vinyl", "tile"] },
  { key: "radiant_heat", purpose: "WARNING", phase: "install" },
  { key: "laminate_expansion", purpose: "SCOPE", phase: "install", systems: ["floating"] },
  { key: "tile_layout", purpose: "INSTALLATION", phase: "install", families: ["tile"] },
  { key: "tile_setting", purpose: "MATERIAL", phase: "install", families: ["tile"] },
  { key: "tack_strip", purpose: "ACCESSORY", phase: "install", families: ["carpet"], systems: ["stretch_in"] },
  { key: "climate_control", purpose: "INSTALLATION", phase: "install" },
  { key: "ac_available", purpose: "INSTALLATION", phase: "install" },
  { key: "heat_available", purpose: "INSTALLATION", phase: "install" },

  // Prep
  { key: "substrate", purpose: "PREP", phase: "prep" },
  { key: "subfloor_condition", purpose: "PREP", phase: "prep" },
  { key: "vapor_barrier", purpose: "PREP", phase: "prep", systems: ["floating", "glue"] },
  { key: "moisture_test", purpose: "PREP", phase: "prep" },
  { key: "moisture_mitigation", purpose: "PREP", phase: "prep" },
  { key: "prep_confidence", purpose: "PREP", phase: "prep" },
  { key: "hs_prep", purpose: "PREP", phase: "prep" },
  { key: "selflevel_needed", purpose: "PREP", phase: "prep" },
  { key: "subfloor_needed", purpose: "PREP", phase: "prep" },

  // Details
  { key: "stairs", purpose: "MEASUREMENT", phase: "details" },
  { key: "metals_needed", purpose: "ACCESSORY", phase: "details", families: ["carpet"] },
  { key: "vents_registers", purpose: "ACCESSORY", phase: "details", quantityUnit: "each" },
  { key: "stair_landings", purpose: "MEASUREMENT", phase: "details" },
  { key: "stair_open_sides", purpose: "MEASUREMENT", phase: "details" },
  { key: "occupancy", purpose: "SCHEDULING", phase: "details" },
  { key: "access_conditions", purpose: "SCHEDULING", phase: "details" },
  { key: "furniture_heavy", purpose: "SCOPE", phase: "details" },
  { key: "carpet_curb", purpose: "LABOR", phase: "details", families: ["carpet"] },
];

export const DEFAULT_KNOWLEDGE_WHEN: Record<string, KnowledgeWhen> = Object.fromEntries(
  KNOWLEDGE_QUESTIONS.map((q) => [
    q.key,
    {
      ...(q.families ? { families: q.families } : {}),
      ...(q.systems ? { systems: q.systems } : {}),
      ...(q.attachedPad ? { attachedPad: q.attachedPad } : {}),
      purpose: q.purpose,
    } satisfies KnowledgeWhen,
  ]),
);

export function knowledgeQuestionByKey(key: string): KnowledgeQuestionDef | undefined {
  return KNOWLEDGE_QUESTIONS.find((q) => q.key === key);
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
