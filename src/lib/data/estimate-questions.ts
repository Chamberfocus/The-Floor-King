import { createClient } from "@/lib/supabase/server";
import type {
  EstimateQuestion,
  EstimateQuestionConfig,
  EstimateQuestionKind,
} from "@/lib/types";

/** Coerce a raw DB row into a typed question (config is jsonb). */
function rowToQuestion(r: Record<string, unknown>): EstimateQuestion {
  const config = (r.config ?? {}) as EstimateQuestionConfig;
  return {
    id: r.id as string,
    section: (r.section as string) || "Carpet",
    label: (r.label as string) || "",
    help: (r.help as string) ?? null,
    kind: ((r.kind as string) || "yesno") as EstimateQuestionKind,
    config: config && typeof config === "object" ? config : {},
    required: Boolean(r.required),
    active: r.active !== false,
    position: Number(r.position) || 0,
    created_at: (r.created_at as string) ?? "",
  };
}

/**
 * Load the estimate questionnaire (ordered by section then position). Returns []
 * if the table isn't there yet, so the app still builds before the migration.
 */
export async function listEstimateQuestions(
  opts: { activeOnly?: boolean } = {},
): Promise<EstimateQuestion[]> {
  const supabase = await createClient();
  let q = supabase
    .from("estimate_questions")
    .select("*")
    .order("position", { ascending: true });
  if (opts.activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) return [];
  return (data ?? []).map((r) => rowToQuestion(r as Record<string, unknown>));
}

export async function getEstimateQuestion(
  id: string,
): Promise<EstimateQuestion | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("estimate_questions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data ? rowToQuestion(data as Record<string, unknown>) : null;
}
