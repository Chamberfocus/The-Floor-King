import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_QUESTIONS,
  SALESPERSON_COUNT_QTY_HINT,
  SALESPERSON_COUNT_TBD_HINT,
  SALESPERSON_MEASURED_HINT,
  emptyInstallContext,
  isInternalRuleCopy,
  knowledgeHelpFor,
  salespersonHelpFor,
  visibleQuestionHelp,
  type InstallContext,
} from "@/lib/flooring-knowledge";

const root = join(__dirname, "../..");

const POISONED_HELP =
  "Builder hydrate does not plant How many as taped sq ft on wrap / carton-coverage TBD / qty TBD. " +
  "Customer / portal / print strip stored job_description. Field verify / TBD vs Known. " +
  "PO / warehouse / work-order carton math. leftover taped sq ft. Unit TBD.";

function assertSalespersonCopy(text: string | null) {
  expect(text === null || text.length > 0).toBe(true);
  if (!text) return;
  expect(text.length).toBeLessThanOrEqual(280);
  expect(isInternalRuleCopy(text)).toBe(false);
  expect(text).not.toMatch(/hydrate|leftover|job_description|carton-coverage|Unit TBD|qty TBD/i);
}

describe("Guided Estimate visible helper copy", () => {
  const contexts: InstallContext[] = [
    emptyInstallContext(),
    { ...emptyInstallContext(), families: ["carpet"], projectTypes: ["Carpet"] },
    { ...emptyInstallContext(), families: ["tile"] },
    { ...emptyInstallContext(), families: ["lvp", "hardwood"] },
    { ...emptyInstallContext(), families: ["laminate"] },
    { ...emptyInstallContext(), families: ["vinyl"] },
    { ...emptyInstallContext(), families: ["hardwood"], hardwoodConstruction: "engineered" },
    { ...emptyInstallContext(), families: ["hardwood"], hardwoodConstruction: "solid" },
    { ...emptyInstallContext(), families: ["lvp"], systems: ["loose_lay"] },
    {
      ...emptyInstallContext(),
      families: ["carpet"],
      answeredCarpetInstall: ["Carpet tile"],
    },
  ];

  it("keeps internal rule notes off every knowledge question", () => {
    for (const ctx of contexts) {
      for (const question of KNOWLEDGE_QUESTIONS) {
        assertSalespersonCopy(
          visibleQuestionHelp({ ...question, help: POISONED_HELP, kind: "yesno" }, ctx),
        );
      }
      for (const kind of ["areas", "floor_map", "cuts"] as const) {
        assertSalespersonCopy(
          visibleQuestionHelp({ kind, help: POISONED_HELP, config: { category: "vinyl" } }, ctx),
        );
        assertSalespersonCopy(visibleQuestionHelp({ kind, help: POISONED_HELP }, ctx));
      }
    }
  });

  it("shows carpet cut guidance and ignores poisoned stored help", () => {
    const copy = visibleQuestionHelp(
      { key: "carpet_cuts", kind: "cuts", help: POISONED_HELP },
      emptyInstallContext(),
    );
    expect(copy).toBe(
      "Enter each carpet cut using the required length and roll width. Order quantity is calculated from the cuts, not from the room's measured square footage.",
    );
  });

  it("keeps the rule engine notes, unrendered", () => {
    const tile = {
      ...emptyInstallContext(),
      answeredCarpetInstall: ["Carpet tile"],
    };
    expect(knowledgeHelpFor({ kind: "cuts" }, emptyInstallContext())).toMatch(/leftover sq ft/);
    expect(knowledgeHelpFor({ kind: "cuts" }, tile)).toMatch(/Builder hydrate/);
    expect(knowledgeHelpFor({ kind: "cuts" }, tile)).toMatch(/job_description/);
    expect(salespersonHelpFor({ kind: "cuts" }, emptyInstallContext())).not.toMatch(/hydrate/);
    expect(salespersonHelpFor({ kind: "cuts" }, tile)).not.toMatch(/hydrate/);
  });

  it("still shows a short custom hint that is not rule metadata", () => {
    expect(
      visibleQuestionHelp(
        { key: "office_custom", help: "Ask which rooms the customer wants done first." },
        emptyInstallContext(),
      ),
    ).toBe("Ask which rooms the customer wants done first.");
    expect(
      visibleQuestionHelp({ key: "office_custom", help: POISONED_HELP }, emptyInstallContext()),
    ).toBeNull();
  });

  it("uses plain hints for measured area and count fields", () => {
    for (const hint of [
      SALESPERSON_MEASURED_HINT,
      SALESPERSON_COUNT_TBD_HINT,
      SALESPERSON_COUNT_QTY_HINT,
    ]) {
      assertSalespersonCopy(hint);
    }
  });

  it("does not render stored help or knowledgeHelpFor on the question card", () => {
    const q = readFileSync(join(root, "src/app/(app)/estimates/questionnaire.tsx"), "utf8");
    expect(q).toMatch(/visibleQuestionHelp\(q, flooringCtx\)/);
    expect(q).not.toMatch(/\{q\.help/);
    expect(q).not.toMatch(/knowledgeHelpFor\(/);
    expect(q).not.toMatch(/\(not How many boxes from leftover taped sq ft\)/);
    expect(q).not.toMatch(/Order TBD — carton coverage TBD/);
  });
});
