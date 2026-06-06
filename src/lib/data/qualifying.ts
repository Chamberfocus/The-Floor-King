import { createClient } from "@/lib/supabase/server";
import type { QualifyingQuestion } from "@/lib/types";

export async function listQualifyingQuestions(
  opts: { activeOnly?: boolean } = {},
): Promise<QualifyingQuestion[]> {
  const supabase = await createClient();
  let query = supabase
    .from("qualifying_questions")
    .select("*")
    .order("position", { ascending: true });
  if (opts.activeOnly) query = query.eq("active", true);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as QualifyingQuestion[];
}

export async function getQualifyingQuestion(
  id: string,
): Promise<QualifyingQuestion | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("qualifying_questions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as QualifyingQuestion) ?? null;
}
