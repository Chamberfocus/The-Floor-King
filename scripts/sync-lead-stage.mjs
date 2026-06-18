// One-time backfill: bring every customer's legacy `stage` (lead_stage) into
// lock-step with their workflow stage, so the pipeline board / leads list /
// dashboard counts are accurate immediately (going forward they auto-sync).
// Run: node scripts/sync-lead-stage.mjs   (reads keys from .env.local)
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Mirror of deriveLeadStage() in src/lib/workflow-engine.ts.
function deriveLeadStage(target, all) {
  const name = (target.name ?? "").toLowerCase();
  if (/lost|declin|dead|cancel/.test(name)) return "lost";
  const posOf = (aa) => {
    const s = all.find((x) => x.auto_action === aa);
    return s ? s.position : null;
  };
  const deposit = posOf("collect_deposit");
  const quote = posOf("build_quote");
  const estSched = posOf("schedule_estimate");
  if (deposit != null && target.position >= deposit) return "won";
  if (quote != null && target.position >= quote) return "quoted";
  if (estSched != null && target.position >= estSched) return "estimate_scheduled";
  const positions = all.map((s) => s.position);
  const minPos = positions.length ? Math.min(...positions) : target.position;
  return target.position <= minPos ? "new" : "contacted";
}

const { data: stages } = await db
  .from("workflow_stages")
  .select("id, name, position, auto_action");
const byId = new Map((stages ?? []).map((s) => [s.id, s]));

const { data: customers } = await db
  .from("customers")
  .select("id, full_name, stage, workflow_stage_id, cancelled_at");

let updated = 0;
let skipped = 0;
for (const c of customers ?? []) {
  if (c.cancelled_at) {
    skipped++;
    continue; // cancelled stays "lost"
  }
  if (!c.workflow_stage_id) {
    skipped++;
    continue; // unstaged — leave the lead_stage as-is
  }
  const ws = byId.get(c.workflow_stage_id);
  if (!ws) {
    skipped++;
    continue;
  }
  const derived = deriveLeadStage(ws, stages ?? []);
  if (derived === c.stage) {
    skipped++;
    continue;
  }
  const { error } = await db.from("customers").update({ stage: derived }).eq("id", c.id);
  if (error) {
    console.log(`  ! ${c.full_name}: ${error.message}`);
  } else {
    console.log(`  ${c.full_name}: ${c.stage} → ${derived}  (${ws.name})`);
    updated++;
  }
}

console.log(`\nDone. ${updated} updated, ${skipped} unchanged/skipped.`);
