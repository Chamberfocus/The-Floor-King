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
  permittedInstallSystems,
  INSTALL_METHOD_LABELS,
  type FlooringFamily,
  type HardwoodConstruction,
  type InstallSystem,
} from "./families";
import { matchesShowIf } from "./show-if";
import {
  jobIsNewConstruction,
  jobIsVacant,
  labelsAreNewConstruction,
  labelsAreWallOnly,
  synthesizeStairGate,
} from "./answers";
import {
  CARPET_TILE_HIDES_KEYS,
  DEFAULT_KNOWLEDGE_WHEN,
  FURNITURE_MOVING_KEYS,
  KNOWLEDGE_QUESTIONS,
  NEW_CONSTRUCTION_HIDES_KEYS,
  REMOVAL_QUESTION_KEYS,
  TILE_WALL_HIDES_KEYS,
  tileWallHidesPrepOptionLabel,
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
 * system (laminate floating, tile thinset, sheet vinyl glue) when unanswered.
 * Mixed LVP + laminate does not infer — those families do not share one method.
 */
export function finalizeInstallContext(ctx: InstallContext): InstallContext {
  const carpetSystems = ctx.answeredCarpetInstall
    .map(installSystemFromLabel)
    .filter((s): s is InstallSystem => s !== "unknown");
  const hsAnswered = ctx.answeredInstallMethod
    .map(installSystemFromLabel)
    .filter((s): s is InstallSystem => s !== "unknown");
  let hsSystems = hsAnswered;
  let inferredLabel: string | null = null;
  const sole = solePermittedInstallSystem(ctx.families, ctx.hardwoodConstruction);
  if (!hsAnswered.length && sole) {
    hsSystems = [sole];
    inferredLabel = INSTALL_METHOD_LABELS[sole];
  }
  const hasHS =
    ctx.projectTypes.some((p) => /hard/i.test(p)) || ctx.families.some(isHardSurfaceFamily);
  const hasCarpet =
    ctx.projectTypes.some((p) => /carpet/i.test(p)) || ctx.families.includes("carpet");
  return {
    ...ctx,
    systems: uniqueSystems([...carpetSystems, ...hsSystems]),
    installLabels: uniqueStrings([
      ...ctx.answeredCarpetInstall,
      ...ctx.answeredInstallMethod,
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
 * for attached_pad still waited for a click.
 */
export function synthesizeSoleInstallMethod(
  valByKey: Record<string, string[]>,
): Record<string, string[]> {
  if ((valByKey.install_method ?? []).length) return valByKey;
  const ctx = installContextFromValByKey(valByKey);
  const sole = solePermittedInstallSystem(ctx.families, ctx.hardwoodConstruction);
  if (!sole) return valByKey;
  return { ...valByKey, install_method: [INSTALL_METHOD_LABELS[sole]] };
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
  if (projectTypes.some((p) => /carpet/i.test(p))) add("carpet");
  for (const s of surfaceLabels) add(familyFromSurfaceLabel(s));

  let hardwoodConstruction: HardwoodConstruction = "unknown";
  for (const s of surfaceLabels) {
    const c = hardwoodConstructionFromLabel(s);
    if (c !== "unknown") {
      hardwoodConstruction = c;
      break;
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

  const hasHS = projectTypes.some((p) => /hard/i.test(p));

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
 * Hardwood or any glue-down system (including glue-down carpet). Stretch-in
 * and floating laminate do not need the climate / acclimation warning.
 */
export function installNeedsAcclimationClimate(ctx: InstallContext): boolean {
  return ctx.families.includes("hardwood") || ctx.systems.includes("glue");
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
  // Attached-pad Yes → hide separate-underlayment questions.
  if (q.key === "hs_underlayment" && install.attachedPad === "yes") return false;
  if (
    q.key &&
    (REMOVAL_QUESTION_KEYS as readonly string[]).includes(q.key) &&
    jobIsNewConstruction(valByKey)
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
    jobIsVacant(valByKey)
  ) {
    return false;
  }
  if (
    q.key &&
    (NEW_CONSTRUCTION_HIDES_KEYS as readonly string[]).includes(q.key) &&
    jobIsNewConstruction(valByKey)
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
 * Exclusive wall tile — no other floor-covering family, application is Wall
 * (not Floor / Both / Unknown / unanswered). Showers still keep wet area,
 * appliances, prep, and setting materials.
 */
export function jobIsExclusiveWallTile(install: InstallContext): boolean {
  return (
    labelsAreWallOnly(install.tileApplication) &&
    !install.surfacePending &&
    !jobHasNonTileFloorFamily(install)
  );
}

/**
 * Exclusive carpet tile — every answered carpet-install system is carpet_tile.
 * Same evidence as rollGoodsNeedCuts: unanswered stays optimistic (layout
 * questions remain). Stretch-in or glue mixed with tile still asks pattern
 * match. Mixed LVP + exclusive tile hides it — LVP is not a carpet roll.
 */
export function jobIsExclusiveCarpetTile(install: InstallContext): boolean {
  return !rollGoodsNeedCuts(
    "carpet",
    carpetInstallSystemsFromLabels(install.answeredCarpetInstall),
  );
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
  return true;
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
  if (key === "install_method") {
    const hs = ctx.families.filter(isHardSurfaceFamily);
    if (hs.length >= 2) {
      return `This job has ${hs.map(familyLabel).join(" + ")}. Pick every install method in play — adhesive, pad, and fastener follow-ups follow those picks. One chip still hides the other branch. Do not invent a per-room editor here.`;
    }
    if (ctx.families.includes("laminate"))
      return "Laminate is a floating floor. Adhesive questions stay hidden unless a different method is actually in play.";
    if (ctx.families.includes("vinyl"))
      return "Sheet vinyl is roll goods — glue-down is the usual system. Layout and seams, not carton math.";
    if (ctx.families.includes("tile"))
      return "Tile sets in thinset/mortar. Floating-floor accessories do not apply.";
    if (ctx.families.includes("hardwood")) {
      return ctx.hardwoodConstruction === "engineered"
        ? "Engineered hardwood may allow nail, staple, glue, or floating — confirm the product permits the method you pick."
        : "Solid hardwood is typically nail, staple, or glue. Floating is uncommon; confirm the product before using it.";
    }
    if (ctx.families.includes("lvp")) {
      if (ctx.systems.includes("loose_lay"))
        return "Loose-lay is not glue-down and not a floating click floor — adhesive and attached-pad questions stay off. Confirm the product permits it on this substrate.";
      return "Floating/click, glue-down, and loose-lay ask different follow-ups. Pick the system this product actually uses.";
    }
  }
  if (key === "carpet_install") {
    return "Stretch-in over pad is the residential default. Glue-down is still roll goods (cuts are the order). Carpet tile is modular — measured area plus waste, carton only if the product has coverage. Exclusive carpet tile hides pattern match, pattern repeat, and seam/direction notes — those are a roll cut plan, not modular layout. Mixed stretch-in + tile still asks them. Do not invent a box size.";
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
    return "Assign a catalog product to each room. Mixed jobs keep measured area per family — 300 sq ft of carpet is not also 300 sq ft of LVP. Unassigned rooms stay off the takeoff rather than cloning whole-job sq ft.";
  }
  if (q.kind === "cuts") {
    if (q.config?.category === "vinyl") {
      return "Sheet vinyl is roll goods. These cuts are the order quantity — converting room square feet into yards is not a layout and is not billed as an order. Cut totals show Order TBD when width × length is missing — 0 sq yd is not an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. Width starts empty unless the catalog has roll_width_ft. 6'/12' chips are one tap — we do not plant 6'.";
    }
    if (!rollGoodsNeedCuts("carpet", carpetInstallSystemsFromLabels(ctx.answeredCarpetInstall))) {
      return "Carpet tile is modular. Pick the product here; order is measured area plus waste. Carton count only if the product has coverage — we do not invent a box size. This is not a roll cut plan. Builder shows measured coverage and carton math, not Cuts vs Roll.";
    }
    return "Cuts are the order quantity. Converting room square feet into yards is not a cut plan and is not billed as an order. Builder warehouse cuts show Order TBD until width × length is entered — leftover sq ft is measured area, not the order. The cuts step totals Order TBD when width is empty — 0 sq yd is not an order. Width starts empty unless the catalog has roll_width_ft. 12'/15' chips are one tap — we do not plant 12'. Carpet tile hides the cut list and uses measured area instead. Install labor uses this question's Settings $/sq yd — it does not invent $6.";
  }
  if (key === "tile_layout") {
    return "Straight vs diagonal changes waste and labor. Capture it; do not auto-inflate waste without the salesperson.";
  }
  if (key === "hardwood_fasteners") {
    return "Nail/staple jobs need fasteners. Pick the catalog item in Builder — this question only records the need.";
  }
  if (key === "hardwood_finish") {
    return "Prefinished vs unfinished (site finish) changes sanding, finishing, and acclimation notes. Floor King has no sand/finish labor in the catalog — capture it as scope. Field verify if the SKU is not in front of you. Do not invent a sand-and-finish dollar amount.";
  }
  if (key === "existing_bond") {
    return "Glued-down LVP/laminate/vinyl is a different tear-out than floating. Scope note — existing demo rates stay.";
  }
  if (key === "existing_pad") {
    return "Tearing out carpet — to carpet or to hard surface — usually takes the pad with it. Reuse only when the salesperson explicitly allows it. This follows the existing floor, not only a new-carpet job. Do not invent a second demo rate; the tear-out line gets a pad note.";
  }
  if (key === "existing_tack") {
    return "Tearing out carpet usually takes tack strip with it. Keep is unusual. This is not new stretch-in tack strip — that stays on the install step. Linear feet stay off until you add a catalog item. Do not invent a linear-foot price.";
  }
  if (key === "work_type") {
    return "Replacement asks what's coming up. New construction hides tear-out, pad removal, existing-vinyl skim, asbestos, disposal, and toilet pull/reset — substrate, prep, appliances, and door shaves still apply. Unknown / field verify keeps demo visible. The overlay warning names those hides; do not invent a demo charge on a new slab.";
  }
  if (key === "tack_strip") {
    return "Stretch-in needs tack strip. Glue-down and carpet tile do not. Capture keep vs replace — do not invent a linear-foot price unless a catalog item is added.";
  }
  if (key === "tack_strip_qty") {
    return "Linear feet of new tack strip — never square feet. Skip if you will measure on site. Field verify on the previous step does not invent a footage.";
  }
  if (key === "metals_needed") {
    return "Carpet-to-hard-surface doorways and edges. Yes opens the count (EACH) plus type/color. Do not invent a metal price here.";
  }
  if (key === "metals_qty") {
    return "Count of metals / transitions in EACH — never square feet. Pick a catalog gripper or flat metal in Builder if Floor King sells it.";
  }
  if (key === "metal_type") {
    return "Gripper vs flat. The count is the previous step — this does not add a second charge.";
  }
  if (key === "crew_entry") {
    return "How the crew gets in (lockbox / homeowner / key). Upper floor, elevator, and long carry stay on Access conditions.";
  }
  if (key === "occupancy") {
    return "Occupied vs vacant. Vacant hides furniture moving — empty house, do not invent a furniture charge. Occupied and Unknown still ask light/medium/heavy. Unanswered stays open.";
  }
  if (key === "wet_area") {
    return "Bath, laundry, or mudroom. Confirm the selected product is rated for a wet area. Catalog has no waterproof column — do not invent a SKU or a ban. Field verify if you have not seen the space.";
  }
  if (key === "access_conditions") {
    return "Upper floor, elevator, long carry, unusual access — scope/schedule notes unless a Floor King labor item is added in Builder.";
  }
  if (key === "climate_control") {
    return "AC and heat on site. The acclimation warning fires only for hardwood / glue-down, from this overlay — not a second questionnaire list. Stretch-in and floating still capture it as an install condition. Legacy AC/heat yes-no answers still count.";
  }
  if (key === "laminate_expansion") {
    return "Floating floors need expansion at walls and transitions. Record it as scope; add catalog reducers / T-molds / quarter round on the trim step rather than inventing a charge here.";
  }
  if (key === "selflevel_needed") {
    return "Bag count uses Settings coverage at the chosen pour. Pour is the shop default, else the coverage reference — we do not invent 1/4 inch. Field verify withholds bags.";
  }
  if (key === "tile_setting") {
    return "Thinset, grout, and backer come from the catalog in Builder. This records the need — bag counts stay TBD unless a product with coverage is actually picked. Taped square feet is not bags of thinset.";
  }
  if (key === "vents_registers") {
    return "Count of vents/registers to change, in EACH. Never square feet. Pick a catalog vent on Trims if Floor King sells it; otherwise this is a crew note.";
  }
  if (key === "vapor_barrier") {
    return "Often required over concrete on floating or glue-down. Nail-down over a slab still asks — capture the need, do not invent a product if it is not in the catalog. Field verify is allowed.";
  }
  if (key === "substrate") {
    return "If you cannot see the substrate until demo, pick Unknown / field verify rather than guessing plywood vs concrete.";
  }
  if (key === "subfloor_needed") {
    return "Yes emits 4×8 sheets only when Settings has sheet_sqft. Missing coverage is TBD — we do not invent 32 sq ft per sheet. Field verify withholds the count.";
  }
  if (key === "subfloor_condition") {
    return "Flat vs uneven vs cracks vs a height change. Exclusive wall tile hides this — that is floor work, not a backsplash. Mixed LVP + wall still asks. If demo hasn't happened, pick Unknown / field verify — do not invent a bag count.";
  }
  if (key === "prep_scope") {
    return "Same-for-the-job is faster. Set it by room when one room is a wet area or a different substrate — you'll fill prep on the rooms step.";
  }
  if (key === "furniture_heavy") {
    return "Pianos, pool tables, and loaded cabinets are scope/schedule notes unless this job already has a furniture-moving labor line. Vacant jobs hide this.";
  }
  if (key === "furniture_level") {
    return "Light / medium / heavy uses Floor King's furniture-moving labor. Vacant jobs hide this. Specialty items (piano, pool table) stay on the next question as scope.";
  }
  if (key === "carpet_pad") {
    return "Stretch-in over pad is the residential default. Glue-down and carpet tile hide this — they do not use residential pad. Quantity follows carpet rooms. A pad SKU with no sold-by unit is TBD in Builder (How many / Unit TBD), not taped square feet.";
  }
  if (key === "toilets") {
    return "Count in EACH. Uses Floor King's pull & reset labor when you enter a number — do not type square feet. New construction hides this — there is no toilet to pull. Appliances still ask.";
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
    return "Floor vs wall. Exclusive wall tile hides toilets, vents, door shaves, floor stairs, construction grade, radiant heat, doorway T-molds, 4×8 subfloor sheets, self-leveler bags, slab vapor barrier, aqua-bar mitigation, slab moisture tests, floor subfloor condition (flat / uneven / cracks), stair landings, and open-side notes — those are floor work. Self-leveling and grinding chips on Floor prep hide too; patch / skim stays for showers. Mixed carpet or LVP + wall tile still asks them. Unanswered and Unknown stay open. Keep wet area, appliances, floor prep, substrate, base trim, and setting materials. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.";
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
    return "Aqua bar / primer only when hardwood, glue-down, or a moisture-concern flag makes it relevant. Floating laminate without that flag hides this. Existing catalog rates — do not invent a new product.";
  }
  if (key === "adhesive") {
    return "Glue-down and carpet tile need adhesive from the catalog. Stretch-in and floating hide this. Quantity is gallons or kits in Builder — taped square feet is not a glue order. A line with no sold-by unit shows How many / Unit TBD, not Sq ft. Do not invent coverage.";
  }
  if (key === "vinyl_skim") {
    return "Embossed existing vinyl often needs a skim coat. New construction hides this — there is no existing vinyl. If you cannot see it until demo, pick Field verify — do not invent a bag count here.";
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
    return "Hard-surface stairs are treads, risers, and stair noses in EACH — not an automatic 8 sq ft/step order. Exclusive wall tile hides this with landings and open sides — a backsplash is not a stair job. Wrap extra boxes are How many / Unit TBD in Builder, never taped square feet. Matching stairnose stays on Trims. Stair labor is per step when you enter a rate; do not invent one.";
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
    return "Hardwood and glue-down (including glue-down carpet) need acclimation / climate notes. Floating laminate and stretch-in hide this — do not invent a day count.";
  }
  if (key === "construction_grade") {
    return "Above / on / below grade can change what a product and adhesive permit. Stretch-in over wood hides this. Glue-down carpet, carpet tile, and hard surface still ask. Confirm against the product — do not assume a ban.";
  }
  if (key === "moisture_test") {
    return "Glue-down, hardwood, or a moisture-concern flag on the substrate. If you cannot test yet, pick Field verify — do not invent a number. Answering No fires the overlay moisture-untested warning; unanswered does not. Exclusive wall tile hides this — a slab moisture test is floor work. Wet area still asks.";
  }
  if (key === "stair_landings") {
    return "Count of landings in EACH. Measured with the rooms when they are floored the same; this flags extra pieces and noses. Exclusive wall tile hides this — a backsplash is not a stair job.";
  }
  if (key === "stair_open_sides") {
    return "Open sides change wrapped carpet ends and hard-surface nosing. Exclusive wall tile hides this. Capture the construction — pricing still uses existing stair labor.";
  }
  if (key === "stairs") {
    return "Stairs change material, labor, and trim. Exclusive wall tile hides this — a backsplash is not a stair job. Mixed carpet or LVP + wall still asks. Field verify if you have not seen them.";
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
  const newBuild = labelsAreNewConstruction(ctx.workType);

  if (newBuild) {
    w.push({
      id: "new-construction",
      text: "New construction — no tear-out. Demo, pad removal, existing-vinyl skim, asbestos, disposal, and toilet pull/reset stay off. Substrate, prep, appliances, and door shaves still apply. Do not invent a demo charge.",
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
      text: "Hardwood / glue-down without confirmed AC and heat — acclimation & adhesion are at risk. Confirm climate control.",
    });
  }
  if (
    installNeedsAcclimationClimate(ctx) &&
    ctx.moistureTest.some((l) => /^no$/i.test(l.trim()))
  ) {
    w.push({
      id: "moisture-untested",
      text: "Glue-down / hardwood without a moisture test — record as field verify rather than assuming the slab is dry.",
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
