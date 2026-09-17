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
  billsBySqydFamily,
  profileForFamily,
  defaultWastePctForFamily,
  familyLabel,
  type FlooringFamily,
  type HardwoodConstruction,
  type InstallSystem,
  type ConditionConfidence,
} from "./families";

export { matchesShowIf, isShowIfClause } from "./show-if";

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
  accessoryUnitForType,
  billingUnitForCategory,
  type MeasuredArea,
  type CartonTakeoff,
  type MaterialTakeoff,
  type OrderBasis,
  type ComputeTakeoffInput,
} from "./quantities";

export {
  emptyInstallContext,
  installContextFromValByKey,
  DEFAULT_KNOWLEDGE_WHEN,
  knowledgeWhenApplies,
  questionKnowledgeWhen,
  questionApplies,
  questionPurpose,
  knowledgeHelpFor,
  knowledgeWarnings,
  type InstallContext,
} from "./rules";

export {
  buildSalespersonReview,
  reviewToJobNotes,
  familyListLabel,
  formatFtIn,
  formatDimensionPair,
  confidenceFromLabel,
  type ReviewRoom,
  type ReviewSection,
  type SalespersonReview,
} from "./takeoff";
