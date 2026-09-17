/**
 * Turn a questionnaire answer into the strings `show_if` / overlay read.
 *
 * Stair kinds are not yes/no. A count > 0 means the job has stairs — that
 * is the "Yes" the landings / open-sides questions were written against
 * before the old `stairs` yes/no was folded into the stair-type steps.
 */

export type GateAnswer = {
  kind: string;
  yes?: boolean;
  selected?: string[];
  rows?: { option?: string }[];
  text?: string;
  product?: { label?: string } | null;
  value?: string;
  groups?: { type?: string; count?: string }[];
  steps?: string;
};

function positiveCount(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : 0;
}

/** Values a keyed answer contributes to `valByKey`. */
export function answerGateValues(a: unknown): string[] {
  if (!a || typeof a !== "object") return [];
  const ans = a as GateAnswer;
  switch (ans.kind) {
    case "yesno":
      return [ans.yes ? "Yes" : "No"];
    case "choice":
      return ans.selected ?? [];
    case "choice_areas":
      return (ans.rows ?? []).map((r) => r.option).filter((x): x is string => !!x);
    case "text": {
      const t = (ans.text ?? "").trim();
      return t ? [t] : [];
    }
    case "product":
      return ans.product?.label ? [ans.product.label] : [];
    case "number": {
      const t = (ans.value ?? "").trim();
      return t ? [t] : [];
    }
    case "stairs": {
      const groups = ans.groups ?? [];
      const active = groups.filter((g) => positiveCount(g.count) > 0);
      if (!active.length) return [];
      const types = [...new Set(active.map((g) => g.type).filter((t): t is string => !!t))];
      return ["Yes", ...types];
    }
    case "hs_stairs":
      return positiveCount(ans.steps) > 0 ? ["Yes"] : [];
    default:
      return [];
  }
}

const STAIR_SOURCE_KEYS = ["stairs", "carpet_stairs", "hs_plank_stairs"] as const;

/**
 * The live stair questions are keyed `carpet_stairs` / `hs_plank_stairs`.
 * Landings and open-sides still (and after 0196, also) look for `stairs=Yes`.
 * Copy Yes onto `stairs` so those follow-ups actually appear.
 */
export function synthesizeStairGate(valByKey: Record<string, string[]>): Record<string, string[]> {
  const hasStairs = STAIR_SOURCE_KEYS.some((k) => (valByKey[k] ?? []).includes("Yes"));
  if (!hasStairs) return valByKey;
  const cur = valByKey.stairs ?? [];
  if (cur.includes("Yes")) return valByKey;
  return { ...valByKey, stairs: [...cur, "Yes"] };
}
