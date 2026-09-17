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
  isHardSurfaceStairFamily,
  flooringFamiliesFromCategories,
  mergeFlooringFamilies,
  unscopedProductFamilies,
  familyLabel,
  type FlooringFamily,
  type HardwoodConstruction,
  type InstallSystem,
} from "./families";
import { matchesShowIf } from "./show-if";
import { synthesizeStairGate } from "./answers";
import { DEFAULT_KNOWLEDGE_WHEN, KNOWLEDGE_QUESTIONS } from "./registry";

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
  /** Hard surface chosen but surface type not answered yet. */
  surfacePending: boolean;
  /** Hard surface / carpet install method not answered yet. */
  installPending: boolean;
  /**
   * Families on assigned products that project_type / surface_type did not
   * scope. Overlay still unions them into `families`; this list is the warning.
   */
  unscopedProductFamilies: FlooringFamily[];
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
    surfacePending: false,
    installPending: false,
    unscopedProductFamilies: [],
  };
}

export function installContextFromValByKey(valByKey: Record<string, string[]>): InstallContext {
  const projectTypes = valByKey.project_type ?? [];
  const surfaceLabels = valByKey.surface_type ?? [];
  const installLabels = [
    ...(valByKey.install_method ?? []),
    ...(valByKey.carpet_install ?? []),
  ];
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

  const systems = installLabels
    .map(installSystemFromLabel)
    .filter((s): s is InstallSystem => s !== "unknown");

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
  const hasCarpet = projectTypes.some((p) => /carpet/i.test(p));

  return {
    projectTypes,
    surfaceLabels,
    families,
    installLabels,
    systems,
    hardwoodConstruction,
    attachedPad,
    substrate: valByKey.substrate ?? valByKey.subfloor_type ?? [],
    grade: valByKey.construction_grade ?? [],
    stairs,
    existingFlooring: valByKey.hs_demo ?? [],
    prepConfidence: valByKey.prep_confidence ?? [],
    occupancy: valByKey.occupancy ?? [],
    surfacePending: hasHS && surfaceLabels.length === 0,
    installPending:
      (hasHS && (valByKey.install_method ?? []).length === 0) ||
      (hasCarpet && (valByKey.carpet_install ?? []).length === 0 && (valByKey.install_method ?? []).length === 0),
    unscopedProductFamilies: [],
  };
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
  return {
    ...ctx,
    unscopedProductFamilies: unscopedProductFamilies(ctx, productFamilies),
    families: mergeFlooringFamilies(ctx.families, productFamilies),
  };
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
      if (!clause.families?.length && !clause.systems?.length) return false;
    } else if (!substrateLabelMatches(have, clause.substrate)) {
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
  return true;
}

/**
 * Keys the overlay would show for this answer set (no SQL show_if). Proves
 * family/system branching without a live estimate_questions table.
 */
export function visibleKnowledgeKeys(valByKey: Record<string, string[]>): string[] {
  const keys = synthesizeStairGate(valByKey);
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
  q: { key?: string | null; kind?: string; config?: { category?: string } },
  ctx: InstallContext,
): string | null {
  const key = q.key ?? "";
  if (key === "install_method") {
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
    return "Stretch-in over pad is the residential default. Glue-down and carpet tile change pad, tack strip, and adhesive.";
  }
  if (key === "prep_confidence") {
    return "If you cannot see the substrate until demo, leave this as Field verify / TBD rather than guessing a bag count.";
  }
  if (q.kind === "areas") {
    return "Enter rooms in feet and inches. Add a section for closets and offsets. This is MEASURED area — order quantity is calculated next from the product and (for carpet) the cuts.";
  }
  if (q.kind === "cuts") {
    return q.config?.category === "vinyl"
      ? "Sheet vinyl is roll goods. These cuts are the order quantity — converting room square feet into yards is not a layout."
      : "Cuts are the order quantity. Converting room square feet into yards is not a cut plan.";
  }
  if (key === "tile_layout") {
    return "Straight vs diagonal changes waste and labor. Capture it; do not auto-inflate waste without the salesperson.";
  }
  if (key === "hardwood_fasteners") {
    return "Nail/staple jobs need fasteners. Pick the catalog item in Builder — this question only records the need.";
  }
  if (key === "existing_bond") {
    return "Glued-down LVP/laminate/vinyl is a different tear-out than floating. Scope note — existing demo rates stay.";
  }
  if (key === "tack_strip") {
    return "Stretch-in needs tack strip. Glue-down and carpet tile do not. Capture keep vs replace — do not invent a linear-foot price unless a catalog item is added.";
  }
  if (key === "laminate_expansion") {
    return "Floating floors need expansion at walls and transitions. Record it as scope; add catalog reducers / T-molds / quarter round on the trim step rather than inventing a charge here.";
  }
  if (key === "tile_setting") {
    return "Thinset, grout, and backer come from the catalog in Builder. This records the need — bag counts stay TBD unless a product with coverage is actually picked.";
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
  if (key === "subfloor_condition") {
    return "Flat vs uneven vs cracks vs a height change. If demo hasn't happened, pick Unknown / field verify — do not invent a bag count.";
  }
  if (key === "prep_scope") {
    return "Same-for-the-job is faster. Set it by room when one room is a wet area or a different substrate — you'll fill prep on the rooms step.";
  }
  if (key === "furniture_heavy") {
    return "Pianos, pool tables, and loaded cabinets are scope/schedule notes unless this job already has a furniture-moving labor line.";
  }
  if (key === "furniture_level") {
    return "Light / medium / heavy uses Floor King's furniture-moving labor. Specialty items (piano, pool table) stay on the next question as scope.";
  }
  if (key === "carpet_pad") {
    return "Stretch-in over pad is the residential default. Glue-down and carpet tile hide this — they do not use residential pad.";
  }
  if (key === "toilets") {
    return "Count in EACH. Uses Floor King's pull & reset labor when you enter a number — do not type square feet.";
  }
  if (key === "appliances") {
    return "Count in EACH (fridge, stove, washer/dryer). Uses Floor King's disconnect/move labor when you enter a number.";
  }
  if (key === "doors_shave") {
    return "Count of doors to undercut, in EACH. Never square feet.";
  }
  if (key === "tile_application") {
    return "Floor vs wall. Wall tile is only priced from catalog items you pick in Builder — this does not invent wall-tile labor.";
  }
  if (key === "vinyl_skim") {
    return "Embossed existing vinyl often needs a skim coat. If you cannot see it until demo, pick Field verify — do not invent a bag count here.";
  }
  if (key === "carpet_stairs") {
    return "Waterfall vs upholstered changes the per-step labor. This is not a hard-surface stair-nose takeoff.";
  }
  if (key === "hs_plank_stairs") {
    return "Hard-surface stairs are treads/risers and stair noses, not carpet waterfall. Matching stairnose stays on Trims.";
  }
  if (key === "hs_transitions") {
    return "Doorway transitions are EACH — T-mold, reducer, end cap, threshold, metal. Add matching catalog pieces on Trims. Do not invent a SKU here. Field verify is allowed.";
  }
  if (key === "hs_base_trim") {
    return "Base, quarter round, and shoe are linear feet — never square feet. Add footage on Trims. Keep existing or Field verify if demo has not happened.";
  }
  if (key === "pattern_repeat") {
    return "Inches of pattern repeat for purchasing and layout notes. This does not generate a cut plan.";
  }
  if (key === "delivery_scope") {
    return "Floor King has a Delivery add-on. Record whether to include it — pick the catalog line in Builder rather than inventing a fuel charge here.";
  }
  if (key === "acclimation") {
    return "Hardwood and glue-down need acclimation / climate notes. Floating laminate and stretch-in carpet hide this — do not invent a day count.";
  }
  if (key === "moisture_test") {
    return "Glue-down and hardwood over concrete often need a moisture reading. If you cannot test yet, pick Field verify — do not invent a number.";
  }
  if (key === "stair_landings") {
    return "Count of landings in EACH. Measured with the rooms when they are floored the same; this flags extra pieces and noses.";
  }
  if (key === "stair_open_sides") {
    return "Open sides change wrapped carpet ends and hard-surface nosing. Capture the construction — pricing still uses existing stair labor.";
  }
  if (key === "asbestos_risk") {
    return "Old ceramic or sheet vinyl can hide asbestos. Possible / confirmed is a crew warning — do not invent an abatement dollar amount here.";
  }
  if (key === "hs_direction") {
    return "Which way the planks run. Diagonal can need more waste — confirm with the salesperson; do not auto-inflate the percent.";
  }
  return null;
}

export function knowledgeWarnings(ctx: InstallContext, extras?: {
  hasCuts?: boolean;
  hasVinylCuts?: boolean;
  measuredSqft?: number;
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

  if (ctx.surfaceLabels.includes("LVP / Vinyl")) {
    w.push({
      id: "legacy-lvp-vinyl",
      text: "“LVP / Vinyl” is the old combined label. LVP/LVT (boxed) and sheet vinyl (roll goods) order differently — pick the matching surface if you can.",
    });
  }
  if (ctx.families.includes("hardwood") && ctx.hardwoodConstruction === "solid" && has(ctx.grade, /below/i)) {
    w.push({
      id: "solid-below-grade",
      text: "Solid hardwood below grade — confirm the product/manufacturer permits this. Do not assume it; field verify if unsure.",
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
    extras?.hasCuts === false
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
  if (picked.some((l) => /mortar bed/i.test(l) && /with/i.test(l))) {
    w.push({
      id: "mortar",
      text: "Ceramic WITH mortar bed demo — expect a floor-height change. Check transitions and door clearance.",
    });
  }
  if (picked.some((l) => /ceramic/i.test(l))) {
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
    ctx.families.some(isHardSurfaceStairFamily)
  ) {
    w.push({
      id: "hs-stair-nose",
      text: "Hard-surface stairs usually need a stair nose (each) per step. Add them on Trims or confirm none — do not invent a Versatrim SKU here.",
    });
  }
  if (ctx.families.some(isHardSurfaceStairFamily)) {
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
  return w;
}
