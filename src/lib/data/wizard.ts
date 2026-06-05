import { createClient } from "@/lib/supabase/server";
import type { WizardQuestion } from "@/lib/types";

export async function listWizardQuestions(
  opts: { activeOnly?: boolean } = {},
): Promise<WizardQuestion[]> {
  const supabase = await createClient();
  let query = supabase
    .from("wizard_questions")
    .select("*")
    .order("position", { ascending: true });
  if (opts.activeOnly) query = query.eq("active", true);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as WizardQuestion[];
}

export async function getWizardQuestion(
  id: string,
): Promise<WizardQuestion | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("wizard_questions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as WizardQuestion) ?? null;
}
