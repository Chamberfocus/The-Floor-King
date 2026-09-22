/**
 * Salesperson-facing Guided Estimate helper copy.
 *
 * `knowledgeHelpFor` in rules.ts is internal rule metadata. It is not rendered.
 * Stored `estimate_questions.help` was overwritten with that same metadata.
 * This module is the only copy the Guided Estimate screen may show.
 */

import type { InstallContext } from "./rules";
import { jobIsExclusiveCarpetOnly, jobIsExclusiveTile } from "./rules";
import {
  carpetInstallSystemsFromLabels,
  familyLabel,
  isHardSurfaceFamily,
  rollGoodsNeedCuts,
} from "./families";

/** Phrases that belong in rule notes, never in on-screen helper copy. */
const INTERNAL_RULE_COPY =
  /hydrate|leftover|unit tbd|qty tbd|carton-coverage|carton coverage tbd|job_description|taped sq|do not plant|do not invent|show_if|mixed-product|\bhow many boxes\b|cuts vs roll|order tbd|field verify|builder warehouse|customer\s*\/\s*portal|wrap qty|not a 30-yard|overlay warning|stored line/i;

export function isInternalRuleCopy(text: string): boolean {
  return INTERNAL_RULE_COPY.test(text);
}

const CARPET_CUTS_HELP =
  "Enter each carpet cut using the required length and roll width. Order quantity is calculated from the cuts, not from the room's measured square footage.";

type HelpQuestion = {
  key?: string | null;
  kind?: string;
  help?: string | null;
  config?: { category?: string; trim_list?: boolean };
};

/**
 * Concise guidance for a knowledge question. Null when this module has no
 * sentence for that question (custom questions may still use a short stored hint).
 */
export function salespersonHelpFor(q: HelpQuestion, ctx: InstallContext): string | null {
  const key = q.key ?? "";
  if (key === "surface_type") {
    return "Choose the hard-surface product: LVP, hardwood, laminate, tile, or sheet vinyl. Carpet method is chosen on Carpet install.";
  }
  if (key === "install_method") {
    if (jobIsExclusiveCarpetOnly(ctx)) {
      return "This is a carpet job. Choose stretch-in, glue-down, or carpet tile on Carpet install.";
    }
    if (jobIsExclusiveTile(ctx)) {
      return "Tile is set in thinset. Setting materials are chosen on the tile step.";
    }
    const hs = ctx.families.filter(isHardSurfaceFamily);
    if (hs.length >= 2) {
      return `This job has ${hs.map(familyLabel).join(" and ")}. Pick each install method that applies. Adhesive, pad, and fasteners follow those choices.`;
    }
    if (ctx.families.includes("laminate")) {
      return "Laminate is a floating floor. Leave an expansion gap at the walls.";
    }
    if (ctx.families.includes("vinyl")) {
      return "Sheet vinyl is usually glued down. The cuts are the order, not the room size.";
    }
    if (ctx.families.includes("tile")) {
      return "Tile is set in thinset or mortar.";
    }
    if (ctx.families.includes("hardwood")) {
      return ctx.hardwoodConstruction === "engineered"
        ? "Engineered hardwood may be nailed, stapled, glued, or floated. Confirm the product allows the method you pick."
        : "Solid hardwood is typically nailed, stapled, or glued.";
    }
    if (ctx.families.includes("lvp")) {
      if (ctx.systems.includes("loose_lay")) {
        return "Loose-lay is not glue-down and not a click floor. Confirm the product allows it on this subfloor.";
      }
      return "Choose floating, glue-down, or loose-lay. Later questions follow that choice.";
    }
  }
  if (key === "carpet_install") {
    return "Stretch-in over pad is the usual residential install. Glue-down still uses carpet cuts. Carpet tile is ordered from measured area plus waste.";
  }
  if (key === "prep_confidence") {
    return "If the subfloor is hidden until tear-out, do not guess a bag count.";
  }
  if (q.config?.trim_list) {
    return "Quarter round, shoe, and base are linear feet. Stair noses, T-molds, and reducers are each. Pick a catalog item or enter the price you pay.";
  }
  if (q.kind === "areas") {
    return "Enter each room in feet and inches, including closets and offsets. This is measured area. Order quantity is calculated from the product, and from the cuts for carpet.";
  }
  if (q.kind === "floor_map") {
    return "Assign a product to each room. On a mixed job, carpet square feet are not also LVP square feet. Rooms without a product stay off the order.";
  }
  if (q.kind === "cuts") {
    if (q.config?.category === "vinyl") {
      return "Enter each sheet-vinyl cut with its length and roll width. Order quantity comes from those cuts, not from the room's measured square footage.";
    }
    if (!rollGoodsNeedCuts("carpet", carpetInstallSystemsFromLabels(ctx.answeredCarpetInstall))) {
      return "Carpet tile is ordered from the measured area plus waste. A carton count shows only when the product lists coverage per box.";
    }
    return CARPET_CUTS_HELP;
  }
  if (key === "tile_layout") return "Straight or diagonal changes waste and labor. Record the layout the customer wants.";
  if (key === "hardwood_fasteners") return "Nail or staple installs need fasteners. Pick the fastener in the builder when you are ready to price it.";
  if (key === "hardwood_finish") {
    return "Say whether the hardwood is prefinished or unfinished. Unfinished floors need sanding and finishing called out in the scope.";
  }
  if (key === "hs_demo") return "Record what is coming up so tear-out and disposal match the floor that is there now.";
  if (key === "existing_bond") return "Glued-down floors take longer to tear out than floating floors. Note which one is down.";
  if (key === "existing_pad") return "Carpet tear-out usually includes the pad. Keep the old pad only when you mean to reuse it.";
  if (key === "existing_tack") return "Carpet tear-out usually includes the tack strip. New tack for the install is a separate question.";
  if (key === "demo_disposal") return "Choose haul-away, a dumpster, or the curb. The curb option asks for the pickup day.";
  if (key === "bulk_pickup") return "Enter the city's bulk pickup day so the old floor is at the curb on time.";
  if (key === "work_type") return "Replacement asks what is coming up. New construction skips tear-out, because there is no old floor.";
  if (key === "tack_strip") return "Stretch-in needs tack strip. Glue-down and carpet tile do not. Note whether you are keeping or replacing it.";
  if (key === "tack_strip_qty") return "Enter linear feet of new tack strip. Leave it blank if you will measure on site.";
  if (key === "metals_needed") return "Doorways between carpet and hard surface need a metal. Yes asks for the count, type, and color.";
  if (key === "metals_qty") return "Count the metals in each, not in square feet.";
  if (key === "metal_type") return "Choose gripper or flat. The count is the previous step.";
  if (key === "metal_color") return "Choose the metal color. Pricing comes from the catalog item you add, not from this answer.";
  if (key === "crew_entry") return "Note how the crew gets in. Stairs, elevators, and long carries belong on Access.";
  if (key === "occupancy") return "Occupied homes may need furniture moved. A vacant home does not.";
  if (key === "wet_area") return "Bath, laundry, or mudroom. Confirm the product you picked is rated for water.";
  if (key === "access_conditions") return "Note an upper floor, elevator, or long carry. Add a labor charge in the builder only if you have a price for it.";
  if (key === "climate_control") return "Note whether the site has air conditioning and heat. Hardwood and glue-down need the space at living temperature.";
  if (key === "laminate_expansion") return "Floating floors need a gap at walls and transitions.";
  if (key === "attached_pad") return "Some floating LVP, laminate, and engineered products already have a pad attached.";
  if (key === "hs_underlayment") return "This is separate foam under a floating floor, not carpet pad. It is billed in square feet unless the product is sold by the yard.";
  if (key === "selflevel_needed") return "Bag count uses the coverage in Settings and the pour thickness you choose.";
  if (key === "tile_setting") return "Thinset, grout, and backer come from the catalog. This step records that you need them.";
  if (key === "vents_registers") return "Count vents or registers in each, not in square feet.";
  if (key === "vapor_barrier") return "Often required on concrete under floating or glue-down floors. Record the need here.";
  if (key === "substrate") return "If you cannot see the subfloor yet, choose Unknown instead of guessing plywood or concrete.";
  if (key === "subfloor_needed") return "Yes means plywood sheets. The sheet count uses the coverage saved in Settings.";
  if (key === "subfloor_condition") return "Note flat, uneven, cracks, or a height change. That drives patch and self-leveler.";
  if (key === "prep_scope") return "Use one prep answer for the whole job, or switch to by-room when one room is different.";
  if (key === "furniture_heavy") return "Pianos, pool tables, and loaded cabinets need a note. Add a moving charge only if you have a price for it.";
  if (key === "furniture_level") return "Light, medium, or heavy uses your furniture-moving labor.";
  if (key === "carpet_pad") return "Stretch-in uses pad. Glue-down and carpet tile do not. Extra pad for one area is entered as measured square feet.";
  if (key === "toilets") return "Count toilets to pull and reset. The charge is per toilet.";
  if (key === "appliances") return "Count appliances to disconnect and move, such as a fridge, range, or laundry pair.";
  if (key === "doors_shave") return "Count doors to undercut. The charge is per door.";
  if (key === "hs_prep") return "Choose none, patch, skim, self-level, or grind for this hard-surface floor.";
  if (key === "tile_application") return "Say whether the tile is on the floor or the wall. A backsplash does not need floor tear-out or stair work.";
  if (key === "tile_body") return "Ceramic, porcelain, or natural stone. Stone usually needs a sealer and a different setting method.";
  if (key === "tile_format") return "Tile size affects waste and how flat the floor must be. Large format needs a flatter floor.";
  if (key === "radiant_heat") return "Some pad and hard-surface products cannot go over radiant heat. Note it so purchasing can check the product.";
  if (key === "moisture_mitigation") return "Record whether the slab needs a moisture treatment before hardwood, glue-down, or carpet tile.";
  if (key === "adhesive") return "Glue-down and carpet tile need adhesive from the catalog. Stretch-in and floating floors do not.";
  if (key === "vinyl_skim") return "Embossed vinyl that is staying down often needs a skim coat before the new floor.";
  if (key === "carpet_stairs") return "Waterfall or upholstered is the carpet stair style. Count the steps; do not turn steps into square feet.";
  if (key === "carpet_tile_stairs") return "Note whether carpet tile continues up the stairs.";
  if (key === "carpet_tile_stair_count") return "Count the carpet-tile steps. The charge is per step.";
  if (key === "hs_plank_stairs") return "Hard-surface stairs are treads, risers, and noses, priced each. They are not an automatic square-foot order.";
  if (key === "hs_transitions") return "Doorway transitions are each: T-mold, reducer, end cap, threshold, or metal. Add the catalog pieces on Trims.";
  if (key === "hs_base_trim") return "Base, quarter round, and shoe are linear feet. Add the footage on Trims.";
  if (key === "pattern_match") return "Pattern match and roll direction matter for broadloom. They set seam layout, not a separate charge.";
  if (key === "carpet_direction") return "Note which way the roll should run and where seams should fall.";
  if (key === "pattern_repeat") return "Enter the pattern repeat in inches so purchasing can order enough for the match.";
  if (key === "delivery_scope") return "Note whether this job includes delivery. The delivery charge comes from Settings.";
  if (key === "acclimation") return "Hardwood, glue-down, and carpet tile need time in the space before install.";
  if (key === "construction_grade") return "Above, on, or below grade can limit the product and the adhesive.";
  if (key === "moisture_test") return "Test concrete before glue-down, carpet tile, or hardwood. If you cannot test yet, leave the result blank.";
  if (key === "stair_landings") return "Count landings. They need extra pieces and nosing.";
  if (key === "stair_open_sides") return "Open sides change wrapped carpet ends and hard-surface nosing.";
  if (key === "stairs") return "Stairs change material, labor, and trim. Answer the stair questions for the flooring on those steps.";
  if (key === "asbestos_risk") return "Old tile or sheet vinyl can contain asbestos. Possible or confirmed is a warning for the crew, not a price.";
  if (key === "hs_direction") return "Note which way the planks run. Diagonal layouts usually need more waste.";
  return null;
}

/**
 * The only helper string the Guided Estimate question card may render.
 * Knowledge questions use salesperson copy. Stored help is shown only when
 * it is short and is not rule-engine text.
 */
export function visibleQuestionHelp(q: HelpQuestion, ctx: InstallContext): string | null {
  const copy = salespersonHelpFor(q, ctx);
  if (copy) return copy;
  const stored = (q.help ?? "").trim();
  if (!stored || stored.length > 280 || isInternalRuleCopy(stored)) return null;
  return stored;
}
