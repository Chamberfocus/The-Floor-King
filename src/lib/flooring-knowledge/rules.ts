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

import type { EstimateQuestion, KnowledgeWhen, QuestionPurpose, ShowIfClause } from "@/lib/types";
import {
  familyFromSurfaceLabel,
  hardwoodConstructionFromLabel,
  installSystemFromLabel,
  type FlooringFamily,
  type HardwoodConstruction,
  type InstallSystem,
} from "./families";
import { matchesShowIf } from "./show-if";

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

  const stairsRaw = valByKey.stairs ?? [];
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
    existingFlooring: valByKey.existing_floor ?? [],
    prepConfidence: valByKey.prep_confidence ?? [],
    occupancy: valByKey.occupancy ?? [],
    surfacePending: hasHS && surfaceLabels.length === 0,
    installPending:
      (hasHS && (valByKey.install_method ?? []).length === 0) ||
      (hasCarpet && (valByKey.carpet_install ?? []).length === 0 && (valByKey.install_method ?? []).length === 0),
  };
}

/**
 * Built-in overlay for keyed questions that predate `knowledge_when`.
 * Keys not listed are unrestricted (show_if alone decides).
 */
export const DEFAULT_KNOWLEDGE_WHEN: Record<string, KnowledgeWhen> = {
  // Carpet-only details
  metals_needed: { families: ["carpet"], purpose: "ACCESSORY" },
  pattern_match: { families: ["carpet"], purpose: "WAREHOUSE" },
  carpet_direction: { families: ["carpet"], purpose: "WAREHOUSE" },
  existing_pad: { families: ["carpet"], purpose: "LABOR" },
  carpet_install: { families: ["carpet"], purpose: "INSTALLATION" },
  // Hard-surface / method
  surface_type: { purpose: "MATERIAL" },
  install_method: { purpose: "INSTALLATION" },
  adhesive: { systems: ["glue"], purpose: "MATERIAL" },
  hs_underlayment: { systems: ["floating"], purpose: "MATERIAL" },
  attached_pad: { systems: ["floating"], families: ["lvp", "laminate", "hardwood"], purpose: "MATERIAL" },
  vapor_barrier: { systems: ["floating", "glue"], purpose: "PREP" },
  acclimation: { purpose: "INSTALLATION" },
  moisture_test: { purpose: "PREP" },
  moisture_mitigation: { purpose: "PREP" },
  substrate: { purpose: "PREP" },
  construction_grade: { families: ["hardwood", "lvp", "laminate", "vinyl", "tile"], purpose: "INSTALLATION" },
  radiant_heat: { purpose: "WARNING" },
  hs_product: { purpose: "MATERIAL" },
  // Stairs extras
  stair_landings: { purpose: "MEASUREMENT" },
  stair_open_sides: { purpose: "MEASUREMENT" },
  // Site
  occupancy: { purpose: "SCHEDULING" },
  access_conditions: { purpose: "SCHEDULING" },
  prep_confidence: { purpose: "PREP" },
};

function listHas(have: string[], want: string[]): boolean {
  return want.some((w) => have.includes(w));
}

/**
 * Overlay: hide only with positive evidence.
 */
export function knowledgeWhenApplies(when: KnowledgeWhen | null | undefined, ctx: InstallContext): boolean {
  if (!when) return true;

  if (when.families?.length) {
    if (ctx.surfacePending) {
      // Still deciding the HS product — don't hide family-specific questions
      // that aren't already gated by show_if. Carpet-only questions DO hide
      // when the job is HS-only with no carpet.
      const wantsCarpet = when.families.includes("carpet");
      const hasCarpet = ctx.families.includes("carpet") || ctx.projectTypes.some((p) => /carpet/i.test(p));
      const wantsHs = when.families.some((f) => f !== "carpet");
      if (wantsCarpet && !hasCarpet && !wantsHs) return false;
    } else if (!ctx.families.some((f) => when.families!.includes(f))) {
      return false;
    }
  }

  if (when.systems?.length) {
    if (ctx.installPending || ctx.systems.length === 0) {
      // Method not chosen — leave the question to show_if.
    } else if (!ctx.systems.some((s) => when.systems!.includes(s))) {
      return false;
    }
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
    if (ctx.families.includes("lvp"))
      return "Floating/click, glue-down, and loose-lay ask different follow-ups. Pick the system this product actually uses.";
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
    return "Cuts are the order quantity. Converting room square feet into yards is not a cut plan.";
  }
  return null;
}

export function knowledgeWarnings(ctx: InstallContext, extras?: {
  hasCuts?: boolean;
  measuredSqft?: number;
  pickedLabels?: string[];
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
    ctx.families.includes("carpet") &&
    (extras?.measuredSqft ?? 0) > 0 &&
    extras?.hasCuts === false
  ) {
    w.push({
      id: "carpet-no-cuts",
      text: "Carpet measured by area only — converting sq ft ÷ 9 is equivalent area, not a cut plan. Enter cuts (roll width × length) before ordering.",
    });
  }
  if (ctx.families.includes("vinyl") && extras?.hasCuts === false && (extras?.measuredSqft ?? 0) > 0) {
    w.push({
      id: "vinyl-no-layout",
      text: "Sheet vinyl is roll goods. Measured area is not automatically the order quantity — seams and roll width can require more.",
    });
  }
  if (ctx.attachedPad === "yes" && ctx.systems.includes("glue")) {
    w.push({
      id: "pad-glue",
      text: "Attached pad on a glue-down system is unusual — confirm the product is actually glue-down or actually has an attached pad.",
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
  if (has(ctx.prepConfidence, /field|tbd|verify/i)) {
    w.push({
      id: "prep-tbd",
      text: "Prep is Field verify / TBD — do not treat bag counts or leveler quantities as final until the crew sees the substrate.",
    });
  }
  return w;
}
