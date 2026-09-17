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

import type { KnowledgeWhen, QuestionPurpose } from "@/lib/types";
import type { FlooringFamily, InstallSystem } from "./families";

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

export type KnowledgeQtyUnit = "sqft" | "sqyd" | "lnft" | "each";

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
  // Area / product / measure
  { key: "surface_type", purpose: "MATERIAL", phase: "product" },
  { key: "hs_product", purpose: "MATERIAL", phase: "product" },
  { key: "vinyl_layout", purpose: "WAREHOUSE", phase: "measure", families: ["vinyl"] },
  { key: "pattern_match", purpose: "WAREHOUSE", phase: "product", families: ["carpet"] },
  { key: "carpet_direction", purpose: "WAREHOUSE", phase: "product", families: ["carpet"] },

  // Existing
  { key: "existing_pad", purpose: "LABOR", phase: "existing", families: ["carpet"] },
  { key: "existing_bond", purpose: "LABOR", phase: "existing" },

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

  // Prep
  { key: "substrate", purpose: "PREP", phase: "prep" },
  { key: "subfloor_condition", purpose: "PREP", phase: "prep" },
  { key: "vapor_barrier", purpose: "PREP", phase: "prep", systems: ["floating", "glue"] },
  { key: "moisture_test", purpose: "PREP", phase: "prep" },
  { key: "moisture_mitigation", purpose: "PREP", phase: "prep" },
  { key: "prep_confidence", purpose: "PREP", phase: "prep" },

  // Details
  { key: "tack_strip", purpose: "ACCESSORY", phase: "details", families: ["carpet"], systems: ["stretch_in"] },
  { key: "metals_needed", purpose: "ACCESSORY", phase: "details", families: ["carpet"] },
  { key: "vents_registers", purpose: "ACCESSORY", phase: "details", quantityUnit: "each" },
  { key: "stair_landings", purpose: "MEASUREMENT", phase: "details" },
  { key: "stair_open_sides", purpose: "MEASUREMENT", phase: "details" },
  { key: "occupancy", purpose: "SCHEDULING", phase: "details" },
  { key: "access_conditions", purpose: "SCHEDULING", phase: "details" },
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
