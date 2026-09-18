/**
 * Question relevance + purpose.
 *
 * `show_if` is the salesperson-editable gate stored on each question.
 * `knowledge_when` / the overlay is the flooring-domain gate: even a question
 * whose show_if is "any hard surface" must not ask for adhesive on a floating
 * job.
 *
 * Overlay rule: only HIDE when we have positive evidence the question does not
 * apply. Unanswered gates stay visible so we never skip a branch the estimator
 * hasn't reached yet.
 */

import type { KnowledgeWhen, KnowledgeWhenClause, QuestionPurpose, ShowIfClause } from "@/lib/types";
import {
  familyFromSurfaceLabel,
  hardwoodConstructionFromLabel,
  installSystemFromLabel,
  isHardSurfaceFamily,
  isHardSurfaceStairFamily,
  rollGoodsNeedCuts,
  carpetInstallSystemsFromLabels,
  flooringFamiliesFromCategories,
  mergeFlooringFamilies,
  unscopedProductFamilies,
  familyLabel,
  solePermittedInstallSystem,
  leftoverIllegalSoleInstallLabels,
  coalesceSoleInstallSystem,
  stripIllegalInstallSystems,
  permittedInstallSystems,
  INSTALL_METHOD_LABELS,
  type FlooringFamily,
  type HardwoodConstruction,
  type InstallSystem,
} from "./families";
import { matchesShowIf } from "./show-if";
import {
  jobIsExclusiveNewConstruction,
  jobIsVacant,
  labelsAreNewConstructionOnly,
  labelsAreWallOnly,
  labelsAreConcreteOnly,
  labelsAreWoodDeckOnly,
  labelsAreExistingFlooringOnly,
  synthesizeStairGate,
} from "./answers";
import {
  CARPET_TILE_HIDES_KEYS,
  CARPET_TILE_VAPOR_HIDES_KEYS,
  CARPET_ONLY_HIDES_KEYS,
  DEAD_STAIR_GATE_HIDES_KEYS,
  DEAD_STAIR_FOLLOWUP_HIDES_KEYS,
  CONCRETE_HIDES_KEYS,
  WOOD_DECK_MOISTURE_HIDES_KEYS,
  GLUE_WOOD_VAPOR_HIDES_KEYS,
  WOOD_DECK_AQUA_HIDES_KEYS,
  WOOD_DECK_VAPOR_HIDES_KEYS,
  GLUE_EXISTING_VAPOR_HIDES_KEYS,
  EXISTING_FLOOR_AQUA_HIDES_KEYS,
  EXISTING_FLOOR_VAPOR_HIDES_KEYS,
  LOOSE_LAY_VAPOR_HIDES_KEYS,
  NON_VINYL_DEMO_SKIM_HIDES_KEYS,
  NON_HARDWOOD_FASTENER_HIDES_KEYS,
  NON_CARPET_DEMO_PAD_HIDES_KEYS,
  NONE_DEMO_DISPOSAL_HIDES_KEYS,
  EXCLUSIVE_TILE_METHOD_HIDES_KEYS,
  DEFAULT_KNOWLEDGE_WHEN,
  FURNITURE_MOVING_KEYS,
  KNOWLEDGE_QUESTIONS,
  MERGED_CLIMATE_HIDES_KEYS,
  MERGED_CURB_HIDES_KEYS,
  NEW_CONSTRUCTION_HIDES_KEYS,
  REMOVAL_QUESTION_KEYS,
  SOLID_HARDWOOD_HIDES_KEYS,
  TILE_THINSET_HIDES_KEYS,
  TILE_WALL_HIDES_KEYS,
  tileWallHidesPrepOptionLabel,
  tileWallHidesDemoOptionLabel,
  vaporBarrierHidesUnderlaymentOptionLabel,
} from "./registry";

export { DEFAULT_KNOWLEDGE_WHEN, KNOWLEDGE_QUESTIONS } from "./registry";

export interface InstallContext {
  projectTypes: string[];
  surfaceLabels: string[];
  families: FlooringFamily[];
  installLabels: string[];
  systems: InstallSystem[];
  hardwoodConstruction: HardwoodConstruction;
  attachedPad: "yes" | "no" | "unknown";
  substrate: string[];
  grade: string[];
  stairs: boolean | null;
  existingFlooring: string[];
  prepConfidence: string[];
  occupancy: string[];
  /** Replacement vs new construction (work_type). */
  workType: string[];
  /** Subfloor condition labels (flat / uneven / moisture / TBD). */
  subfloorCondition: string[];
  /** Floor prep / leveling choice (None / skim / self-level / …). */
  hsPrep: string[];
  /** Subfloor needed? Yes/No. */
  subfloorNeeded: string[];
  /** Hard surface chosen but surface type not answered yet. */
  surfacePending: boolean;
  /** Hard surface / carpet install method not answered yet. */
  installPending: boolean;
  /**
   * Families on assigned products that project_type / surface_type did not
   * scope. Overlay still unions them into `families`; this list is the warning.
   */
  unscopedProductFamilies: FlooringFamily[];
  /** Raw hard-surface `install_method` answers — empty means we may infer a sole system. */
  answeredInstallMethod: string[];
  /** Raw `carpet_install` answers. Stretch-in / carpet tile never infer. */
  answeredCarpetInstall: string[];
  /** Floor vs wall vs both vs unknown. Empty means unanswered. */
  tileApplication: string[];
  /** Climate control multi-select (AC / Heat). */
  climateControl: string[];
  /** Legacy yes/no from before climate_control merged AC + heat (0142). */
  acAvailable: string[];
  heatAvailable: string[];
  /** Radiant heat Yes / No / Unknown. */
  radiantHeat: string[];
  /** Moisture test Yes / No / Field verify. */
  moistureTest: string[];
}

export function emptyInstallContext(): InstallContext {
  return {
    projectTypes: [],
    surfaceLabels: [],
    families: [],
    installLabels: [],
    systems: [],
    hardwoodConstruction: "unknown",
    attachedPad: "unknown",
    substrate: [],
    grade: [],
    stairs: null,
    existingFlooring: [],
    prepConfidence: [],
    occupancy: [],
    workType: [],
    subfloorCondition: [],
    hsPrep: [],
    subfloorNeeded: [],
    surfacePending: false,
    installPending: false,
    unscopedProductFamilies: [],
    answeredInstallMethod: [],
    answeredCarpetInstall: [],
    tileApplication: [],
    climateControl: [],
    acAvailable: [],
    heatAvailable: [],
    radiantHeat: [],
    moistureTest: [],
  };
}

function uniqueStrings(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of list) {
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function uniqueSystems(list: InstallSystem[]): InstallSystem[] {
  const seen = new Set<string>();
  const out: InstallSystem[] = [];
  for (const s of list) {
    if (s === "unknown" || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * Rebuild systems/labels from answered methods, then infer a sole hard-surface
 * system (laminate floating, tile thinset, sheet vinyl glue) when unanswered
 * **or** when leftover chips are illegal for that family. Mixed LVP + laminate
 * does not infer — those families do not share one method.
 */
export function finalizeInstallContext(ctx: InstallContext): InstallContext {
  const hasHS =
    ctx.projectTypes.some((p) => /hard/i.test(p)) || ctx.families.some(isHardSurfaceFamily);
  const hasCarpet = jobHasCarpetInstallScope(ctx);
  const carpetSystems = hasCarpet
    ? ctx.answeredCarpetInstall
        .map(installSystemFromLabel)
        .filter((s): s is InstallSystem => s !== "unknown")
    : [];
  const hsScope = jobHasHardSurfaceInstallScope(ctx);
  const hsAnswered = hsScope
    ? ctx.answeredInstallMethod
        .map(installSystemFromLabel)
        .filter((s): s is InstallSystem => s !== "unknown")
    : [];
  const coalesced = coalesceSoleInstallSystem(
    ctx.families,
    ctx.hardwoodConstruction,
    hsAnswered,
  );
  const hsSystems = stripIllegalInstallSystems(
    ctx.families,
    ctx.hardwoodConstruction,
    coalesced.systems,
  );
  const inferredLabel = coalesced.inferred
    ? INSTALL_METHOD_LABELS[coalesced.inferred]
    : null;
  const sole = coalesced.inferred ?? solePermittedInstallSystem(ctx.families, ctx.hardwoodConstruction);
  return {
    ...ctx,
    systems: uniqueSystems([...carpetSystems, ...hsSystems]),
    installLabels: uniqueStrings([
      ...(hasCarpet ? ctx.answeredCarpetInstall : []),
      ...(hsScope ? ctx.answeredInstallMethod : []),
      ...(inferredLabel ? [inferredLabel] : []),
    ]),
    installPending:
      (hasHS && !ctx.answeredInstallMethod.length && !sole) ||
      (hasCarpet && !ctx.answeredCarpetInstall.length),
  };
}

/**
 * Fill `install_method` for show_if when the family has only one legal system.
 * Overlay inference alone would hide adhesive on laminate while SQL show_if
 * for attached_pad still waited for a click. Leftover illegal chips (Glue-down
 * on laminate, Floating on sheet vinyl / tile) are replaced so SQL show_if
 * follows the legal system — do not SQL-gate adhesive on surface_type (0142).
 */
export function synthesizeSoleInstallMethod(
  valByKey: Record<string, string[]>,
): Record<string, string[]> {
  const ctx = installContextFromValByKey(valByKey);
  const sole = solePermittedInstallSystem(ctx.families, ctx.hardwoodConstruction);
  if (!sole) return valByKey;
  const label = INSTALL_METHOD_LABELS[sole];
  const have = valByKey.install_method ?? [];
  if (!have.length) return { ...valByKey, install_method: [label] };
  const legal = have.filter((l) => installSystemFromLabel(l) === sole);
  if (legal.length === have.length) return valByKey;
  if (legal.length) return { ...valByKey, install_method: legal };
  return { ...valByKey, install_method: [label] };
}

export function installContextFromValByKey(valByKey: Record<string, string[]>): InstallContext {
  const projectTypes = valByKey.project_type ?? [];
  const surfaceLabels = valByKey.surface_type ?? [];
  const families: FlooringFamily[] = [];
  const seen = new Set<string>();
  const add = (f: FlooringFamily | null) => {
    if (!f || seen.has(f)) return;
    seen.add(f);
    families.push(f);
  };
  const hasHS = projectTypes.some((p) => /hard/i.test(p));
  const exclusiveCarpetByProject =
    projectTypes.some((p) => /carpet/i.test(p)) && !hasHS;
  if (projectTypes.some((p) => /carpet/i.test(p))) add("carpet");
  // Leftover Surface type on exclusive carpet is not a mixed job — same as
  // leftover Floating on install_method (0274). Mixed Carpet + LVP still
  // unions surface labels. Unanswered project_type still reads them (0142).
  if (!exclusiveCarpetByProject) {
    for (const s of surfaceLabels) add(familyFromSurfaceLabel(s));
  }

  let hardwoodConstruction: HardwoodConstruction = "unknown";
  if (!exclusiveCarpetByProject) {
    for (const s of surfaceLabels) {
      const c = hardwoodConstructionFromLabel(s);
      if (c !== "unknown") {
        hardwoodConstruction = c;
        break;
      }
    }
  }

  const padAns = (valByKey.attached_pad ?? [])[0]?.toLowerCase() ?? "";
  const attachedPad: InstallContext["attachedPad"] =
    padAns === "yes" ? "yes" : padAns === "no" || padAns === "unknown" ? (padAns === "no" ? "no" : "unknown") : padAns ? "unknown" : "unknown";

  const stairsRaw = [
    ...(valByKey.stairs ?? []),
    ...(valByKey.carpet_stairs ?? []),
    ...(valByKey.hs_plank_stairs ?? []),
  ];
  const stairs = stairsRaw.length
    ? stairsRaw.some((v) => v === "Yes" || /yes/i.test(v))
    : null;

  return finalizeInstallContext({
    projectTypes,
    surfaceLabels,
    families,
    installLabels: [],
    systems: [],
    hardwoodConstruction,
    attachedPad,
    substrate: valByKey.substrate ?? valByKey.subfloor_type ?? [],
    grade: valByKey.construction_grade ?? [],
    stairs,
    existingFlooring: valByKey.hs_demo ?? [],
    prepConfidence: valByKey.prep_confidence ?? [],
    occupancy: valByKey.occupancy ?? [],
    workType: valByKey.work_type ?? [],
    subfloorCondition: valByKey.subfloor_condition ?? [],
    hsPrep: valByKey.hs_prep ?? [],
    subfloorNeeded: valByKey.subfloor_needed ?? [],
    surfacePending: hasHS && surfaceLabels.length === 0,
    installPending: false,
    unscopedProductFamilies: [],
    answeredInstallMethod: valByKey.install_method ?? [],
    answeredCarpetInstall: valByKey.carpet_install ?? [],
    tileApplication: valByKey.tile_application ?? [],
    climateControl: valByKey.climate_control ?? [],
    acAvailable: valByKey.ac_available ?? [],
    heatAvailable: valByKey.heat_available ?? [],
    radiantHeat: valByKey.radiant_heat ?? [],
    moistureTest: valByKey.moisture_test ?? [],
  });
}

/**
 * Hardwood, any glue-down system (including glue-down carpet), or carpet
 * tile. Stretch-in and floating laminate do not need the climate /
 * acclimation warning.
 */
export function installNeedsAcclimationClimate(ctx: InstallContext): boolean {
  return (
    ctx.families.includes("hardwood") ||
    ctx.systems.includes("glue") ||
    ctx.systems.includes("carpet_tile")
  );
}

export function jobNeedsAcclimationClimate(valByKey: Record<string, string[]>): boolean {
  return installNeedsAcclimationClimate(installContextFromValByKey(valByKey));
}

/** AC + heat confirmed. Legacy ac_available / heat_available still count (0142). */
export function climateControlConfirmed(ctx: InstallContext): boolean {
  const hasAc =
    ctx.climateControl.some((l) => /^ac$/i.test(l.trim())) ||
    ctx.acAvailable.some((l) => /^yes$/i.test(l.trim()));
  const hasHeat =
    ctx.climateControl.some((l) => /^heat$/i.test(l.trim())) ||
    ctx.heatAvailable.some((l) => /^yes$/i.test(l.trim()));
  return hasAc && hasHeat;
}

/**
 * Union families from assigned catalog products (floor map / cuts) so a mixed
 * job asks the right overlay questions. Unscoped families stay on the context
 * for the warning — we do not invent a second project_type.
 */
export function withProductFamilies(
  ctx: InstallContext,
  categories: Array<string | null | undefined>,
): InstallContext {
  const productFamilies = flooringFamiliesFromCategories(categories);
  return finalizeInstallContext({
    ...ctx,
    unscopedProductFamilies: unscopedProductFamilies(ctx, productFamilies),
    families: mergeFlooringFamilies(ctx.families, productFamilies),
  });
}

/**
 * Overlay for keyed questions. Built from the canonical registry so a new
 * family is a registry + permitted-systems entry, not a second copy of keys.
 */

function listHas(have: string[], want: string[]): boolean {
  return want.some((w) => have.includes(w));
}

/** Concrete matches "Concrete" and "Concrete slab"; not a substring of plywood. */
export function substrateLabelMatches(have: string[], want: string[]): boolean {
  const norm = (s: string) => s.trim().toLowerCase();
  const haveN = have.map(norm);
  return want.some((w) => {
    const nw = norm(w);
    if (!nw) return false;
    return haveN.some((h) => h === nw || h.startsWith(`${nw} `) || h.startsWith(`${nw}/`));
  });
}

/**
 * One overlay clause: hide only with positive evidence. Unanswered surface
 * or install method keeps the clause open so we never skip a branch the
 * estimator has not reached yet.
 */
export function knowledgeClauseApplies(clause: KnowledgeWhenClause, ctx: InstallContext): boolean {
  if (clause.families?.length) {
    if (ctx.surfacePending) {
      // Still deciding the HS product — don't hide family-specific questions
      // that aren't already gated by show_if. Carpet-only questions DO hide
      // when the job is HS-only with no carpet.
      const wantsCarpet = clause.families.includes("carpet");
      const hasCarpet = ctx.families.includes("carpet") || ctx.projectTypes.some((p) => /carpet/i.test(p));
      const wantsHs = clause.families.some((f) => f !== "carpet");
      if (wantsCarpet && !hasCarpet && !wantsHs) return false;
    } else if (!ctx.families.some((f) => clause.families!.includes(f))) {
      return false;
    }
  }

  if (clause.systems?.length) {
    if (ctx.installPending || ctx.systems.length === 0) {
      // Method not chosen — leave the question to show_if.
    } else if (!ctx.systems.some((s) => clause.systems!.includes(s))) {
      return false;
    }
  }

  if (clause.substrate?.length) {
    const have = ctx.substrate ?? [];
    if (!have.length) {
      // Positive-match expander (SQL `{ key: substrate, in }`). Unanswered
      // does not satisfy an OR branch that is only about substrate.
      if (!clause.families?.length && !clause.systems?.length && !clause.subfloor?.length && !clause.demo?.length) return false;
    } else if (!substrateLabelMatches(have, clause.substrate)) {
      return false;
    }
  }

  if (clause.subfloor?.length) {
    const have = ctx.subfloorCondition ?? [];
    if (!have.length) {
      if (!clause.families?.length && !clause.systems?.length && !clause.substrate?.length && !clause.demo?.length) return false;
    } else if (!substrateLabelMatches(have, clause.subfloor)) {
      return false;
    }
  }

  if (clause.demo?.length) {
    const have = ctx.existingFlooring ?? [];
    if (!have.length) {
      // Positive-match expander (SQL `{ key: hs_demo, in }`). Unanswered
      // does not satisfy an OR branch that is only about what is coming up.
      if (!clause.families?.length && !clause.systems?.length && !clause.substrate?.length && !clause.subfloor?.length) {
        return false;
      }
    } else if (!listHas(have, clause.demo)) {
      return false;
    }
  }

  return true;
}

/**
 * Overlay: hide only with positive evidence.
 * Top-level families/systems AND together; `any` is an OR of those clauses
 * (hardwood OR glue-down — matching 0190 show_if, not the intersection).
 */
export function knowledgeWhenApplies(when: KnowledgeWhen | null | undefined, ctx: InstallContext): boolean {
  if (!when) return true;

  if (!knowledgeClauseApplies(when, ctx)) return false;

  if (when.any?.length) {
    if (!when.any.some((clause) => knowledgeClauseApplies(clause, ctx))) return false;
  }

  if (when.require?.key && when.require.in?.length) {
    // require is a positive match when that key has any value; if unanswered, show.
    // The caller passes valByKey separately via matchesShowIf for require.
  }

  if (when.attachedPad && when.attachedPad !== "any") {
    if (ctx.attachedPad !== "unknown" && ctx.attachedPad !== when.attachedPad) return false;
  }

  return true;
}

export function questionKnowledgeWhen(q: {
  key?: string | null;
  config?: { knowledge_when?: KnowledgeWhen | null };
}): KnowledgeWhen | null {
  if (q.config?.knowledge_when) return q.config.knowledge_when;
  if (q.key && DEFAULT_KNOWLEDGE_WHEN[q.key]) return DEFAULT_KNOWLEDGE_WHEN[q.key];
  return null;
}

export function questionApplies(
  q: {
    key?: string | null;
    config?: { show_if?: ShowIfClause | null; knowledge_when?: KnowledgeWhen | null };
  },
  valByKey: Record<string, string[]>,
  ctx?: InstallContext,
): boolean {
  if (!matchesShowIf(q.config?.show_if, valByKey)) return false;
  const when = questionKnowledgeWhen(q);
  const install = ctx ?? installContextFromValByKey(valByKey);
  if (!knowledgeWhenApplies(when, install)) return false;
  if (when?.require?.key) {
    const have = valByKey[when.require.key] ?? [];
    if (have.length && !listHas(have, when.require.in)) return false;
  }
  if (
    q.key &&
    (MERGED_CLIMATE_HIDES_KEYS as readonly string[]).includes(q.key)
  ) {
    return false;
  }
  if (
    q.key &&
    (MERGED_CURB_HIDES_KEYS as readonly string[]).includes(q.key)
  ) {
    return false;
  }
  if (
    q.key &&
    (CARPET_ONLY_HIDES_KEYS as readonly string[]).includes(q.key) &&
    jobIsExclusiveCarpetOnly(install)
  ) {
    return false;
  }
  if (
    q.key &&
    (DEAD_STAIR_GATE_HIDES_KEYS as readonly string[]).includes(q.key) &&
    jobHidesDeadStairGate(install)
  ) {
    return false;
  }
  if (
    q.key &&
    (DEAD_STAIR_FOLLOWUP_HIDES_KEYS as readonly string[]).includes(q.key) &&
    jobHidesDeadStairFollowups(install, valByKey)
  ) {
    return false;
  }
  // Attached-pad Yes → hide separate-underlayment questions.
  if (q.key === "hs_underlayment" && install.attachedPad === "yes") return false;
  if (
    q.key &&
    (REMOVAL_QUESTION_KEYS as readonly string[]).includes(q.key) &&
    jobIsExclusiveNewConstruction(valByKey)
  ) {
    return false;
  }
  if (
    q.key &&
    (TILE_WALL_HIDES_KEYS as readonly string[]).includes(q.key) &&
    jobIsExclusiveWallTile(install)
  ) {
    return false;
  }
  if (
    q.key &&
    (FURNITURE_MOVING_KEYS as readonly string[]).includes(q.key) &&
    (jobIsVacant(valByKey) || jobIsExclusiveWallTile(install) || jobIsExclusiveNewConstruction(valByKey))
  ) {
    return false;
  }
  if (
    q.key &&
    (NEW_CONSTRUCTION_HIDES_KEYS as readonly string[]).includes(q.key) &&
    jobIsExclusiveNewConstruction(valByKey)
  ) {
    return false;
  }
  if (
    q.key &&
    (CARPET_TILE_HIDES_KEYS as readonly string[]).includes(q.key) &&
    jobIsExclusiveCarpetTile(install)
  ) {
    return false;
  }
  if (
    q.key &&
    (SOLID_HARDWOOD_HIDES_KEYS as readonly string[]).includes(q.key) &&
    jobIsExclusiveSolidHardwood(install)
  ) {
    return false;
  }
  if (
    q.key &&
    (TILE_THINSET_HIDES_KEYS as readonly string[]).includes(q.key) &&
    jobIsExclusiveTile(install)
  ) {
    return false;
  }
  if (
    q.key &&
    (CARPET_TILE_VAPOR_HIDES_KEYS as readonly string[]).includes(q.key) &&
    jobIsExclusiveCarpetTileOnly(install)
  ) {
    return false;
  }
  if (
    q.key &&
    (CONCRETE_HIDES_KEYS as readonly string[]).includes(q.key) &&
    jobIsExclusiveConcrete(install)
  ) {
    return false;
  }
  if (
    q.key &&
    (WOOD_DECK_MOISTURE_HIDES_KEYS as readonly string[]).includes(q.key) &&
    jobHidesSlabMoistureOnWoodDeck(install)
  ) {
    return false;
  }
  if (
    q.key &&
    (GLUE_WOOD_VAPOR_HIDES_KEYS as readonly string[]).includes(q.key) &&
    jobHidesVaporOnGlueWoodDeck(install)
  ) {
    return false;
  }
  if (
    q.key &&
    (WOOD_DECK_AQUA_HIDES_KEYS as readonly string[]).includes(q.key) &&
    jobHidesAquaBarOnGlueWoodDeck(install)
  ) {
    return false;
  }
  if (
    q.key &&
    (WOOD_DECK_VAPOR_HIDES_KEYS as readonly string[]).includes(q.key) &&
    jobHidesVaporOnWoodDeck(install)
  ) {
    return false;
  }
  if (
    q.key &&
    (GLUE_EXISTING_VAPOR_HIDES_KEYS as readonly string[]).includes(q.key) &&
    jobHidesVaporOnGlueExistingFloor(install)
  ) {
    return false;
  }
  if (
    q.key &&
    (EXISTING_FLOOR_AQUA_HIDES_KEYS as readonly string[]).includes(q.key) &&
    jobHidesAquaBarOnExistingFloor(install)
  ) {
    return false;
  }
  if (
    q.key &&
    (EXISTING_FLOOR_VAPOR_HIDES_KEYS as readonly string[]).includes(q.key) &&
    jobHidesVaporOnExistingFloor(install)
  ) {
    return false;
  }
  if (
    q.key &&
    (LOOSE_LAY_VAPOR_HIDES_KEYS as readonly string[]).includes(q.key) &&
    jobHidesVaporOnLooseLay(install)
  ) {
    return false;
  }
  if (
    q.key &&
    (NON_VINYL_DEMO_SKIM_HIDES_KEYS as readonly string[]).includes(q.key) &&
    jobHidesVinylSkimOnNonVinylDemo(install)
  ) {
    return false;
  }
  if (
    q.key &&
    (NON_HARDWOOD_FASTENER_HIDES_KEYS as readonly string[]).includes(q.key) &&
    jobHidesFastenersOnNonHardwood(install)
  ) {
    return false;
  }
  if (
    q.key &&
    (NON_CARPET_DEMO_PAD_HIDES_KEYS as readonly string[]).includes(q.key) &&
    jobHidesPadOnNonCarpetDemo(install)
  ) {
    return false;
  }
  if (
    q.key &&
    (NONE_DEMO_DISPOSAL_HIDES_KEYS as readonly string[]).includes(q.key) &&
    jobHidesDisposalOnNoDemo(install)
  ) {
    return false;
  }
  if (
    q.key &&
    (EXCLUSIVE_TILE_METHOD_HIDES_KEYS as readonly string[]).includes(q.key) &&
    jobIsExclusiveTile(install)
  ) {
    return false;
  }
  return true;
}

/**
 * Carpet, LVP, hardwood, laminate, or sheet vinyl still need floor questions
 * even when a tile room is Wall (backsplash + LVP floors, carpet + wall tile).
 */
export function jobHasNonTileFloorFamily(install: InstallContext): boolean {
  return install.families.some((f) => f === "carpet" || (isHardSurfaceFamily(f) && f !== "tile"));
}

/**
 * Exclusive Concrete substrate — 4×8 plywood overlay is a wood-deck repair,
 * not a slab pour. Unknown / existing flooring / plywood stay open so we
 * do not hide sheets behind the salesperson (0142).
 */
export function jobIsExclusiveConcrete(install: InstallContext): boolean {
  return labelsAreConcreteOnly(install.substrate);
}

/**
 * Hard-surface install_method chips apply only when a hard-surface family is
 * in play (or HS is still unanswered). Carpet-only leftover Floating / Glue
 * must not reopen click-floor follow-ups or undo exclusive carpet-tile vapor
 * hide. Mixed Carpet + LVP keeps those chips. Unanswered HS stays open (0142).
 */
export function jobHasHardSurfaceInstallScope(install: InstallContext): boolean {
  if (install.surfacePending) return true;
  return install.families.some(isHardSurfaceFamily);
}

/**
 * Carpet install chips apply only when Carpet is in play. Leftover
 * Stretch-in / Glue-down / Carpet tile on exclusive LVP must not reopen
 * adhesive, moisture, or acclimation. Mixed Carpet + LVP keeps those
 * chips. Unanswered carpet stays open via project_type (0142).
 */
export function jobHasCarpetInstallScope(install: InstallContext): boolean {
  return (
    install.projectTypes.some((p) => /carpet/i.test(p)) ||
    install.families.includes("carpet")
  );
}

/**
 * Exclusive carpet — project_type is Carpet without Hard surface. Leftover
 * Surface type chips do not reopen the HS pickers (same as leftover Floating
 * on install_method). Mixed Carpet + LVP still asks. Unanswered HS stays
 * open (0142). Unanswered project_type is not exclusive carpet.
 */
export function jobIsExclusiveCarpetOnly(install: InstallContext): boolean {
  if (install.surfacePending) return false;
  if (install.projectTypes.some((p) => /hard/i.test(p))) return false;
  return (
    install.families.includes("carpet") ||
    install.projectTypes.some((p) => /carpet/i.test(p))
  );
}

/**
 * Generic stairs yes/no is a leftover synthesizer. Carpet stairs, carpet
 * tile stairs, and hard-surface plank stairs are the live questions.
 * Hide the dead gate once one of those is in play. Unanswered project_type
 * stays open (0142). Exclusive wall already hides stairs via TILE_WALL.
 * Do not SQL-gate stair_landings on carpet_stairs.
 */
export function jobHidesDeadStairGate(install: InstallContext): boolean {
  if (jobHasCarpetInstallScope(install)) return true;
  if (install.surfacePending) return true;
  return install.families.some(
    (f) => f === "lvp" || f === "hardwood" || f === "laminate" || f === "vinyl" || f === "tile",
  );
}

const FAMILY_STAIR_KEYS = ["carpet_stairs", "carpet_tile_stairs", "hs_plank_stairs"] as const;

function familyStairIsYes(valByKey: Record<string, string[]>): boolean {
  return FAMILY_STAIR_KEYS.some((k) =>
    (valByKey[k] ?? []).some((v) => /^yes$/i.test(v.trim())),
  );
}

/**
 * Leftover landings / open sides once the dead stairs yes/no is hidden.
 * Unanswered require on a hidden parent would keep them open forever.
 * Family-specific Yes still opens them (synthesizeStairGate copies onto
 * stairs). Leftover stairs=Yes without a family Yes does not — hidden
 * answers do not gate. Unanswered project_type stays open (0142).
 */
export function jobHidesDeadStairFollowups(
  install: InstallContext,
  valByKey: Record<string, string[]>,
): boolean {
  if (!jobHidesDeadStairGate(install)) return false;
  if (familyStairIsYes(valByKey)) return false;
  return true;
}

/**
 * 6-mil click-floor vapor on glue-down over a wood deck. You cannot glue to
 * 6-mil poly. Aqua bar hides separately via jobHidesAquaBarOnGlueWoodDeck.
 * Glue over concrete still asks. Mixed floating + glue over exclusive
 * plywood hides via jobHidesVaporOnWoodDeck. Unanswered substrate and
 * unanswered method stay open (0142).
 */
export function jobHidesVaporOnGlueWoodDeck(install: InstallContext): boolean {
  if (!labelsAreWoodDeckOnly(install.substrate)) return false;
  if (install.surfacePending || install.installPending) return false;
  if (install.systems.includes("floating")) return false;
  return install.systems.includes("glue");
}

/**
 * 6-mil click-floor vapor on exclusive plywood / OSB / wood. 6-mil is a
 * slab sheet — not a wood-deck underlayment. Exclusive floating, glue, and
 * mixed floating + glue over plywood all hide. Glue / floating over
 * concrete still ask. Mixed plywood + concrete stays open. Unanswered
 * substrate and unanswered method stay open (0142).
 */
export function jobHidesVaporOnWoodDeck(install: InstallContext): boolean {
  if (!labelsAreWoodDeckOnly(install.substrate)) return false;
  if (install.surfacePending || install.installPending) return false;
  return true;
}

/**
 * Aqua bar / primer on glue-down or carpet tile over a wood deck. Aqua bar
 * is a slab coating — not a wood-deck primer. Moisture test still asks
 * (wood MC). Glue over concrete still asks. Mixed plywood + concrete stays
 * open. A moisture-concern flag still asks. Unanswered substrate and
 * unanswered method stay open (0142). Mixed floating + glue over exclusive
 * plywood still hides Aqua bar — neither system coats a wood deck with it.
 */
export function jobHidesAquaBarOnGlueWoodDeck(install: InstallContext): boolean {
  if (!labelsAreWoodDeckOnly(install.substrate)) return false;
  if (install.surfacePending || install.installPending) return false;
  if (install.subfloorCondition.some((l) => /moisture concerns/i.test(l))) return false;
  return install.systems.includes("glue") || install.systems.includes("carpet_tile");
}

/**
 * 6-mil click-floor vapor on glue-down over existing flooring. You glue to
 * the existing floor or tear it out — not to 6-mil poly. Aqua bar hides
 * separately via jobHidesAquaBarOnGlueExistingFloor. Glue over concrete
 * still asks. Mixed floating + glue over exclusive existing flooring hides
 * via jobHidesVaporOnExistingFloor. Unanswered substrate and unanswered
 * method stay open (0142).
 */
export function jobHidesVaporOnGlueExistingFloor(install: InstallContext): boolean {
  if (!labelsAreExistingFlooringOnly(install.substrate)) return false;
  if (install.surfacePending || install.installPending) return false;
  if (install.systems.includes("floating")) return false;
  return install.systems.includes("glue");
}

/**
 * 6-mil click-floor vapor on exclusive Existing flooring. 6-mil is a slab
 * sheet — not an existing-floor underlayment. Exclusive floating, glue,
 * and mixed floating + glue over existing flooring all hide. Glue /
 * floating over concrete still ask. Mixed existing + concrete stays open.
 * Unanswered substrate and unanswered method stay open (0142).
 */
export function jobHidesVaporOnExistingFloor(install: InstallContext): boolean {
  if (!labelsAreExistingFlooringOnly(install.substrate)) return false;
  if (install.surfacePending || install.installPending) return false;
  return true;
}

/**
 * Aqua bar / primer on glue-down or carpet tile over existing flooring.
 * Aqua bar is a slab coating — not an existing-floor primer. Moisture
 * test still asks (unknown what's under). Glue over concrete still asks.
 * Mixed existing + concrete stays open. A moisture-concern flag still
 * asks. Unanswered substrate and unanswered method stay open (0142).
 * Mixed floating + glue over exclusive existing flooring still hides
 * Aqua bar — neither system coats existing flooring with it.
 */
export function jobHidesAquaBarOnGlueExistingFloor(install: InstallContext): boolean {
  if (!labelsAreExistingFlooringOnly(install.substrate)) return false;
  if (install.surfacePending || install.installPending) return false;
  if (install.subfloorCondition.some((l) => /moisture concerns/i.test(l))) return false;
  return install.systems.includes("glue") || install.systems.includes("carpet_tile");
}

/**
 * Aqua bar / primer on exclusive Existing flooring. Aqua bar is a slab
 * coating — not an existing-floor primer. Exclusive glue / carpet tile
 * already hid via jobHidesAquaBarOnGlueExistingFloor. Exclusive hardwood
 * nail / staple / floating over existing flooring also hides — same slab
 * coating, not a wood-MC or leftover-floor primer. Moisture test still
 * asks (unknown what's under). Glue over concrete still asks. Mixed
 * existing + concrete stays open. A moisture-concern flag still asks.
 * Unanswered substrate and unanswered method stay open (0142).
 */
export function jobHidesAquaBarOnExistingFloor(install: InstallContext): boolean {
  if (!labelsAreExistingFlooringOnly(install.substrate)) return false;
  if (install.surfacePending || install.installPending) return false;
  if (install.subfloorCondition.some((l) => /moisture concerns/i.test(l))) return false;
  return true;
}

/**
 * 6-mil click-floor vapor on exclusive loose-lay. Loose-lay is not a
 * click-floor sheet and not glue-down — including over concrete. Mixed
 * floating + loose-lay stays open. Mixed glue + loose-lay stays open.
 * Mixed Carpet + LVP loose-lay stays open so stretch / glue over concrete
 * still asks a moisture barrier under pad. Leftover Loose-lay on exclusive
 * carpet does not hide. Leftover Loose-lay on laminate / vinyl / tile
 * coalesces away from loose-lay. Leftover Loose-lay on hardwood is not
 * LVP and does not hide (0142). Unanswered LVP stays open.
 */
export function jobHidesVaporOnLooseLay(install: InstallContext): boolean {
  if (install.surfacePending || install.installPending) return false;
  if (!install.systems.includes("loose_lay")) return false;
  if (install.systems.some((s) => s !== "loose_lay")) return false;
  if (jobHasCarpetInstallScope(install)) return false;
  if (!install.families.includes("lvp")) return false;
  if (install.families.some((f) => f !== "lvp" && isHardSurfaceFamily(f))) return false;
  return true;
}

function demoLabelIsSheetVinyl(label: string): boolean {
  const t = label.trim();
  if (!t) return false;
  if (/sheet vinyl/i.test(t)) return true;
  if (/lvp\s*\/\s*vinyl/i.test(t)) return true;
  return false;
}

function demoLabelKeepsVinylSkimOpen(label: string): boolean {
  const t = label.trim();
  if (!t) return false;
  if (/^(none|other)$/i.test(t)) return true;
  if (/unknown|field verify|tbd/i.test(t)) return true;
  return demoLabelIsSheetVinyl(t);
}

/**
 * Existing-vinyl skim on exclusive non-vinyl tear-out. Carpet / LVP /
 * laminate / hardwood / ceramic / luan demo is not embossed vinyl. None
 * stays open — encapsulating existing vinyl has no tear-out chip. Other
 * and Unknown stay open. Sheet vinyl demo still asks. Mixed Carpet +
 * Sheet vinyl stays open. Unanswered stays open (0142).
 */
export function jobHidesVinylSkimOnNonVinylDemo(install: InstallContext): boolean {
  const have = install.existingFlooring.map((l) => l.trim()).filter(Boolean);
  if (!have.length) return false;
  if (have.some(demoLabelKeepsVinylSkimOpen)) return false;
  return true;
}

/**
 * Nail / staple fasteners on exclusive non-hardwood hard surface. Exclusive
 * LVP / laminate / vinyl / tile do not use hardwood fasteners — leftover
 * Nail-down on LVP does not reopen them. Mixed LVP + hardwood still asks.
 * Unanswered hard surface stays open (0142). Exclusive carpet does not
 * hide here — install_method is already hidden on carpet-only jobs.
 */
export function jobHidesFastenersOnNonHardwood(install: InstallContext): boolean {
  if (install.surfacePending) return false;
  if (install.families.includes("hardwood")) return false;
  if (!install.families.some(isHardSurfaceFamily)) return false;
  return true;
}

function demoLabelIsCarpet(label: string): boolean {
  const t = label.trim();
  if (!t) return false;
  return /^carpet$/i.test(t);
}

function demoLabelKeepsPadOpen(label: string): boolean {
  const t = label.trim();
  if (!t) return false;
  if (/^(none|other)$/i.test(t)) return true;
  if (/unknown|field verify|tbd/i.test(t)) return true;
  return demoLabelIsCarpet(t);
}

/**
 * Existing pad / tack on exclusive non-carpet tear-out. LVP / laminate /
 * hardwood / ceramic / luan / sheet vinyl demo is not old carpet. Installing
 * new carpet still asked these because families carpet kept the overlay
 * open. Carpet demo still asks. Mixed Carpet + LVP still asks. None / Other
 * / Unknown stay open. Unanswered stays open (0142).
 */
export function jobHidesPadOnNonCarpetDemo(install: InstallContext): boolean {
  const have = install.existingFlooring.map((l) => l.trim()).filter(Boolean);
  if (!have.length) return false;
  if (have.some(demoLabelKeepsPadOpen)) return false;
  return true;
}

function demoLabelIsNone(label: string): boolean {
  return /^none$/i.test(label.trim());
}

/**
 * Haul-away / dumpster / curb and bulk pickup on exclusive None demo.
 * Nothing is coming up, so there is nothing to dispose. Carpet / LVP /
 * ceramic demo still asks. Mixed None + Carpet stays open. Other /
 * Unknown stay open. Unanswered stays open (0142).
 */
export function jobHidesDisposalOnNoDemo(install: InstallContext): boolean {
  const have = install.existingFlooring.map((l) => l.trim()).filter(Boolean);
  if (!have.length) return false;
  return have.every(demoLabelIsNone);
}

/**
 * Slab moisture test / Aqua bar on a wood deck. Glue-down, carpet tile, a
 * moisture-concern flag, mixed LVP, unanswered method, and unanswered
 * substrate stay open. Exclusive hardwood nail/staple/floating over
 * plywood hides — 0190 is glue-down or wood over concrete, not a wood
 * deck and not floating click.
 */
export function jobHidesSlabMoistureOnWoodDeck(install: InstallContext): boolean {
  if (!labelsAreWoodDeckOnly(install.substrate)) return false;
  if (install.surfacePending || install.installPending) return false;
  if (install.systems.includes("glue") || install.systems.includes("carpet_tile")) return false;
  if (install.subfloorCondition.some((l) => /moisture concerns/i.test(l))) return false;
  if (!install.families.includes("hardwood")) return false;
  if (install.families.some((f) => f === "lvp" || f === "laminate" || f === "vinyl" || f === "tile" || f === "carpet")) {
    return false;
  }
  return true;
}

/**
 * Exclusive tile — surface is Tile, no carpet / LVP / hardwood / laminate /
 * sheet vinyl also on the job. Floor and wall both hide 6-mil vapor barrier.
 * Unanswered HS stays open (0142). Mixed LVP + tile stays open.
 */
export function jobIsExclusiveTile(install: InstallContext): boolean {
  return (
    install.families.includes("tile") &&
    !install.surfacePending &&
    !jobHasNonTileFloorFamily(install)
  );
}

/**
 * Exclusive wall tile — exclusive tile whose application is Wall
 * (not Floor / Both / Unknown / unanswered). Showers still keep wet area,
 * appliances, prep, and setting materials.
 */
export function jobIsExclusiveWallTile(install: InstallContext): boolean {
  return jobIsExclusiveTile(install) && labelsAreWallOnly(install.tileApplication);
}

/**
 * Exclusive carpet tile — every answered carpet-install system is carpet_tile.
 * Same evidence as rollGoodsNeedCuts: unanswered stays optimistic (layout
 * questions remain). Stretch-in or glue mixed with tile still asks pattern
 * match. Mixed LVP + exclusive tile hides it — LVP is not a carpet roll.
 */
export function jobIsExclusiveCarpetTile(install: InstallContext): boolean {
  if (!jobHasCarpetInstallScope(install)) return false;
  return !rollGoodsNeedCuts(
    "carpet",
    carpetInstallSystemsFromLabels(install.answeredCarpetInstall),
  );
}

/**
 * Exclusive carpet tile with no click/glue hard-surface family also on
 * the job. 6-mil vapor barrier hides — modular tile uses adhesive, not a
 * floating-floor sheet. Mixed LVP / laminate / hardwood / sheet vinyl still
 * asks. Unanswered HS stays open (0142). Mixed stretch-in or glue-down
 * carpet is not exclusive tile (cuts remain). Mixed floor tile + carpet
 * tile hides — neither wants 6-mil (membranes stay on tile_setting).
 */
export function jobIsExclusiveCarpetTileOnly(install: InstallContext): boolean {
  if (!jobIsExclusiveCarpetTile(install)) return false;
  if (install.surfacePending) return false;
  if (install.families.some((f) => f === "lvp" || f === "laminate" || f === "hardwood" || f === "vinyl")) {
    return false;
  }
  if (install.systems.includes("floating") || install.systems.includes("glue")) {
    return false;
  }
  return true;
}

/**
 * Exclusive solid hardwood — surface is Hardwood (solid), no engineered label,
 * and no LVP/laminate also on the job (those still need attached pad).
 * Floating follow-ups hide even before a method is picked. Mixed Hardwood +
 * Engineered hardwood stays open. Unanswered HS stays open (0142).
 */
export function jobIsExclusiveSolidHardwood(install: InstallContext): boolean {
  if (install.hardwoodConstruction !== "solid") return false;
  if (install.surfaceLabels.some((s) => /engineered/i.test(s))) return false;
  if (install.families.some((f) => f === "lvp" || f === "laminate")) return false;
  return install.families.includes("hardwood");
}

/**
 * Choice chips the salesperson should not see (or emit) in this context.
 * Exclusive wall tile keeps Floor prep as a question — patch/skim still
 * applies in a shower — but Self-leveling / grinding are floor pours.
 */
export function choiceOptionApplies(
  q: { key?: string | null },
  optionLabel: string,
  install: InstallContext,
): boolean {
  if (q.key === "hs_prep" && jobIsExclusiveWallTile(install) && tileWallHidesPrepOptionLabel(optionLabel)) {
    return false;
  }
  if (q.key === "hs_demo" && jobIsExclusiveWallTile(install) && tileWallHidesDemoOptionLabel(optionLabel)) {
    return false;
  }
  if (
    q.key === "vapor_barrier" &&
    vaporBarrierHidesUnderlaymentOptionLabel(optionLabel) &&
    !jobAllowsFloatingVaporUnderlayment(install)
  ) {
    return false;
  }
  return true;
}

/**
 * "Included with underlayment" is a floating-floor vapor sheet. Hide it once
 * we know the job is not floating. Exclusive solid hardwood hides it even
 * before a method is picked — floating is not permitted. Unanswered LVP /
 * engineered stay open (0142).
 */
export function jobAllowsFloatingVaporUnderlayment(install: InstallContext): boolean {
  if (jobIsExclusiveSolidHardwood(install)) return false;
  if (install.installPending || install.systems.length === 0) return true;
  return install.systems.includes("floating");
}

/**
 * Keys the overlay would show for this answer set (no SQL show_if). Proves
 * family/system branching without a live estimate_questions table.
 */
export function visibleKnowledgeKeys(valByKey: Record<string, string[]>): string[] {
  const keys = synthesizeSoleInstallMethod(synthesizeStairGate(valByKey));
  const ctx = installContextFromValByKey(keys);
  return KNOWLEDGE_QUESTIONS.filter((def) =>
    questionApplies({ key: def.key, config: {} }, keys, ctx),
  ).map((def) => def.key);
}

/**
 * Same visibility loop the Guided Estimate walks: start optimistic, then
 * hide by show_if + overlay. Hidden answers do not gate later questions.
 */
export function resolveQuestionVisibility<
  T extends {
    id: string;
    key?: string | null;
    config?: { show_if?: ShowIfClause | null; knowledge_when?: KnowledgeWhen | null };
  },
>(questions: T[], valsFor: (q: T) => string[]): Record<string, boolean> {
  const vis: Record<string, boolean> = {};
  for (const q of questions) vis[q.id] = true;
  for (let iter = 0; iter <= questions.length; iter++) {
    let valByKey: Record<string, string[]> = {};
    for (const q of questions) if (vis[q.id] && q.key) valByKey[q.key] = valsFor(q);
    valByKey = synthesizeStairGate(valByKey);
    valByKey = synthesizeSoleInstallMethod(valByKey);
    let changed = false;
    for (const q of questions) {
      const show = questionApplies(q, valByKey);
      if (vis[q.id] !== show) {
        vis[q.id] = show;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return vis;
}

export function questionPurpose(q: {
  key?: string | null;
  config?: { knowledge_when?: KnowledgeWhen | null; purpose?: QuestionPurpose | null };
}): QuestionPurpose | null {
  if (q.config?.purpose) return q.config.purpose;
  const when = questionKnowledgeWhen(q);
  return when?.purpose ?? null;
}

/** Extra help under a question — experienced estimator sitting beside you. */
export function knowledgeHelpFor(
  q: { key?: string | null; kind?: string; config?: { category?: string; trim_list?: boolean } },
  ctx: InstallContext,
): string | null {
  const key = q.key ?? "";
  if (key === "surface_type") {
    return "LVP, hardwood, laminate, tile, or sheet vinyl. Exclusive carpet hides this — stretch-in / glue-down / carpet tile stay on Carpet install. Mixed Carpet + LVP still asks. Unanswered hard surface stays open. Leftover Hardwood chips do not reopen finish, fasteners, vapor, or Install method on a carpet-only job.";
  }
  if (key === "install_method") {
    if (jobIsExclusiveCarpetOnly(ctx)) {
      return "Carpet install is stretch-in / glue-down / carpet tile. Exclusive carpet hides this hard-surface method picker. Mixed Carpet + LVP still asks. Unanswered hard surface stays open. Leftover Floating / Glue-down chips do not reopen it.";
    }
    if (jobIsExclusiveTile(ctx)) {
      return "Tile sets in thinset/mortar. Exclusive tile hides this hard-surface method picker — thinset stays on Tile setting. Mixed LVP + tile still asks. Unanswered hard surface stays open. Leftover Floating / click does not reopen it.";
    }
    const hs = ctx.families.filter(isHardSurfaceFamily);
    if (hs.length >= 2) {
      return `This job has ${hs.map(familyLabel).join(" + ")}. Pick every install method in play — adhesive, pad, and fastener follow-ups follow those picks. One chip still hides the other branch. Do not invent a per-room editor here.`;
    }
    if (ctx.families.includes("laminate"))
      return "Laminate is a floating floor. Leftover Glue-down from a previous surface does not open adhesive follow-ups — expansion and attached pad still ask. Mixed LVP + laminate still asks both branches.";
    if (ctx.families.includes("vinyl"))
      return "Sheet vinyl is roll goods — glue-down is the usual system. Leftover Floating / click does not hide adhesive or open expansion. Layout and seams, not carton math.";
    if (ctx.families.includes("tile"))
      return "Tile sets in thinset/mortar. Exclusive tile hides this hard-surface method picker — thinset stays on Tile setting. Mixed LVP + tile still asks. Leftover Floating / click does not open attached pad, underlayment, or expansion. Floating-floor accessories do not apply.";
    if (ctx.families.includes("hardwood")) {
      return ctx.hardwoodConstruction === "engineered"
        ? "Engineered hardwood may allow nail, staple, glue, or floating — confirm the product permits the method you pick."
        : "Solid hardwood is typically nail, staple, or glue. Floating follow-ups (attached pad, underlayment, expansion) stay off unless the surface is engineered. Leftover Floating does not hide fasteners or adhesive — those stay on like unanswered method. Confirm the product before using a leftover Floating chip.";
    }
    if (ctx.families.includes("lvp")) {
      if (ctx.systems.includes("loose_lay"))
        return "Loose-lay is not glue-down and not a floating click floor — adhesive and attached-pad questions stay off. Confirm the product permits it on this substrate.";
      return "Floating/click, glue-down, and loose-lay ask different follow-ups. Pick the system this product actually uses.";
    }
  }
  if (key === "carpet_install") {
    return "Stretch-in over pad is the residential default. Glue-down is still roll goods (cuts are the order). Carpet tile is modular — measured area plus waste, carton only if the product has coverage. Exclusive carpet tile hides pattern match, pattern repeat, and seam/direction notes — those are a roll cut plan, not modular layout. Mixed stretch-in + tile still asks them. Exclusive carpet tile also hides gripper/flat metals — binder bars for roll goods, not modular tile. Stretch-in and glue-down keep metals. Mixed stretch-in + tile still asks metals. Mixed LVP + exclusive carpet tile uses LVP transitions, not gripper bars. Exclusive carpet tile also hides the 6-mil vapor-barrier question — modular tile uses adhesive, not a floating-floor sheet. Acclimation, moisture test, and Aqua bar still ask. Mixed LVP or hardwood + carpet tile still asks vapor barrier. Leftover Floating / Glue-down on a carpet-only job is a hard-surface chip — it does not open expansion, underlayment, or click-floor vapor. Exclusive carpet also hides the hard-surface Install method picker and Surface type. Leftover Hardwood on Surface type does not reopen finish, fasteners, or vapor. Leftover Glue-down / Carpet tile on exclusive LVP is a carpet chip — it does not open adhesive, moisture test, or acclimation. Mixed Carpet + LVP still unions Carpet install. Do not invent a box size.";
  }
  if (key === "prep_confidence") {
    return "If you cannot see the substrate until demo, leave this as Field verify / TBD rather than guessing a bag count.";
  }
  if (q.config?.trim_list) {
    return "Quarter round, shoe, and base are linear feet; stair noses, T-molds, and reducers are EACH — never square feet. Pick a catalog item or type a rate. Clicking a chip does not invent $1/lnft or $45/nose. Linear feet convert to sticks only when the product has a piece length — we do not invent 94\".";
  }
  if (q.kind === "areas") {
    return "Enter rooms in feet and inches. Add a section for closets and offsets. This is MEASURED area — order quantity is calculated next from the product and (for carpet) the cuts. Leftover sq ft on a sq-yd line is not a billing unit and must not 9× a catalog SY rate.";
  }
  if (q.kind === "floor_map") {
    return "Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft. A boxed LVP / hardwood SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover em-dash parenthetical How many — those stay in stored job_description so the crew still sees pad rolls and room sizes. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover leading count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover leading dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover trailing dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover trailing count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Catalog box rate onto an area line is $/coverage, not 1:1 — wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile catalog box rate onto that area line is $/coverage, not 1:1 — mixed stretch-in + tile still waits for cuts. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile Builder boxed rate onto that area line is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay How many. Wrap / count How many stays 1:1. Do not invent coverage. AI notes exclusive carpet-tile catalog box rate onto that area line is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not infer exclusive tile from unit=box. Exclusive carpet-tile PO / warehouse / work-order carton math from sq ft ÷ coverage — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Exclusive carpet-tile PO boxed rate onto that area line is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface PO boxed rate onto that area line is $/coverage, not 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile catalog picker boxed rate onto sq yd is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface catalog picker boxed rate onto sq ft is $/coverage, not 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Hard-surface catalog picker swap boxed rate onto sq ft is $/coverage, not 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile catalog picker swap boxed rate onto sq yd is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface catalog picker cost line boxed rate onto sq ft is $/coverage, not 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile catalog picker cost line boxed rate onto sq yd is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Exclusive carpet-tile PO carton helper boxed rate onto $/carton is sq ft coverage, not sq yd × coverage 1:1. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface catalog picker clearance badge boxed rate onto sq ft is $/coverage, not 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile catalog picker clearance badge boxed rate onto sq yd is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Exclusive carpet-tile PO print carton helper boxed rate onto $/carton is sq ft coverage, not sq yd × coverage 1:1. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Exclusive carpet-tile estimate order boxed rate onto sq yd is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface estimate order boxed rate onto sq ft is $/coverage, not 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile catalog picker cost line boxed rate onto sq yd shows /sq yd, not native /box 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface catalog picker cost line boxed rate onto sq ft shows /sq ft, not native /box 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile job purchasing boxed rate onto sq yd is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job purchasing boxed rate onto sq ft is $/coverage, not 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile warehouse queue carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse queue carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job scope carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job scope carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile estimate order carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface estimate order carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job materials carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job materials carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile work-order editor carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface work-order editor carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage.";
  }
  if (q.kind === "cuts") {
    if (q.config?.category === "vinyl") {
      return "Sheet vinyl is roll goods. These cuts are the order quantity — converting room square feet into yards is not a layout and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. Width starts empty unless the catalog has roll_width_ft. 6'/12' chips are one tap — we do not plant 6'.";
    }
    if (!rollGoodsNeedCuts("carpet", carpetInstallSystemsFromLabels(ctx.answeredCarpetInstall))) {
      return "Carpet tile is modular. Pick the product here; order is measured area plus waste. Carton count only if the product has coverage — we do not invent a box size. This is not a roll cut plan. Builder shows measured coverage and carton math, not Cuts vs Roll. A carpet-tile SKU sold by the carton with coverage still takeoffs from measured area — not How many boxes from leftover taped sq ft. Missing coverage stays TBD; do not invent a box size. Review does not print taped square feet as the order when carton coverage is missing. Builder carton-coverage TBD is How many / Unit TBD, never taped square feet. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a boxed SKU with coverage still takeoffs from measured area — catalog unit box is not How many boxes. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover em-dash parenthetical How many — those stay in stored job_description so the crew still sees pad rolls and room sizes. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover leading count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover leading dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover trailing dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover trailing count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Catalog box rate onto an area line is $/coverage, not 1:1 — wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile catalog box rate onto that area line is $/coverage, not 1:1 — mixed stretch-in + tile still waits for cuts. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile Builder boxed rate onto that area line is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay How many. Wrap / count How many stays 1:1. Do not invent coverage. AI notes exclusive carpet-tile catalog box rate onto that area line is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not infer exclusive tile from unit=box. Exclusive carpet-tile PO / warehouse / work-order carton math from sq ft ÷ coverage — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Exclusive carpet-tile PO boxed rate onto that area line is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface PO boxed rate onto that area line is $/coverage, not 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile catalog picker boxed rate onto sq yd is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface catalog picker boxed rate onto sq ft is $/coverage, not 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Hard-surface catalog picker swap boxed rate onto sq ft is $/coverage, not 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile catalog picker swap boxed rate onto sq yd is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface catalog picker cost line boxed rate onto sq ft is $/coverage, not 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile catalog picker cost line boxed rate onto sq yd is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Exclusive carpet-tile PO carton helper boxed rate onto $/carton is sq ft coverage, not sq yd × coverage 1:1. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface catalog picker clearance badge boxed rate onto sq ft is $/coverage, not 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile catalog picker clearance badge boxed rate onto sq yd is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Exclusive carpet-tile PO print carton helper boxed rate onto $/carton is sq ft coverage, not sq yd × coverage 1:1. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Exclusive carpet-tile estimate order boxed rate onto sq yd is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface estimate order boxed rate onto sq ft is $/coverage, not 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile catalog picker cost line boxed rate onto sq yd shows /sq yd, not native /box 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface catalog picker cost line boxed rate onto sq ft shows /sq ft, not native /box 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile job purchasing boxed rate onto sq yd is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job purchasing boxed rate onto sq ft is $/coverage, not 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile warehouse queue carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse queue carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job scope carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job scope carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile estimate order carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface estimate order carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job materials carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job materials carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile work-order editor carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface work-order editor carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage.";
    }
    return "Cuts are the order quantity. Converting room square feet into yards is not a cut plan and is not billed as an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. The cuts step totals Order TBD when width is empty — 0 sq yd is not an order. Width starts empty unless the catalog has roll_width_ft. 12'/15' chips are one tap — we do not plant 12'. Carpet tile hides the cut list and uses measured area instead. Install labor uses this question's Settings $/sq yd — it does not invent $6.";
  }
  if (key === "tile_layout") {
    return "Straight vs diagonal changes waste and labor. Capture it; do not auto-inflate waste without the salesperson.";
  }
  if (key === "hardwood_fasteners") {
    return "Nail/staple jobs need fasteners. Pick the catalog item in Builder — this question only records the need. Exclusive LVP / laminate / vinyl / tile hide this — leftover Nail-down on LVP does not reopen it. Leftover Floating on exclusive solid hardwood does not hide this — leftover illegal chips do not switch overlay follow-ups. Mixed LVP + hardwood still asks when Nail-down is in play. Unanswered hard surface stays open.";
  }
  if (key === "hardwood_finish") {
    return "Prefinished vs unfinished (site finish) changes sanding, finishing, and acclimation notes. Floor King has no sand/finish labor in the catalog — capture it as scope. Field verify if the SKU is not in front of you. Do not invent a sand-and-finish dollar amount.";
  }
  if (key === "hs_demo") {
    return "What's coming up. Exclusive wall tile hides floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) — those are not a backsplash. Ceramic with/without mortar, None, and Other stay. Mixed LVP + wall still shows floor demo. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out hides existing-vinyl skim — that demo is not embossed vinyl. None still asks skim when installing sheet vinyl. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides existing pad and tack — that demo is not old carpet. Carpet demo still asks pad and tack. Mixed Carpet + LVP still asks. Exclusive None hides haul-away and bulk pickup — nothing is coming up. Other / Unknown still ask disposal. Exclusive New construction hides this. Mixed Replacement + New construction still asks. Unanswered stays open. Do not invent a second tear-out rate.";
  }
  if (key === "existing_bond") {
    return "Glued-down LVP/laminate/vinyl is a different tear-out than floating. Scope note — existing demo rates stay. Exclusive wall tile hides this — that is floor demo.";
  }
  if (key === "existing_pad") {
    return "Tearing out carpet — to carpet or to hard surface — usually takes the pad with it. Reuse only when the salesperson explicitly allows it. This follows the existing floor, not only a new-carpet job. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides this — that demo is not old carpet. None / Other / Unknown stay open. Mixed Carpet + LVP still asks. Unanswered stays open. Do not invent a second demo rate; the tear-out line gets a pad note.";
  }
  if (key === "existing_tack") {
    return "Tearing out carpet usually takes tack strip with it. Keep is unusual. This is not new stretch-in tack strip — that stays on the install step. Exclusive LVP / hardwood / ceramic / luan / sheet vinyl tear-out hides this with existing pad — that demo is not old carpet. None / Other / Unknown stay open. Mixed Carpet + LVP still asks. Unanswered stays open. Linear feet stay off until you add a catalog item. Do not invent a linear-foot price.";
  }
  if (key === "demo_disposal") {
    return "Haul away, dumpster, or placed at curb. Placed at curb opens bulk pickup day. Leftover Placed-on-the-curb yes-no stays off the overlay — demo_disposal is the source of truth. Exclusive New construction hides this. Mixed Replacement + New construction still asks. Exclusive None demo hides this — nothing is coming up, so there is nothing to haul. Other / Unknown still ask. Unanswered stays open. Do not invent a dumpster fee.";
  }
  if (key === "bulk_pickup") {
    return "Municipal bulk pickup day so the old floor is at the curb on time. Exclusive New construction hides this. Mixed Replacement + New construction still asks. Haul-away / dumpster hides this. Exclusive None demo hides this with haul-away — nothing is coming up. Unanswered disposal stays open in overlay. Leftover Placed-on-the-curb yes-no is not this question — Placed at curb on demo_disposal is. Do not invent a disposal charge here.";
  }
  if (key === "work_type") {
    return "Replacement asks what's coming up. Exclusive New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, bulk pickup day, toilet pull/reset, and furniture moving — substrate, prep, appliances, and door shaves still apply. Mixed Replacement + New construction still asks furniture, demo, pad removal, and toilets. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover em-dash parenthetical How many — those stay in stored job_description so the crew still sees pad rolls and room sizes. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover leading count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover leading dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover trailing dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover trailing count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Catalog box rate onto an area line is $/coverage, not 1:1 — wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile catalog box rate onto that area line is $/coverage, not 1:1 — mixed stretch-in + tile still waits for cuts. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile Builder boxed rate onto that area line is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay How many. Wrap / count How many stays 1:1. Do not invent coverage. AI notes exclusive carpet-tile catalog box rate onto that area line is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not infer exclusive tile from unit=box. Exclusive carpet-tile PO / warehouse / work-order carton math from sq ft ÷ coverage — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Exclusive carpet-tile PO boxed rate onto that area line is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface PO boxed rate onto that area line is $/coverage, not 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile catalog picker boxed rate onto sq yd is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface catalog picker boxed rate onto sq ft is $/coverage, not 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Hard-surface catalog picker swap boxed rate onto sq ft is $/coverage, not 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile catalog picker swap boxed rate onto sq yd is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface catalog picker cost line boxed rate onto sq ft is $/coverage, not 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile catalog picker cost line boxed rate onto sq yd is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Exclusive carpet-tile PO carton helper boxed rate onto $/carton is sq ft coverage, not sq yd × coverage 1:1. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface catalog picker clearance badge boxed rate onto sq ft is $/coverage, not 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile catalog picker clearance badge boxed rate onto sq yd is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Exclusive carpet-tile PO print carton helper boxed rate onto $/carton is sq ft coverage, not sq yd × coverage 1:1. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Exclusive carpet-tile estimate order boxed rate onto sq yd is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface estimate order boxed rate onto sq ft is $/coverage, not 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile catalog picker cost line boxed rate onto sq yd shows /sq yd, not native /box 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface catalog picker cost line boxed rate onto sq ft shows /sq ft, not native /box 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile job purchasing boxed rate onto sq yd is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job purchasing boxed rate onto sq ft is $/coverage, not 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile warehouse queue carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse queue carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job scope carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job scope carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile estimate order carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface estimate order carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job materials carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job materials carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile work-order editor carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface work-order editor carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage.";
  }
  if (key === "tack_strip") {
    return "Stretch-in needs tack strip. Glue-down and carpet tile do not. Capture keep vs replace — do not invent a linear-foot price unless a catalog item is added.";
  }
  if (key === "tack_strip_qty") {
    return "Linear feet of new tack strip — never square feet. Skip if you will measure on site. Field verify on the previous step does not invent a footage.";
  }
  if (key === "metals_needed") {
    return "Carpet-to-hard-surface doorways and edges. Yes opens the count (EACH) plus type/color. Exclusive carpet tile hides this — gripper and flat metals are binder bars for roll goods, not modular tile. Stretch-in and glue-down keep it. Mixed stretch-in + tile still asks. Unanswered stays open. Mixed LVP + exclusive carpet tile uses LVP transitions, not gripper bars. Leftover Yes on exclusive tile does not reopen qty/type/color. Do not invent a metal price here.";
  }
  if (key === "metals_qty") {
    return "Count of metals / transitions in EACH — never square feet. Exclusive carpet tile hides this with metals needed — modular tile is not a binder-bar count. Pick a catalog gripper or flat metal in Builder if Floor King sells it.";
  }
  if (key === "metal_type") {
    return "Gripper vs flat. Exclusive carpet tile hides this with metals needed. The count is the previous step — this does not add a second charge.";
  }
  if (key === "metal_color") {
    return "Silver / titanium / gold. Exclusive carpet tile hides this with metals needed. This does not invent a metal SKU.";
  }
  if (key === "crew_entry") {
    return "How the crew gets in (lockbox / homeowner / key). Upper floor, elevator, and long carry stay on Access conditions.";
  }
  if (key === "occupancy") {
    return "Occupied vs vacant. Vacant hides furniture moving — empty house, do not invent a furniture charge. Exclusive wall tile also hides it — a backsplash is not a furniture-moving job. Exclusive new construction also hides it — a new slab has no furniture to move. Occupied and Unknown still ask light/medium/heavy. Unanswered stays open.";
  }
  if (key === "wet_area") {
    return "Bath, laundry, or mudroom. Confirm the selected product is rated for a wet area. Catalog has no waterproof column — do not invent a SKU or a ban. Field verify if you have not seen the space.";
  }
  if (key === "access_conditions") {
    return "Upper floor, elevator, long carry, unusual access — scope/schedule notes unless a Floor King labor item is added in Builder.";
  }
  if (key === "climate_control") {
    return "AC and heat on site. The acclimation warning fires only for hardwood / glue-down / carpet tile, from this overlay — not a second questionnaire list. Stretch-in and floating still capture it as an install condition. Exclusive wall tile hides this — a backsplash is not a hardwood acclimation job. Mixed LVP or hardwood + wall still asks. Unanswered and Unknown stay open. Legacy AC/heat yes-no answers still count. Leftover AC available / Heat available questions stay off the overlay — climate_control is the source of truth.";
  }
  if (key === "laminate_expansion") {
    return "Floating floors need expansion at walls and transitions. Solid hardwood hides this — floating is not a permitted system. Exclusive laminate leftover Glue-down still asks this — laminate is floating. Exclusive tile leftover Floating hides this. Carpet-only leftover Floating hides this — click-floor expansion is not a stretch-in question. Record it as scope; add catalog reducers / T-molds / quarter round on the trim step rather than inventing a charge here.";
  }
  if (key === "attached_pad") {
    return "Floating LVP / laminate / engineered may have an attached pad. Solid hardwood hides this — floating is not a permitted system. Glue-down hides this. Exclusive laminate leftover Glue-down still asks this. Exclusive tile leftover Floating hides this. Yes hides separate underlayment.";
  }
  if (key === "hs_underlayment") {
    return "Separate underlayment for a floating floor. Attached pad Yes hides this. Solid hardwood hides this. Glue-down hides this. Exclusive laminate leftover Glue-down still asks this. Exclusive tile leftover Floating hides this. Quantity follows hard-surface rooms on a mixed job — carpet pad is the padding step, not this foam. Unkeyed extra underlayment on a mixed job stays 0 rather than cloning carpet sq ft. Billed in square feet unless the SKU itself is sold by the square yard. Catalog category underlayment is still pad yards — this question is foam. Review takeoff shows measured area vs billing square feet — not pad yards and not a 30-yard roll. Extra foam with no sold-by unit is TBD in Builder without typing measured sq ft — do not plant leftover sq ft. Review takeoff ignores leftover measured sq ft on a count or TBD extra — do not plant leftover sq ft as foam feet. A foam SKU sold by the roll / each / gal asks How many in that unit — not taped square feet and not a 30-yard roll. Typed How many rides onto Review as that count — leftover taped sq ft still is not pad yards and not a 30-yard roll. A main foam SKU sold by roll / each / gal does not convert room square feet into foam feet on Review. A main foam SKU sold by the roll / each / gal asks How many in that unit — room square feet is not foam feet and not a 30-yard roll. Do not invent a 30-yard roll.";
  }
  if (key === "selflevel_needed") {
    return "Bag count uses Settings coverage at the chosen pour. Pour is the shop default, else the coverage reference — we do not invent 1/4 inch. Field verify withholds bags. Review prints the bag count — taped square feet is not a bag order. Do not invent coverage.";
  }
  if (key === "tile_setting") {
    return "Thinset, grout, and backer come from the catalog in Builder. This records the need — bag counts stay TBD unless a product with coverage is actually picked. Taped square feet is not bags of thinset. Exclusive tile hides the hard-surface Install method picker — thinset is this question, not Floating / Glue-down / Nail-down. Exclusive tile hides the 6-mil vapor-barrier question; crack isolation / uncoupling membranes belong here, not on that floating-floor sheet.";
  }
  if (key === "vents_registers") {
    return "Count of vents/registers to change, in EACH. Never square feet. Pick a catalog vent on Trims if Floor King sells it; otherwise this is a crew note.";
  }
  if (key === "vapor_barrier") {
    return "Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed. Exclusive tile hides this — thinset is not a 6-mil click-floor vapor barrier. Membranes stay on Tile setting. Exclusive carpet tile hides this — modular tile uses adhesive, not a floating-floor sheet. Aqua bar stays on moisture mitigation except exclusive glue or carpet tile over plywood — Aqua bar is a slab system. Mixed LVP or hardwood + tile or carpet tile still asks. Leftover Floating on a carpet-only job does not reopen this. Exclusive glue-down over plywood hides this — you cannot glue to 6-mil poly. Exclusive plywood also hides this for floating and mixed floating + glue — 6-mil is a slab sheet, not a wood-deck underlayment. Exclusive glue-down over existing flooring hides this — you glue to the existing floor or tear it out, not to 6-mil poly. Exclusive existing flooring also hides this for floating and mixed floating + glue — 6-mil is a slab sheet, not an existing-floor underlayment. Exclusive loose-lay hides this — loose-lay is not a click-floor 6-mil sheet, including over concrete. Mixed floating + loose-lay still asks. Mixed Carpet + LVP loose-lay still asks. Leftover Loose-lay on exclusive carpet still asks over concrete. Leftover Loose-lay on laminate coalesces to floating and still asks over concrete. Unanswered LVP stays open. Glue over concrete still asks. Floating over concrete still asks. Mixed plywood + concrete still asks. Mixed existing + concrete still asks. Unanswered substrate stays open. Glue-down, carpet tile, nail-down, and stretch-in hide Included with underlayment — that is a floating-floor sheet, not an adhesive moisture system. Unanswered LVP and floating still offer it.";
  }
  if (key === "substrate") {
    return "If you cannot see the substrate until demo, pick Unknown / field verify rather than guessing plywood vs concrete. Exclusive Concrete hides 4×8 subfloor sheets — a slab is patch / self-level, not plywood overlay. Plywood / wood / existing flooring still ask.";
  }
  if (key === "subfloor_needed") {
    return "Yes emits 4×8 sheets only when Settings has sheet_sqft. Missing coverage is TBD — we do not invent 32 sq ft per sheet. Field verify withholds the count. Exclusive Concrete hides this — a slab is not a plywood overlay. Plywood / wood / existing flooring / Unknown still ask. Self-level stays on Floor prep. Review prints the sheet count — taped square feet is not a plywood order.";
  }
  if (key === "subfloor_condition") {
    return "Flat vs uneven vs cracks vs a height change. Exclusive wall tile hides this — that is floor work, not a backsplash. Mixed LVP + wall still asks. If demo hasn't happened, pick Unknown / field verify — do not invent a bag count.";
  }
  if (key === "prep_scope") {
    return "Same-for-the-job is faster. Set it by room when one room is a wet area or a different substrate — you'll fill prep on the rooms step.";
  }
  if (key === "furniture_heavy") {
    return "Pianos, pool tables, and loaded cabinets are scope/schedule notes unless this job already has a furniture-moving labor line. Vacant jobs hide this. Exclusive wall tile hides this too — a backsplash is not a furniture-moving job. Exclusive new construction hides this — a new slab has no furniture to move. Mixed Replacement + New construction still asks.";
  }
  if (key === "furniture_level") {
    return "Light / medium / heavy uses Floor King's furniture-moving labor. Vacant jobs hide this. Exclusive wall tile hides this too — a backsplash is not a furniture-moving job. Exclusive new construction hides this — a new slab has no furniture to move. Mixed Replacement + New construction still asks. Specialty items (piano, pool table) stay on the next question as scope.";
  }
  if (key === "carpet_pad") {
    return "Stretch-in over pad is the residential default. Glue-down and carpet tile hide this — they do not use residential pad. Quantity follows carpet rooms on a mixed job — laminate foam is the underlayment step, not this pad. Additional pad for a specific area is MEASURED sq ft — not a 30-yard roll and not the billing unit. Billed in square yards unless the SKU itself is sold by the square foot. A pad SKU with no sold-by unit is TBD in Builder (How many / Unit TBD) without typing measured sq ft — do not plant leftover sq ft. Review takeoff shows measured area vs billing yards — not a 30-yard roll. Review takeoff ignores leftover measured sq ft on a count or TBD extra — do not plant leftover sq ft as pad yards. A pad SKU sold by the roll / each / gal asks How many in that unit — not taped square feet and not a 30-yard roll. Typed How many rides onto Review as that count — leftover taped sq ft still is not pad yards and not a 30-yard roll. A main pad SKU sold by roll / each / gal does not convert room square feet into pad yards on Review. A main pad SKU sold by the roll / each / gal asks How many in that unit — room square feet is not pad yards and not a 30-yard roll. Do not invent a 30-yard foam roll.";
  }
  if (key === "toilets") {
    return "Count in EACH. Uses Floor King's pull & reset labor when you enter a number — do not type square feet. Exclusive New construction hides this — there is no toilet to pull. Mixed Replacement + New construction still asks. Appliances still ask.";
  }
  if (key === "appliances") {
    return "Count in EACH (fridge, stove, washer/dryer). Uses Floor King's disconnect/move labor when you enter a number.";
  }
  if (key === "doors_shave") {
    return "Count of doors to undercut, in EACH. Never square feet.";
  }
  if (key === "hs_prep") {
    return "None / patch / skim / self-level / grind. Exclusive wall tile hides Self-leveling and grinding chips — those pour or grind a floor. Patch / skim stays for showers. Mixed LVP + wall tile still shows the floor pours. Do not invent a bag count here; bags are the next step when Self-leveling is picked.";
  }
  if (key === "tile_application") {
    return "Floor vs wall. Exclusive wall tile hides toilets, vents, door shaves, floor stairs, construction grade, radiant heat, doorway T-molds, 4×8 subfloor sheets, self-leveler bags, slab vapor barrier, aqua-bar mitigation, slab moisture tests, floor subfloor condition (flat / uneven / cracks), stair landings, and open-side notes — those are floor work. Self-leveling and grinding chips on Floor prep hide too; patch / skim stays for showers. Floor demo chips (carpet / LVP / hardwood / sheet vinyl / luan) hide; ceramic mortar, None, and Other stay for wall-tile tear-out. Furniture moving hides too — a backsplash is not a furniture-moving job. Site AC/heat and acclimation hide too — a backsplash is not a hardwood acclimation job. Mixed carpet or LVP + wall tile still asks them. Unanswered and Unknown stay open. Keep wet area, appliances, floor prep, substrate, base trim, occupancy, delivery, access, and setting materials. Exclusive tile hides the hard-surface Install method picker — thinset stays on Tile setting. Exclusive floor tile also hides the 6-mil vapor-barrier question — thinset is not a click-floor vapor barrier; membranes stay on Tile setting. Mixed LVP or hardwood + tile still asks. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.";
  }
  if (key === "tile_body") {
    return "Ceramic vs porcelain vs natural stone. Still the tile catalog — capture the body for setting notes. Do not invent a waste percent or a second category.";
  }
  if (key === "tile_format") {
    return "Size / format is scope for waste and flatness. Large format often needs a flatter floor — Field verify if you have not seen it. Do not invent a waste percent.";
  }
  if (key === "radiant_heat") {
    return "Carpet pad and many hard-surface products have radiant limits. Yes fires the overlay purchasing warning — do not invent a radiant-rated SKU.";
  }
  if (key === "moisture_mitigation") {
    return "Aqua bar / primer only when hardwood, glue-down, carpet tile, or a moisture-concern flag makes it relevant. Floating laminate and stretch-in without that flag hide this. Exclusive carpet tile asks this instead of 6-mil vapor barrier except exclusive carpet tile over plywood — Aqua bar is a slab system. Exclusive hardwood nail/staple/floating over plywood hides this — Aqua bar is a slab system. Exclusive glue-down or carpet tile over plywood also hides this. Exclusive glue-down or carpet tile over existing flooring also hides this — Aqua bar is a slab coating, not an existing-floor primer. Exclusive hardwood nail/staple/floating over existing flooring also hides this. Moisture test still asks. Glue over concrete still asks. Mixed plywood + concrete still asks. Mixed existing + concrete still asks. A moisture-concern flag still asks. Unanswered substrate stays open. Existing catalog rates — do not invent a new product.";
  }
  if (key === "adhesive") {
    return "Glue-down and carpet tile need adhesive from the catalog. Stretch-in and floating hide this. Exclusive laminate leftover Glue-down does not show this — laminate is floating. Exclusive sheet vinyl leftover Floating still asks this — sheet vinyl is glue-down. Carpet-only leftover Glue-down does not show this — carpet glue is on Carpet install. Mixed LVP still asks. Quantity is gallons or kits in Builder — taped square feet is not a glue order. A line with no sold-by unit shows How many / Unit TBD, not Sq ft. A glue SKU sold by the gal / kit / each asks How many in that unit — taped square feet is not a glue order. Do not invent coverage.";
  }
  if (key === "vinyl_skim") {
    return "Embossed existing vinyl often needs a skim coat. Exclusive New construction hides this — there is no existing vinyl. Mixed Replacement + New construction still asks. Exclusive carpet / LVP / hardwood / ceramic / luan tear-out also hides this — that demo is not existing vinyl. None still asks — encapsulating existing vinyl has no tear-out chip. Other / Unknown stay open. Sheet vinyl demo still asks. Mixed Carpet + Sheet vinyl still asks. Unanswered stays open. If you cannot see it until demo, pick Field verify — do not invent a bag count here.";
  }
  if (key === "carpet_stairs") {
    return "Waterfall vs upholstered is stretch-in / glue-down wrap labor. Exclusive carpet tile hides this — modular tile on stairs is not a waterfall cut plan. Step count is EACH. We do not invent 6/8 sq ft of carpet per step as an order — include stairs in your cuts.";
  }
  if (key === "carpet_tile_stairs") {
    return "Carpet tile on stairs is not waterfall wrap. Capture whether stairs are in scope. Do not invent stair-nose or wrap labor — pick a catalog item in Builder if Floor King sells it.";
  }
  if (key === "carpet_tile_stair_count") {
    return "Count of carpet-tile steps in EACH — never square feet. Notes for the crew. Field verify if you have not seen them.";
  }
  if (key === "hs_plank_stairs") {
    return "Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one. A wrap SKU sold by the box / each / roll asks How many in that unit — not 8 sq ft/step and not leftover taped square feet. Typed How many rides onto Review as that count. Area-unit wrap stays wrap qty TBD — do not convert steps × 8. Empty How many stays wrap qty TBD. Builder count SKU / qty TBD lines are How many / Unit TBD, never taped square feet. Picking a wrap SKU keeps How many — catalog coverage does not reopen 8 sq ft/step. PO / warehouse / work-order carton math from sq ft ÷ coverage does not apply to wrap / carton-coverage TBD / qty TBD How many — those are already the order, not taped square feet. Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD — leftover quantity is not measured area. Builder hydrate does not plant How many as taped sq ft on Unit TBD (empty unit) count lines — leftover quantity is not measured area. Customer / invoice / portal copy strips wrap / carton-coverage TBD / qty TBD / order TBD identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Pricing does not treat leftover planted sqft as measured area on Unit TBD (empty unit) count lines — leftover quantity is How many, not taped square feet. Customer / portal / print project details strip wrap / carton-coverage TBD / qty TBD / not-taped-sq-ft identity from Guided takeoff notes — those stamps stay in stored job_description so the crew still sees How many vs leftover taped sq ft. Customer / portal / print strip Guided takeoff MEASURED / WASTE / ORDER / BILLING math — those stay in stored job_description so the crew still sees measured vs order. Customer / portal / print strip Guided takeoff room MEASURED sq ft and crew Warnings — those stay in stored job_description so the crew still sees taped area vs order. Customer print / portal itemized line notes strip wrap / carton-coverage TBD / qty TBD / room MEASURED sq ft identity — those stamps stay on stored lines so Builder / PO / WO / hydrate still skip leftover taped sq ft. Customer / portal / print strip Guided takeoff crew Uncertainty — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Exclusive New construction hides tear-out — mixed Replacement + New construction still asks demo, pad removal, and toilets. Customer / portal / print strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print Site preparation strip Guided takeoff crew prep confidence — those stay in stored job_description so the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print line labels strip stair-install step How many — those stay on stored lines so Builder still prices per step. Customer / portal / print line labels strip prep estimated / allowance suffix — those stay on stored lines so the crew still sees Field verify / TBD vs Known bag counts. Customer print / portal itemized line notes strip leftover stair-install step How many and crew prep confidence — those stay on stored lines so Builder still prices per step and the crew still sees Field verify / TBD vs Known bag counts. Customer / portal / print strip Guided takeoff Review section headers — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff Review bucket prefixes — those stay in stored job_description so the crew still sees Removal / Prep / Accessories grouping. Product names, accessory How many, and job conditions stay. Customer / portal / print strip Guided takeoff stair-install step How many — those stay in stored job_description so Builder still prices per step. Wrap How many still stays. Customer / portal / print strip Guided takeoff waterfall / upholstered stair How many — those stay in stored job_description so Builder still prices wrap labor. Wrap How many still stays. Customer / portal / print strip Guided takeoff labeled count How many — those stay in stored job_description so the crew still sees toilets / trim / metals counts. Wrap How many and Self-leveler bag How many stay. Customer / portal / print line labels strip leftover em-dash How many — those stay on stored lines so Builder still prices How many. Wrap How many and Self-leveler bag How many stay in job notes. Customer / portal / print strip leftover unlabeled count How many and labeled inch / percent How many — those stay in stored job_description so the crew still sees pad rolls and pattern repeat. Wrap How many and Self-leveler bag How many stay. Customer / portal / print strip leftover dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print keep 12' product names — leftover dimension How many is a complete room / cut size, not a catalog name. Wrap How many and Self-leveler bag How many stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover parenthetical count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover em-dash parenthetical How many — those stay in stored job_description so the crew still sees pad rolls and room sizes. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover leading count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover leading dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover trailing dimension How many — those stay in stored job_description so the crew still sees room / cut sizes. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Customer / portal / print strip leftover trailing count How many — those stay in stored job_description so the crew still sees pad rolls. Wrap colon How many and Self-leveler bag How many stay. 12' product names stay. 5mm product names stay. Catalog box rate onto an area line is $/coverage, not 1:1 — wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile catalog box rate onto that area line is $/coverage, not 1:1 — mixed stretch-in + tile still waits for cuts. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile Builder boxed rate onto that area line is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay How many. Wrap / count How many stays 1:1. Do not invent coverage. AI notes exclusive carpet-tile catalog box rate onto that area line is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not infer exclusive tile from unit=box. Exclusive carpet-tile PO / warehouse / work-order carton math from sq ft ÷ coverage — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Exclusive carpet-tile PO boxed rate onto that area line is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface PO boxed rate onto that area line is $/coverage, not 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile catalog picker boxed rate onto sq yd is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface catalog picker boxed rate onto sq ft is $/coverage, not 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Hard-surface catalog picker swap boxed rate onto sq ft is $/coverage, not 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile catalog picker swap boxed rate onto sq yd is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface catalog picker cost line boxed rate onto sq ft is $/coverage, not 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile catalog picker cost line boxed rate onto sq yd is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Exclusive carpet-tile PO carton helper boxed rate onto $/carton is sq ft coverage, not sq yd × coverage 1:1. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface catalog picker clearance badge boxed rate onto sq ft is $/coverage, not 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile catalog picker clearance badge boxed rate onto sq yd is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Exclusive carpet-tile PO print carton helper boxed rate onto $/carton is sq ft coverage, not sq yd × coverage 1:1. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Exclusive carpet-tile estimate order boxed rate onto sq yd is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface estimate order boxed rate onto sq ft is $/coverage, not 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile catalog picker cost line boxed rate onto sq yd shows /sq yd, not native /box 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface catalog picker cost line boxed rate onto sq ft shows /sq ft, not native /box 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile job purchasing boxed rate onto sq yd is $/coverage, not 1:1 — mixed stretch-in + tile and unanswered carpet stay 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job purchasing boxed rate onto sq ft is $/coverage, not 1:1. Wrap / count How many stays 1:1. Do not invent coverage. Exclusive carpet-tile warehouse queue carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface warehouse queue carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job scope carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job scope carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile estimate order carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface estimate order carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile job materials carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface job materials carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. Exclusive carpet-tile work-order editor carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. Hard-surface work-order editor carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage.";
  }
  if (key === "hs_transitions") {
    return "Doorway transitions are EACH — T-mold, reducer, end cap, threshold, metal. Add matching catalog pieces on Trims. Do not invent a SKU here. Field verify is allowed.";
  }
  if (key === "hs_base_trim") {
    return "Base, quarter round, and shoe are linear feet — never square feet. Add footage on Trims. Keep existing or Field verify if demo has not happened.";
  }
  if (key === "pattern_match") {
    return "Pattern match and roll direction are for broadloom. Exclusive carpet tile hides this — modular tiles are not a seam plan. Stretch-in and glue-down keep it. Unanswered stays open. This does not generate a cut plan.";
  }
  if (key === "carpet_direction") {
    return "Where seams should fall and which way the roll runs. Exclusive carpet tile hides this — there is no roll. Glue-down broadloom still asks. For the cut list — not a generated plan.";
  }
  if (key === "pattern_repeat") {
    return "Inches of pattern repeat for purchasing and layout notes. Exclusive carpet tile hides this with pattern match. This does not generate a cut plan.";
  }
  if (key === "delivery_scope") {
    return "Floor King has a Delivery add-on. Record whether to include it — pick the catalog line in Builder rather than inventing a fuel charge here.";
  }
  if (key === "acclimation") {
    return "Hardwood, glue-down (including glue-down carpet), and carpet tile need acclimation / climate notes. Floating laminate and stretch-in hide this — do not invent a day count. Exclusive wall tile hides this — a backsplash is not a hardwood acclimation job. Mixed LVP or hardwood + wall still asks. Leftover Glue-down on exclusive wall does not reopen this.";
  }
  if (key === "construction_grade") {
    return "Above / on / below grade can change what a product and adhesive permit. Stretch-in over wood hides this. Glue-down carpet, carpet tile, and hard surface still ask. Confirm against the product — do not assume a ban.";
  }
  if (key === "moisture_test") {
    return "Glue-down, carpet tile, hardwood over concrete, or a moisture-concern flag on the substrate. If you cannot test yet, pick Field verify — do not invent a number. Answering No fires the overlay moisture-untested warning; unanswered does not. Exclusive wall tile hides this — a slab moisture test is floor work. Exclusive carpet tile asks this instead of 6-mil vapor barrier. Exclusive hardwood nail/staple/floating over plywood hides this — 0190 is glue-down or wood over concrete, not a wood deck. Glue-down over plywood still asks. Exclusive glue-down or carpet tile over plywood hides Aqua bar — it is a slab system. Exclusive hardwood nail/staple/floating over existing flooring also hides Aqua bar — it is a slab coating, not an existing-floor primer. Moisture test still asks. Mixed LVP still asks. Unanswered substrate stays open. Wet area still asks.";
  }
  if (key === "stair_landings") {
    return "Count of landings in EACH. Measured with the rooms when they are floored the same; this flags extra pieces and noses. Exclusive wall tile hides this — a backsplash is not a stair job. Leftover Stairs yes/no hides this once Carpet stairs, Carpet tile stairs, or hard-surface plank stairs are in play — landings still follow those Yes answers. Unanswered project_type stays open.";
  }
  if (key === "stair_open_sides") {
    return "Open sides change wrapped carpet ends and hard-surface nosing. Exclusive wall tile hides this. Leftover Stairs yes/no hides this once family-specific stairs are in play — open sides still follow those Yes answers. Capture the construction — pricing still uses existing stair labor.";
  }
  if (key === "stairs") {
    return "Stairs change material, labor, and trim. Exclusive wall tile hides this — a backsplash is not a stair job. Mixed carpet or LVP + wall still asks the family-specific stair questions. This leftover yes/no hides once Carpet stairs, Carpet tile stairs, or hard-surface plank stairs are in play — landings still follow those Yes answers. Leftover landings / open sides hide until a family stair question is Yes. Unanswered project_type stays open. Field verify if you have not seen them.";
  }
  if (key === "asbestos_risk") {
    return "Old ceramic or sheet vinyl can hide asbestos. Possible / confirmed is a crew warning — do not invent an abatement dollar amount here.";
  }
  if (key === "hs_direction") {
    return "Which way the planks run. Diagonal can need more waste — confirm with the salesperson; do not auto-inflate the percent.";
  }
  return null;
}

/**
 * Mixed jobs without a per-room assignment stay at 0 takeoff (0238).
 * This lists the flooring families that still need rooms, plus blank-room sq ft.
 */
export function mixedJobAssignmentGaps(args: {
  jobFamilies: FlooringFamily[];
  byFamily?: Partial<Record<FlooringFamily, number>>;
  measuredSqft: number;
  unassignedRoomSqft?: number;
}): { unassignedFamilies: FlooringFamily[]; unassignedRoomSqft: number } {
  const flooring = args.jobFamilies.filter((f) => f !== "other");
  if (!(args.measuredSqft > 0) || flooring.length < 2) {
    return { unassignedFamilies: [], unassignedRoomSqft: 0 };
  }
  const by = args.byFamily ?? {};
  const unassignedFamilies = flooring.filter((f) => {
    const n = by[f];
    return !(typeof n === "number" && n > 0);
  });
  const unassignedRoomSqft =
    typeof args.unassignedRoomSqft === "number" && args.unassignedRoomSqft > 0
      ? args.unassignedRoomSqft
      : 0;
  return { unassignedFamilies, unassignedRoomSqft };
}

export function knowledgeWarnings(ctx: InstallContext, extras?: {
  hasCuts?: boolean;
  hasVinylCuts?: boolean;
  measuredSqft?: number;
  /** Floor-map measured sq ft per family — empty on an unassigned mixed job. */
  byFamily?: Partial<Record<FlooringFamily, number>>;
  /** Rooms on the floor map with no flooring product. */
  unassignedRoomSqft?: number;
  pickedLabels?: string[];
  /** Hard-surface plank step count already entered. */
  hsStairSteps?: number;
  /** Trims already has a Stair nose row (each). */
  hasStairNose?: boolean;
  /** TRIM_TYPES labels implied by hs_transitions (T-mold, reducer, …). */
  neededTransitionTrims?: string[];
  /** TRIM_TYPES labels implied by hs_base_trim (quarter round, shoe, base). */
  neededBaseTrims?: string[];
  /** Types already present on the Trims step. */
  presentTrimTypes?: string[];
}): { id: string; text: string }[] {
  const w: { id: string; text: string }[] = [];
  const has = (arr: string[], re: RegExp) => arr.some((v) => re.test(v));
  const picked = extras?.pickedLabels ?? [];
  const newBuild = labelsAreNewConstructionOnly(ctx.workType);

  if (newBuild) {
    w.push({
      id: "new-construction",
      text: "Exclusive New construction — no tear-out. Demo, pad removal, existing-vinyl skim, asbestos, disposal, bulk pickup day, toilet pull/reset, and furniture moving stay off. Mixed Replacement + New construction still asks those. Substrate, prep, appliances, and door shaves still apply. Do not invent a demo charge.",
    });
  }
  const wet = picked.some(
    (l) => /^yes — bath/i.test(l.trim()) || /^some rooms$/i.test(l.trim()),
  );
  if (wet) {
    w.push({
      id: "wet-area",
      text: "Wet area (bath / laundry / mudroom) — confirm the selected product is rated for it. Catalog has no waterproof column. Do not invent a waterproof SKU or a ban.",
    });
    if (ctx.families.includes("hardwood")) {
      w.push({
        id: "wet-area-hardwood",
        text: "Hardwood in a wet area — confirm the product/manufacturer permits it. Do not assume a ban and do not invent a waterproof hardwood SKU.",
      });
    }
    if (ctx.families.includes("carpet")) {
      w.push({
        id: "wet-area-carpet",
        text: "Carpet in a wet area — typical residential carpet is not a wet-area floor. Confirm the product. Do not invent a waterproof SKU.",
      });
    }
  }

  if (ctx.radiantHeat.some((l) => /^yes$/i.test(l.trim()))) {
    w.push({
      id: "radiant",
      text: "Radiant heat present — confirm the selected flooring is rated for radiant heat before ordering.",
    });
  }
  if (installNeedsAcclimationClimate(ctx) && !climateControlConfirmed(ctx)) {
    w.push({
      id: "climate",
      text: "Hardwood / glue-down / carpet tile without confirmed AC and heat — acclimation & adhesion are at risk. Confirm climate control.",
    });
  }
  if (
    installNeedsAcclimationClimate(ctx) &&
    ctx.moistureTest.some((l) => /^no$/i.test(l.trim()))
  ) {
    w.push({
      id: "moisture-untested",
      text: "Glue-down / hardwood / carpet tile without a moisture test — record as field verify rather than assuming the slab is dry.",
    });
  }

  if (ctx.surfaceLabels.includes("LVP / Vinyl")) {
    w.push({
      id: "legacy-lvp-vinyl",
      text: "“LVP / Vinyl” is the old combined label. LVP/LVT (boxed) and sheet vinyl (roll goods) order differently — pick the matching surface if you can.",
    });
  }
  if (
    ctx.families.includes("hardwood") &&
    picked.some((l) => /^unfinished \(site finish\)$/i.test(l.trim()))
  ) {
    w.push({
      id: "hardwood-unfinished",
      text: "Unfinished hardwood needs site sanding and finishing. Floor King has no sand/finish labor in the catalog — capture it as a scope note, add a real catalog item in Builder if you sell it, or Field verify. Do not invent a dollar amount.",
    });
  }
  if (ctx.families.includes("hardwood") && ctx.hardwoodConstruction === "solid" && has(ctx.grade, /below/i)) {
    w.push({
      id: "solid-below-grade",
      text: "Solid hardwood below grade — confirm the product/manufacturer permits this. Do not assume it; field verify if unsure.",
    });
  }
  if (
    jobIsExclusiveSolidHardwood(ctx) &&
    ctx.answeredInstallMethod.some((l) => installSystemFromLabel(l) === "floating")
  ) {
    w.push({
      id: "solid-floating",
      text: "Solid hardwood is typically nail, staple, or glue. Floating is uncommon — confirm the product permits it. Do not assume a click floor or attached pad.",
    });
  }
  {
    const leftover = leftoverIllegalSoleInstallLabels(
      ctx.families,
      ctx.hardwoodConstruction,
      ctx.answeredInstallMethod,
    );
    const sole = solePermittedInstallSystem(ctx.families, ctx.hardwoodConstruction);
    if (leftover.length && sole) {
      const hs = ctx.families.find(isHardSurfaceFamily);
      w.push({
        id: "sole-system-leftover",
        text: `${hs ? familyLabel(hs) : "This product"} is ${INSTALL_METHOD_LABELS[sole]}. Leftover “${leftover.join(" / ")}” does not switch follow-ups — adhesive, pad, and expansion follow the legal system. Confirm the product, or clear the leftover chip.`,
      });
    }
  }
  if (
    ctx.families.includes("carpet") &&
    !jobHasHardSurfaceInstallScope(ctx) &&
    ctx.answeredInstallMethod.some((l) => installSystemFromLabel(l) !== "unknown")
  ) {
    const leftover = ctx.answeredInstallMethod.filter(
      (l) => installSystemFromLabel(l) !== "unknown",
    );
    w.push({
      id: "carpet-hs-leftover",
      text: `This job is carpet only. Leftover “${leftover.join(" / ")}” is a hard-surface method and does not switch pad, adhesive, expansion, or 6-mil vapor follow-ups. Stretch-in / glue-down / carpet tile stay on Carpet install.`,
    });
  }
  if (jobIsExclusiveCarpetOnly(ctx)) {
    const leftoverSurface = ctx.surfaceLabels.filter((s) => {
      const f = familyFromSurfaceLabel(s);
      return f != null && f !== "carpet";
    });
    if (leftoverSurface.length) {
      w.push({
        id: "carpet-surface-leftover",
        text: `This job is carpet only. Leftover “${leftoverSurface.join(" / ")}” is a hard-surface type and does not switch finish, fasteners, vapor, or Install method. LVP / hardwood / laminate / tile stay on Surface type when Hard surface is also in play.`,
      });
    }
  }
  if (
    !jobHasCarpetInstallScope(ctx) &&
    ctx.answeredCarpetInstall.some((l) => installSystemFromLabel(l) !== "unknown")
  ) {
    const leftover = ctx.answeredCarpetInstall.filter(
      (l) => installSystemFromLabel(l) !== "unknown",
    );
    w.push({
      id: "hs-carpet-leftover",
      text: `This job is hard surface only. Leftover “${leftover.join(" / ")}” is a carpet install and does not switch adhesive, moisture test, or acclimation. Stretch-in / glue-down / carpet tile stay on Carpet install when Carpet is also in play.`,
    });
  }
  if (
    ctx.families.includes("carpet") &&
    (ctx.systems.includes("glue") || ctx.systems.includes("carpet_tile")) &&
    has(ctx.grade, /below/i)
  ) {
    w.push({
      id: "carpet-glue-below-grade",
      text: "Glue-down / carpet tile below grade — confirm the adhesive and product permit it. Do not assume a ban; field verify if unsure.",
    });
  }
  if (
    ctx.hardwoodConstruction === "engineered" &&
    ctx.surfaceLabels.includes("Hardwood") &&
    !ctx.surfaceLabels.some((s) => /engineered/i.test(s))
  ) {
    w.push({
      id: "species-engineered",
      text: "Catalog species reads engineered while the surface pick is solid hardwood — install methods follow the product. Confirm before nailing or gluing.",
    });
  }
  if (
    ctx.families.includes("carpet") &&
    (extras?.measuredSqft ?? 0) > 0 &&
    extras?.hasCuts === false &&
    rollGoodsNeedCuts("carpet", carpetInstallSystemsFromLabels(ctx.answeredCarpetInstall))
  ) {
    w.push({
      id: "carpet-no-cuts",
      text: "Carpet measured by area only — converting sq ft ÷ 9 is equivalent area, not a cut plan. Enter cuts (roll width × length) before ordering.",
    });
  }
  if (ctx.families.includes("vinyl") && extras?.hasVinylCuts === false && (extras?.measuredSqft ?? 0) > 0) {
    w.push({
      id: "vinyl-no-layout",
      text: "Sheet vinyl is roll goods. Measured area is not automatically the order quantity — seams and roll width can require more.",
    });
  }
  if (ctx.surfaceLabels.includes("Tile") && picked.some((l) => /diagonal|herringbone|special/i.test(l))) {
    w.push({
      id: "tile-layout-waste",
      text: "Diagonal / special tile layout usually needs more waste than a straight lay. Confirm waste with the salesperson — do not invent a percent.",
    });
  }
  if (ctx.families.includes("tile") && picked.some((l) => l === "Wall" || l === "Both")) {
    w.push({
      id: "tile-wall",
      text: "Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor or trim.",
    });
  }
  if (picked.some((l) => /glued down/i.test(l))) {
    w.push({
      id: "existing-glued",
      text: "Existing floor is glued down — removal labor is not the same as floating click. Keep the demo line and flag it for the crew.",
    });
  }
  if (ctx.attachedPad === "yes" && ctx.systems.includes("glue")) {
    w.push({
      id: "pad-glue",
      text: "Attached pad on a glue-down system is unusual — confirm the product is actually glue-down or actually has an attached pad.",
    });
  }
  if (ctx.systems.includes("loose_lay")) {
    w.push({
      id: "loose-lay",
      text: "Loose-lay is its own system — not glue-down and not floating/click. Confirm the product and substrate; do not assume adhesive or underlayment.",
    });
  }
  if (!newBuild && ctx.existingFlooring.some((l) => /ceramic with mortar bed/i.test(l))) {
    w.push({
      id: "mortar",
      text: "Ceramic WITH mortar bed demo — expect a floor-height change. Check transitions and door clearance.",
    });
  }
  if (!newBuild && has(ctx.existingFlooring, /ceramic/i)) {
    w.push({
      id: "ceramic_substrate",
      text: "Tearing up ceramic tile — confirm what's under it (mortar bed, backer board, or other substrate) and include removing it in the demo.",
    });
    w.push({
      id: "ceramic_base",
      text: "Ceramic removal usually takes the base with it — plan for shoe molding or quarter round.",
    });
  }
  if (picked.some((l) => /possible — test|confirmed — abatement/i.test(l))) {
    w.push({
      id: "asbestos",
      text: "Possible or confirmed asbestos in existing vinyl/ceramic — test before demo. Do not invent an abatement price here.",
    });
  }
  if (picked.some((l) => /natural stone/i.test(l))) {
    w.push({
      id: "tile-stone",
      text: "Natural stone setting, sealing, and waste differ from ceramic. Pick catalog setting materials in Builder — do not invent a labor rate or waste percent here.",
    });
  }
  if (ctx.families.includes("tile") && picked.some((l) => /large format/i.test(l))) {
    w.push({
      id: "tile-large-format",
      text: "Large-format tile usually needs a flatter substrate than standard 12x12. Confirm prep / Field verify — do not invent a self-leveler bag count.",
    });
  }
  const hsFamilies = ctx.families.filter(isHardSurfaceFamily);
  if (hsFamilies.length >= 2 && ctx.answeredInstallMethod.length) {
    const methods = uniqueSystems(
      ctx.answeredInstallMethod.map(installSystemFromLabel),
    );
    const labels = hsFamilies.map(familyLabel).join(" + ");
    const uncovered = hsFamilies.filter(
      (f) => !methods.some((m) => permittedInstallSystems(f, ctx.hardwoodConstruction).includes(m)),
    );
    const orphanLabels = ctx.answeredInstallMethod.filter((label) => {
      const m = installSystemFromLabel(label);
      return m !== "unknown" && !hsFamilies.some((f) => permittedInstallSystems(f, ctx.hardwoodConstruction).includes(m));
    });
    if (orphanLabels.length) {
      w.push({
        id: "mixed-hs-method",
        text: `This job has ${labels}. “${orphanLabels.join(" / ")}” is not a permitted method for those products. Confirm each product, or split the estimate — do not assume one system covers both.`,
      });
    } else if (uncovered.length) {
      w.push({
        id: "mixed-hs-method",
        text: `This job has ${labels}. No selected method covers ${uncovered.map(familyLabel).join(" and ")}. Pick that product’s system too, or split the estimate — do not invent a per-room method here.`,
      });
    } else if (methods.length === 1) {
      const signatures = new Set(
        hsFamilies.map((f) => permittedInstallSystems(f, ctx.hardwoodConstruction).slice().sort().join(",")),
      );
      if (signatures.size > 1) {
        w.push({
          id: "mixed-hs-install",
          text: `This job has ${labels} sharing one install method. Confirm each product actually uses “${ctx.answeredInstallMethod[0]}”, or pick every method in play — do not invent a per-room editor here.`,
        });
      }
    }
  }
  if (ctx.families.some((f) => f === "lvp" || f === "laminate" || f === "hardwood") && picked.some((l) => /diagonal/i.test(l))) {
    w.push({
      id: "hs-diagonal",
      text: "Diagonal / special plank layout usually needs more waste than a straight run. Confirm waste with the salesperson — do not invent a percent.",
    });
  }
  if (has(ctx.prepConfidence, /field|tbd|verify/i)) {
    w.push({
      id: "prep-tbd",
      text: "Prep is Field verify / TBD — do not treat bag counts or leveler quantities as final until the crew sees the substrate.",
    });
  }
  if (
    (extras?.hsStairSteps ?? 0) > 0 &&
    extras?.hasStairNose === false &&
    ctx.families.some(isHardSurfaceStairFamily) &&
    !jobIsExclusiveWallTile(ctx)
  ) {
    w.push({
      id: "hs-stair-nose",
      text: "Hard-surface stairs usually need a stair nose (each) per step. Add them on Trims or confirm none — do not invent a Versatrim SKU here.",
    });
  }
  if (ctx.families.some(isHardSurfaceStairFamily) && !jobIsExclusiveWallTile(ctx)) {
    const present = extras?.presentTrimTypes ?? [];
    const missingTrans = (extras?.neededTransitionTrims ?? []).filter(
      (label) => !present.some((t) => t.toLowerCase() === label.toLowerCase()),
    );
    if (missingTrans.length) {
      w.push({
        id: "hs-transitions",
        text: `Doorway transitions still needed on Trims (${missingTrans.join(", ")} — each, never square feet). Add catalog pieces or confirm none — do not invent a SKU here.`,
      });
    }
    const missingBase = (extras?.neededBaseTrims ?? []).filter(
      (label) => !present.some((t) => t.toLowerCase() === label.toLowerCase()),
    );
    if (missingBase.length) {
      w.push({
        id: "hs-base-trim",
        text: `Base / quarter round / shoe still needed on Trims (${missingBase.join(", ")} — linear feet, never square feet). Add footage or keep existing.`,
      });
    }
  }
  if (ctx.unscopedProductFamilies.length) {
    const labels = ctx.unscopedProductFamilies.map(familyLabel).join(", ");
    w.push({
      id: "unscoped-products",
      text: `Assigned products include ${labels}, but the job type / surface pick does not. Add that flooring type (project type is multi-select) so pad, cuts, fasteners, and the right follow-ups appear — do not guess.`,
    });
  }
  const mixedGaps = mixedJobAssignmentGaps({
    jobFamilies: ctx.families,
    byFamily: extras?.byFamily,
    measuredSqft: extras?.measuredSqft ?? 0,
    unassignedRoomSqft: extras?.unassignedRoomSqft,
  });
  if (mixedGaps.unassignedFamilies.length || mixedGaps.unassignedRoomSqft > 0) {
    const job = ctx.families.filter((f) => f !== "other").map(familyLabel).join(" + ");
    const missing = mixedGaps.unassignedFamilies.map(familyLabel).join(" + ");
    const flooringCount = ctx.families.filter((f) => f !== "other").length;
    const allUnassigned = mixedGaps.unassignedFamilies.length === flooringCount;
    let text: string;
    if (mixedGaps.unassignedFamilies.length && mixedGaps.unassignedRoomSqft > 0) {
      const verb = mixedGaps.unassignedFamilies.length === 1 ? "has" : "have";
      text = `This job has ${job}. Assign each room on the floor map (${missing} ${verb} no product, and some rooms are blank). Mixed jobs do not clone whole-job sq ft.`;
    } else if (mixedGaps.unassignedFamilies.length) {
      if (allUnassigned) {
        text = `This job has ${job}. Assign each room to a product on the floor map — mixed jobs do not clone whole-job sq ft onto every family.`;
      } else {
        const verb = mixedGaps.unassignedFamilies.length === 1 ? "has" : "have";
        text = `This job has ${job}. ${missing} ${verb} no rooms on the floor map — mixed jobs do not clone whole-job sq ft onto unassigned products.`;
      }
    } else {
      text = `This job has ${job}. Some rooms have no product on the floor map — mixed jobs drop those rooms from the takeoff rather than cloning whole-job sq ft.`;
    }
    w.push({ id: "mixed-unassigned", text });
  }
  if (!jobIsExclusiveWallTile(ctx)) {
    if (has(ctx.subfloorCondition, /uneven|height difference/i) && ctx.hsPrep.length && !has(ctx.hsPrep, /self-?level/i)) {
      w.push({
        id: "subfloor-uneven",
        text: "Substrate is uneven / a height change, but prep is not self-leveling. Confirm None / skim is enough, or set Field verify — do not invent a bag count.",
      });
    }
    if (has(ctx.subfloorCondition, /damage|soft/i) && has(ctx.subfloorNeeded, /^no$/i)) {
      w.push({
        id: "subfloor-damage",
        text: "Substrate has damage / soft spots and subfloor is marked No. Confirm that, or mark Field verify rather than skipping sheets.",
      });
    }
    if (has(ctx.subfloorCondition, /unknown|field verify/i) && has(ctx.prepConfidence, /^known$/i)) {
      w.push({
        id: "subfloor-unknown-known",
        text: "Substrate condition is Unknown / field verify, but prep confidence is Known. Those do not match — switch confidence to Field verify / TBD rather than a fake bag count.",
      });
    }
  }
  return w;
}
