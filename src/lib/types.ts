/** Roles that govern what a signed-in user can see and do. */
export type UserRole = "admin" | "office" | "crew" | "customer";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: UserRole;
  created_at: string;
}

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrator",
  office: "Office Staff",
  crew: "Field Crew",
  customer: "Customer",
};

// --- Leads & Customers ------------------------------------------------------

export type LeadStage =
  | "new"
  | "contacted"
  | "estimate_scheduled"
  | "quoted"
  | "won"
  | "lost";

export type LeadSource =
  | "referral"
  | "google"
  | "website"
  | "angi"
  | "facebook"
  | "repeat"
  | "walk_in"
  | "other";

export type ActivityType =
  | "note"
  | "call"
  | "text"
  | "email"
  | "stage_change"
  | "system";

export interface Customer {
  id: string;
  full_name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  stage: LeadStage;
  source: LeadSource | null;
  notes: string | null;
  assigned_to: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: string;
  customer_id: string;
  user_id: string | null;
  type: ActivityType;
  body: string | null;
  created_at: string;
}

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  new: "New",
  contacted: "Contacted",
  estimate_scheduled: "Estimate Scheduled",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
};

/** Display order for the pipeline board / dropdowns. */
export const LEAD_STAGE_ORDER: LeadStage[] = [
  "new",
  "contacted",
  "estimate_scheduled",
  "quoted",
  "won",
  "lost",
];

/** Tailwind classes for each stage's badge. */
export const LEAD_STAGE_BADGE: Record<LeadStage, string> = {
  new: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  contacted: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  estimate_scheduled:
    "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300",
  quoted: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-300",
  won: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  lost: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
};

/** Stages still "in play" (an open lead, not yet won/lost). */
export const OPEN_STAGES: LeadStage[] = [
  "new",
  "contacted",
  "estimate_scheduled",
  "quoted",
];

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  referral: "Referral",
  google: "Google / Search",
  website: "Website",
  angi: "Angi / HomeAdvisor",
  facebook: "Facebook",
  repeat: "Repeat Customer",
  walk_in: "Walk-in",
  other: "Other",
};
