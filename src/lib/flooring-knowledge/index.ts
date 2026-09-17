/**
 * Flooring knowledge engine — the rules the guided estimate asks by.
 *
 * Flooring Family → Installation System → Relevant Questions → Derived
 * values → Generated lines → Warnings → Scope notes.
 *
 * Catalog categories are not invented here. Families map onto the existing
 * ProductCategory set (carpet, lvp, hardwood, laminate, tile, vinyl, …).
 */

export {
  SURFACE_TYPE_LABELS,
  LEGACY_LVP_VINYL_LABEL,
  INSTALL_METHOD_LABELS,
  CONDITION_CONFIDENCE_LABELS,
  familyFromCatalogCategory,
  familyFromSurfaceLabel,
  hardwoodConstructionFromLabel,
  catalogCategoryForFamily,
  installSystemFromLabel,
  permittedInstallSystems,
  installMethodOptionsFor,
  installMethodOptionsForFamilies,
  isRollGoodsFamily,
  isBoxedFamily,
  isHardSurfaceStairFamily,
  jobNeedsHardSurfaceStairTrim,
  flooringFamiliesFromCategories,
  mergeFlooringFamilies,
  unscopedProductFamilies,
  billsBySqydFamily,
  profileForFamily,
  defaultWastePctForFamily,
  familyLabel,
  hardwoodConstructionFromSpecies,
  prepQuantitiesAreFinal,
  prepQuantitySuffix,
  type FlooringFamily,
  type HardwoodConstruction,
  type InstallSystem,
  type ConditionConfidence,
} from "./families";

export { matchesShowIf, isShowIfClause, showIfReferencedKeys } from "./show-if";

export {
  answerGateValues,
  synthesizeStairGate,
  stairStepCountFromAnswer,
  stairStepCountFromAnswers,
  applyHardSurfaceStairTrimFill,
  HARD_SURFACE_STAIR_TRIM_LABELS,
  answersHaveTrimType,
  HS_TRANSITION_OPTION_TO_TRIM,
  HS_BASE_OPTION_TO_TRIM,
  trimLabelsFromPicks,
  applyTrimTypeSeed,
  presentTrimTypes,
  keyedChoiceSelections,
  type GateAnswer,
  type StairAnswerKind,
  type HardSurfaceStairTrimLabel,
} from "./answers";

export {
  knowledgeQuestionByKey,
  amountUnitLabelForQuestion,
  estimatorPhaseForQuestion,
  estimatorPhaseRank,
  estimatorPhaseLabel,
  questionPhaseMap,
  sortEstimateQuestions,
  ESTIMATOR_PHASE_ORDER,
  ESTIMATOR_PHASE_LABELS,
  type KnowledgeQuestionDef,
  type EstimatorPhase,
  type SortableEstimateQuestion,
} from "./registry";

export {
  measuredArea,
  equivalentSqyd,
  sqydToSqft,
  cartonTakeoff,
  computeMaterialTakeoff,
  formatSqft,
  formatSqyd,
  formatMeasuredLabel,
  formatBillingQty,
  formatTakeoffStrip,
  accessoryUnitForType,
  coerceTrimUnit,
  defaultCutWidthFt,
  cutWidthChoicesFt,
  billingUnitForCategory,
  rollGoodsHaveCuts,
  materialWastePctForEmit,
  type MeasuredArea,
  type CartonTakeoff,
  type MaterialTakeoff,
  type OrderBasis,
  type ComputeTakeoffInput,
} from "./quantities";

export {
  emptyInstallContext,
  installContextFromValByKey,
  withProductFamilies,
  DEFAULT_KNOWLEDGE_WHEN,
  KNOWLEDGE_QUESTIONS,
  knowledgeWhenApplies,
  knowledgeClauseApplies,
  questionKnowledgeWhen,
  questionApplies,
  questionPurpose,
  knowledgeHelpFor,
  knowledgeWarnings,
  visibleKnowledgeKeys,
  resolveQuestionVisibility,
  substrateLabelMatches,
  type InstallContext,
} from "./rules";

export {
  buildSalespersonReview,
  reviewToJobNotes,
  familyListLabel,
  formatFtIn,
  formatDimensionPair,
  confidenceFromLabel,
  groupMeasuredSqftByLabel,
  deliveryAddonCost,
  reviewBucketForQuestion,
  type ReviewRoom,
  type ReviewSection,
  type ReviewBucket,
  type SalespersonReview,
} from "./takeoff";
