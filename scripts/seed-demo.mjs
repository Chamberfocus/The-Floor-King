// Seed a realistic demo book of business so the app feels alive.
// Run: node scripts/seed-demo.mjs   (reads keys from .env.local)
// Everything created is normal data you can delete from the app anytime.
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

const ADMIN = "0e53e8b1-cde7-488a-bfe8-50fcf164d8a4";
const STAGE = {
  new: "82cc6fbd-d8d9-433f-8778-bd8d57a22e77",
  estScheduled: "0bf5db77-78ea-4f7d-bfb2-23fc749e1082",
  awaitingResp: "1e565923-433a-4a19-807f-b0cb25dc7213",
  ordering: "44b4509c-748f-468b-a38f-5b159b5e4f8a",
  closed: "cc44aadb-e334-4996-8488-29cebfaf04a2",
};

const today = new Date();
const ymd = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => ymd(new Date(today.getTime() - n * 86400000));
const daysAhead = (n) => ymd(new Date(today.getTime() + n * 86400000));

async function ins(table, row) {
  const { data, error } = await db.from(table).insert(row).select("id").single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data.id;
}
async function insMany(table, rows) {
  const { error } = await db.from(table).insert(rows);
  if (error) throw new Error(`${table}[]: ${error.message}`);
}

async function makeCustomer(c) {
  return ins("customers", {
    full_name: c.name,
    company: c.company ?? null,
    email: c.email ?? null,
    phone: c.phone ?? null,
    street: c.street ?? null,
    city: c.city ?? "Cleveland",
    state: "OH",
    zip: c.zip ?? "44111",
    stage: c.leadStage,
    source: c.source,
    notes: "Demo data — safe to delete.",
    assigned_to: ADMIN,
    workflow_stage_id: c.wfStage,
    workflow_owner_id: ADMIN,
    qualified: c.qualified ?? false,
    created_by: ADMIN,
  });
}

// estimate -> option -> line items; returns {estimateId, optionId, subtotal}
async function makeEstimate(customerId, { title, status, lines }) {
  const estimateId = await ins("estimates", {
    customer_id: customerId,
    title,
    status,
    tax_rate: 8.0,
    presentation: "detailed",
    created_by: ADMIN,
  });
  const optionId = await ins("estimate_options", {
    estimate_id: estimateId,
    name: "Option A",
    position: 0,
  });
  let subtotal = 0;
  const rows = lines.map((l, i) => {
    subtotal += l.sqft * (l.material_rate + l.labor_rate);
    return {
      option_id: optionId,
      position: i,
      room: l.room,
      description: l.description,
      line_type: "mat_labor",
      sqft: l.sqft,
      measure_unit: "sqft",
      material_rate: l.material_rate,
      labor_rate: l.labor_rate,
      material_cost: l.material_cost,
      labor_cost: 0,
      category: l.category ?? "carpet",
      unit: "sqft",
    };
  });
  await insMany("estimate_line_items", rows);
  if (status === "approved") {
    await db.from("estimates").update({ accepted_option_id: optionId }).eq("id", estimateId);
  }
  return { estimateId, optionId, subtotal };
}

async function activity(customerId, type, body, when) {
  await ins("activities", {
    customer_id: customerId,
    user_id: ADMIN,
    type,
    body,
    ...(when ? { created_at: when } : {}),
  });
}

async function run() {
  console.log("Clearing any previous demo data…");
  await db
    .from("customers")
    .delete()
    .eq("notes", "Demo data — safe to delete.");

  console.log("Seeding demo data…");

  // 1) New lead
  const maria = await makeCustomer({
    name: "Maria Gonzalez", phone: "216-555-0142", email: "maria.g@example.com",
    street: "1820 W 48th St", zip: "44102", leadStage: "new", source: "google",
    wfStage: STAGE.new,
  });
  await activity(maria, "call", "Called about new carpet for living room + stairs. Wants an estimate this week.");

  // 2) Estimate scheduled
  const tom = await makeCustomer({
    name: "Tom Becker", phone: "440-555-0188", email: "tbecker@example.com",
    street: "342 Mapleway Dr", city: "Lakewood", zip: "44107",
    leadStage: "estimate_scheduled", source: "referral", wfStage: STAGE.estScheduled, qualified: true,
  });
  await ins("appointments", {
    customer_id: tom, salesperson_id: ADMIN, kind: "estimate",
    starts_at: `${daysAhead(2)}T15:00:00Z`, ends_at: `${daysAhead(2)}T16:00:00Z`,
    address: "342 Mapleway Dr, Lakewood, OH 44107", status: "scheduled", created_by: ADMIN,
  });
  await activity(tom, "note", "In-home estimate booked. Looking at LVT for kitchen + hardwood refinish.");

  // 3) Quoted, awaiting response
  const sanderson = await makeCustomer({
    name: "The Sanderson Family", phone: "216-555-0173", email: "sandersons@example.com",
    street: "5571 Stratford Ave", city: "Parma", zip: "44129",
    leadStage: "quoted", source: "facebook", wfStage: STAGE.awaitingResp, qualified: true,
  });
  await makeEstimate(sanderson, {
    title: "Carpet — living room, hall & 3 bedrooms", status: "sent",
    lines: [
      { room: "Living room", description: "Shaw plush carpet + pad", sqft: 320, material_rate: 3.10, labor_rate: 1.25, material_cost: 1.85, category: "carpet" },
      { room: "Hallway + stairs", description: "Carpet w/ takeup", sqft: 180, material_rate: 3.10, labor_rate: 1.75, material_cost: 1.85, category: "carpet" },
      { room: "Bedrooms (3)", description: "Bedroom carpet", sqft: 540, material_rate: 2.65, labor_rate: 1.10, material_cost: 1.55, category: "carpet" },
    ],
  });
  await activity(sanderson, "email", "Quote sent. Following up Friday.");

  // 4) Won — ordering materials (deposit partly paid)
  const brookpark = await makeCustomer({
    name: "Dan Romano", company: "Brookpark Rentals LLC", phone: "216-555-0119", email: "dan@brookparkrentals.com",
    street: "13900 Brookpark Rd", zip: "44135",
    leadStage: "won", source: "repeat", wfStage: STAGE.ordering, qualified: true,
  });
  const bEst = await makeEstimate(brookpark, {
    title: "LVT — 4 rental units", status: "approved",
    lines: [
      { room: "Units 1–4", description: "Luxury vinyl plank, glue-down", sqft: 1600, material_rate: 2.95, labor_rate: 1.40, material_cost: 1.70, category: "lvp" },
    ],
  });
  const bJob = await ins("jobs", {
    customer_id: brookpark, estimate_id: bEst.estimateId, option_id: bEst.optionId,
    title: "LVT — 4 rental units", status: "scheduled", scheduled_date: daysAhead(6),
    assigned_to: ADMIN, site_street: "13900 Brookpark Rd", site_city: "Cleveland",
    site_state: "OH", site_zip: "44135", created_by: ADMIN,
  });
  const bTotal = Math.round(bEst.subtotal * 1.08 * 100) / 100;
  const bInv = await ins("invoices", {
    customer_id: brookpark, job_id: bJob, estimate_id: bEst.estimateId,
    number: "INV-1001", status: "partial", issue_date: daysAgo(5),
    due_date: daysAhead(10), tax_rate: 8.0, created_by: ADMIN,
  });
  await insMany("invoice_items", [
    { invoice_id: bInv, position: 0, description: "LVT — 4 rental units (materials + install)", quantity: 1, unit: "job", rate: bEst.subtotal },
  ]);
  await ins("payments", { invoice_id: bInv, amount: 2500, method: "check", paid_at: daysAgo(4), created_by: ADMIN });
  await activity(brookpark, "note", `Deposit received. Total ~$${bTotal.toLocaleString()}. Ordering LVT, install booked.`);

  // 5) Completed & paid (drives Business Pulse profit this month)
  const jen = await makeCustomer({
    name: "Jennifer Park", phone: "216-555-0150", email: "jpark@example.com",
    street: "2245 Coventry Rd", city: "Cleveland Heights", zip: "44118",
    leadStage: "won", source: "google", wfStage: STAGE.closed, qualified: true,
  });
  const jEst = await makeEstimate(jen, {
    title: "Hardwood — main floor", status: "approved",
    lines: [
      { room: "Main floor", description: "Engineered hardwood, nail-down", sqft: 720, material_rate: 4.85, labor_rate: 2.10, material_cost: 3.05, category: "hardwood" },
    ],
  });
  const jJob = await ins("jobs", {
    customer_id: jen, estimate_id: jEst.estimateId, option_id: jEst.optionId,
    title: "Hardwood — main floor", status: "completed", scheduled_date: daysAgo(8),
    assigned_to: ADMIN, site_street: "2245 Coventry Rd", site_city: "Cleveland Heights",
    site_state: "OH", site_zip: "44118", created_by: ADMIN,
  });
  const jInv = await ins("invoices", {
    customer_id: jen, job_id: jJob, estimate_id: jEst.estimateId,
    number: "INV-1002", status: "paid", issue_date: daysAgo(7),
    due_date: daysAgo(7), tax_rate: 8.0, created_by: ADMIN,
  });
  await insMany("invoice_items", [
    { invoice_id: jInv, position: 0, description: "Engineered hardwood — main floor (materials + install)", quantity: 1, unit: "job", rate: jEst.subtotal },
  ]);
  await ins("payments", { invoice_id: jInv, amount: Math.round(jEst.subtotal * 100) / 100, method: "card", paid_at: daysAgo(6), created_by: ADMIN });
  await ins("job_labor", { job_id: jJob, payee: "Mike's crew", basis: "flat", amount: 1300, paid: true, paid_on: daysAgo(5), created_by: ADMIN });
  await activity(jen, "note", "Install complete. Customer thrilled — asked for a Google review link.");
  await activity(jen, "system", "Job closed. Paid in full.");

  console.log("✅ Done. Created 5 customers across the pipeline with estimates, jobs, invoices, payments, an appointment, and crew pay.");
  console.log("   New lead, estimate scheduled, quote sent, materials/deposit, and a completed+paid job.");
}

run().catch((e) => {
  console.error("Seed failed:", e.message);
  process.exit(1);
});
