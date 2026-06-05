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

// --- Products / Estimates ---------------------------------------------------

export type ProductCategory =
  | "carpet"
  | "lvp"
  | "hardwood"
  | "laminate"
  | "tile"
  | "vinyl"
  | "underlayment"
  | "trim"
  | "labor"
  | "other";

export type EstimateStatus =
  | "draft"
  | "sent"
  | "approved"
  | "declined"
  | "changes_requested";

/** How the customer sees the quote: itemized vs a single lump-sum total. */
export type EstimatePresentation = "detailed" | "summary";

/** How a single estimate line is priced. */
export type LineType = "mat_labor" | "installed" | "flat";

export interface Product {
  id: string;
  name: string;
  category: ProductCategory;
  unit: string;
  material_rate: number;
  labor_rate: number;
  sku: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface EstimateLineItem {
  id: string;
  option_id: string;
  position: number;
  room: string | null;
  description: string;
  line_type: LineType;
  sqft: number | null;
  material_rate: number | null;
  labor_rate: number | null;
  installed_rate: number | null;
  flat_amount: number | null;
  product_id: string | null;
}

export interface EstimateOption {
  id: string;
  estimate_id: string;
  name: string;
  position: number;
  notes: string | null;
  created_at: string;
  line_items?: EstimateLineItem[];
}

export interface Estimate {
  id: string;
  customer_id: string;
  title: string | null;
  status: EstimateStatus;
  presentation: EstimatePresentation;
  tax_rate: number;
  notes: string | null;
  job_description: string | null;
  customer_response_note: string | null;
  accepted_option_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  options?: EstimateOption[];
}

export const PRODUCT_CATEGORY_LABELS: Record<ProductCategory, string> = {
  carpet: "Carpet",
  lvp: "Luxury Vinyl Plank",
  hardwood: "Hardwood",
  laminate: "Laminate",
  tile: "Tile",
  vinyl: "Sheet Vinyl",
  underlayment: "Underlayment",
  trim: "Trim / Molding",
  labor: "Labor",
  other: "Other",
};

export const PRODUCT_CATEGORY_ORDER: ProductCategory[] = [
  "carpet",
  "lvp",
  "hardwood",
  "laminate",
  "tile",
  "vinyl",
  "underlayment",
  "trim",
  "labor",
  "other",
];

export const ESTIMATE_STATUS_LABELS: Record<EstimateStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  approved: "Approved",
  declined: "Declined",
  changes_requested: "Changes Requested",
};

export const ESTIMATE_STATUS_BADGE: Record<EstimateStatus, string> = {
  draft: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  sent: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  approved: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  declined: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  changes_requested:
    "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
};

export const ESTIMATE_PRESENTATION_LABELS: Record<EstimatePresentation, string> = {
  detailed: "Itemized (line by line)",
  summary: "Lump sum (single total)",
};

export const LINE_TYPE_LABELS: Record<LineType, string> = {
  mat_labor: "Material + Labor",
  installed: "Installed / sq ft",
  flat: "Flat amount",
};
