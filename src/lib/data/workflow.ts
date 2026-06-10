import { createClient } from "@/lib/supabase/server";
import type { Handoff, WorkflowStage } from "@/lib/types";

export async function listWorkflowStages(): Promise<WorkflowStage[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("workflow_stages")
    .select("*")
    .order("position", { ascending: true });
  return (data ?? []) as WorkflowStage[];
}

export interface HandoffMember {
  id: string;
  name: string;
  title: string | null;
  role: string;
}

export async function listHandoffMembers(): Promise<HandoffMember[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email, title, role")
    .in("role", [
      "admin",
      "office",
      "sales_manager",
      "salesman",
      "scheduler",
      "crew",
      "warehouse",
    ])
    .order("full_name", { ascending: true });
  const rows = (data ?? []) as {
    id: string;
    full_name: string | null;
    email: string;
    title: string | null;
    role: string;
  }[];
  return rows.map((p) => ({
    id: p.id,
    name: p.full_name || p.email,
    title: p.title,
    role: p.role,
  }));
}

export interface HandoffWithNames extends Handoff {
  to_name: string | null;
  to_stage_name: string | null;
}

export async function listHandoffs(
  customerId: string,
): Promise<HandoffWithNames[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("handoffs")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(10);
  const rows = (data ?? []) as Handoff[];
  if (!rows.length) return [];

  const userIds = [...new Set(rows.map((r) => r.to_user).filter(Boolean))] as string[];
  const stageIds = [
    ...new Set(rows.map((r) => r.to_stage_id).filter(Boolean)),
  ] as string[];

  const nameById = new Map<string, string>();
  if (userIds.length) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", userIds);
    for (const p of profs ?? [])
      nameById.set(p.id as string, (p.full_name as string) || (p.email as string));
  }
  const stageById = new Map<string, string>();
  if (stageIds.length) {
    const { data: stages } = await supabase
      .from("workflow_stages")
      .select("id, name")
      .in("id", stageIds);
    for (const s of stages ?? [])
      stageById.set(s.id as string, s.name as string);
  }

  return rows.map((r) => ({
    ...r,
    to_name: r.to_user ? (nameById.get(r.to_user) ?? null) : null,
    to_stage_name: r.to_stage_id ? (stageById.get(r.to_stage_id) ?? null) : null,
  }));
}
