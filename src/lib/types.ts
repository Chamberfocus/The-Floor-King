/** Roles that govern what a signed-in user can see and do. */
export type UserRole =
  | "admin"
  | "office"
  | "sales_manager"
  | "salesman"
  | "scheduler"
  | "crew"
  | "warehouse"
  | "customer";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  title: string | null;
  role: UserRole;
  customer_id: string | null;
  created_at: string;
}

export interface OrgSettings {
  id: string;
  company_name: string;
  logo_url: string | null;
  primary_color: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  financing_url: string | null;
  google_review_url: string | null;
  fuel_surcharge_pct: number;
  freight_markup_pct: number; // single all-in freight & fees markup on material cost
  quote_valid_days: number;
  freight_disclaimer: string | null;
  updated_at: string;
}

export type SupplierKind = "manufacturer" | "distributor";

export const SUPPLIER_KIND_LABELS: Record<SupplierKind, string> = {
  manufacturer: "Manufacturer",
  distributor: "Distributor",
};

export interface Supplier {
  id: string;
  name: string;
  kind: SupplierKind;
  freight_pct: number;
  freight_per_unit: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SchedulingSettings {
  id: string;
  work_days: string; // "1,2,3,4,5,6" (0=Sun..6=Sat)
  day_start: string;
  day_end: string;
  estimate_duration_min: number;
  travel_buffer_min: number;
  cap_carpet_yd: number;
  cap_lvt_sf: number;
  cap_laminate_sf: number;
  cap_hardwood_sf: number;
  cap_tile_teardown_sf: number;
  cap_subfloor_sheets: number;
  cap_selflevel_sf: number;
  default_origin: string | null;
  arrival_windows: string; // "HH:MM-HH:MM,HH:MM-HH:MM" customizable arrival windows
  updated_at: string;
}

export interface CustomerDocument {
  id: string;
  customer_id: string | null;
  po_id: string | null;
  uploaded_by: string | null;
  name: string;
  path: string;
  mime: string | null;
  kind: string;
  created_at: string;
  url?: string | null;
}

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrator",
  office: "Office Staff",
  sales_manager: "Sales Manager",
  salesman: "Salesman",
  scheduler: "Scheduler",
  crew: "Installer",
  warehouse: "Warehouse",
  customer: "Customer",
};

/**
 * Job-duty pools — which roles do which work. Used to scope people-pickers so a
 * search only offers people whose duty fits the task (e.g. only salespeople
 * appear when picking the rep for an estimate, not crew/warehouse).
 */
export const SALES_ROLES: UserRole[] = [
  "admin",
  "office",
  "sales_manager",
  "salesman",
];
export const INSTALL_ROLES: UserRole[] = ["admin", "crew"];
export const SCHEDULER_ROLES: UserRole[] = ["admin", "office", "scheduler"];
/** Who sees the Team Schedule / work-days board — office, sales, warehouse,
 *  admin. Installers (crew) are excluded. */
export const SCHEDULE_ROLES: UserRole[] = [
  "admin",
  "office",
  "sales_manager",
  "salesman",
  "warehouse",
];

/** A workflow stage can declare which DUTY owns it; the owner-picker for that
 *  stage then only offers people with that duty. Empty = anyone. */
export const DUTY_ROLES: Record<string, UserRole[]> = {
  sales: SALES_ROLES,
  install: INSTALL_ROLES,
  schedule: SCHEDULER_ROLES,
  office: ["admin", "office"],
  warehouse: ["admin", "warehouse"],
};
export const DUTY_LABELS: Record<string, string> = {
  sales: "Salesperson",
  install: "Installer / crew",
  schedule: "Scheduler",
  office: "Office",
  warehouse: "Warehouse",
};

/**
 * Infer which job-duty owns a stage from its auto-action (then its name), so an
 * owner/assignee picker can offer only the right people even when a stage has no
 * duty explicitly configured. Returns a DUTY_ROLES key, or null for "anyone".
 * (e.g. booking an estimate → sales; scheduling an install → crew.)
 */
export function inferStageDuty(
  stage: { auto_action?: string | null; name?: string | null } | null,
): keyof typeof DUTY_ROLES | null {
  if (!stage) return null;
  switch (stage.auto_action) {
    case "schedule_estimate":
    case "build_quote":
    case "collect_deposit":
      return "sales";
    case "schedule_install":
      return "install";
  }
  const name = (stage.name ?? "").toLowerCase();
  if (/material|warehouse|stag|order/.test(name)) return "warehouse";
  if (/install/.test(name)) return "install";
  if (/estimate|quote|deposit|sale/.test(name)) return "sales";
  return null;
}

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
  workflow_stage_id: string | null;
  workflow_owner_id: string | null;
  next_action_due: string | null;
  qualified: boolean | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  // Geocode + cached property data (house value & details).
  latitude?: number | null;
  longitude?: number | null;
  property_value?: number | null;
  property_beds?: number | null;
  property_baths?: number | null;
  property_sqft?: number | null;
  property_year?: number | null;
  property_type?: string | null;
  property_checked_at?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface QualifyingQuestion {
  id: string;
  label: string;
  help: string | null;
  section: string;
  options: string[] | null;
  required: boolean;
  position: number;
  active: boolean;
  created_at: string;
}

export interface Activity {
  id: string;
  customer_id: string;
  user_id: string | null;
  type: ActivityType;
  body: string | null;
  created_at: string;
}

// --- Data-driven estimate questionnaire ------------------------------------
// Questions live in `estimate_questions` and are managed in Settings. Each
// question's `kind` decides how it's answered; `config` decides how the answer
// maps into estimate line items (so the flow + pricing are code-free to edit).
export type EstimateQuestionKind =
  | "areas" // list rooms with measurements → the area that feeds quantities
  | "floor_map" // assign a flooring product to each measured room (mixed jobs)
  | "product" // pick a catalog product → a material line (unit-correct)
  | "yesno" // toggle → optionally emit one line
  | "number" // a count/amount → qty × rate line (optional rate choices)
  | "choice" // single/multi choice → each picked option can emit a line
  | "text"; // free note → appended to the job notes

/** How one answer (or one chosen option) becomes a line item. */
export interface EstimateEmit {
  role: "material" | "labor"; // material → PO-eligible; labor → work order
  category: string; // ProductCategory for material, "labor" for labor
  description: string; // the line label on the estimate
  unit: string; // "sqft" | "sqyd" | "lnft" | "each" | "step" | "flat"
  per?: "area" | "flat" | "each"; // area → qty from measurements; else qty = 1
  cost: number; // our per-unit cost (sells at the target margin)
}

export interface EstimateQuestionConfig {
  // product
  category?: string; // catalog category to bias the picker + billing unit
  ask_source?: boolean; // ask Stock vs Order (+ vendor) for this material
  allow_additional?: boolean; // let one step add extra products for specific areas
  // yesno / number / choice
  emit?: EstimateEmit | null;
  default?: boolean; // yesno: preselect Yes
  rate_options?: { label: string; cost: number }[]; // number: pick the rate
  multi?: boolean; // choice: allow multiple
  options?: { label: string; emit?: EstimateEmit | null }[]; // choice options
  note?: boolean; // record the answer as a job condition on the work order
  // Conditional visibility: show this question only when the answer to the
  // question with `show_if.key` is one of `show_if.in`. Absent = always shown.
  show_if?: { key: string; in: string[] } | null;
  // Per-room prep: answered once as the job default, with per-room overrides for
  // rooms flagged as "different prep" in the areas step.
  per_room?: boolean;
  // A choice step where each selected option is repeated with its own area
  // (e.g. multiple demo types, each with the sq ft it covers).
  per_area?: boolean;
  // A product step rendered as a repeatable list of trims/moldings — each a real
  // product with its own quantity, unit and stock/order source.
  trim_list?: boolean;
}

export interface EstimateQuestion {
  id: string;
  section: string;
  label: string;
  help: string | null;
  kind: EstimateQuestionKind;
  config: EstimateQuestionConfig;
  key: string | null; // stable slug for conditional references (show_if)
  required: boolean;
  active: boolean;
  position: number;
  created_at: string;
}

/** A saved room/area measurement for a customer (drives the sq ft calculator
 *  and the customer's Areas & measurements card). */
export interface CustomerArea {
  id: string;
  customer_id: string;
  position: number;
  name: string;
  length_in: number | null;
  width_in: number | null;
  sqft: number | null;
  note: string | null;
  differs: boolean; // needs different prep than the job default
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

/** Whether a line is measured/priced by square foot or square yard (carpet). */
export type MeasureUnit = "sqft" | "sqyd";

export const MEASURE_UNIT_LABELS: Record<MeasureUnit, string> = {
  sqft: "sq ft",
  sqyd: "sq yd",
};

export interface Product {
  id: string;
  name: string;
  category: ProductCategory;
  unit: string;
  material_rate: number;
  labor_rate: number;
  sku: string | null;
  manufacturer: string | null;
  style: string | null;
  color: string | null;
  supplier: string | null;
  supplier_id: string | null;
  notes: string | null;
  active: boolean;
  track_stock: boolean;
  on_hand: number;
  on_order?: number; // placed on a stock PO, not yet received
  reorder_point: number;
  bin_location: string | null;
  stock_kind?: StockKind; // discrete (counted) | rolled (measured)
  reserved?: number;
  clearance: boolean;
  clearance_price: number | null;
  last_movement_at: string | null;
  created_at: string;
  updated_at: string;
}

export type StockKind = "discrete" | "rolled";

export type StockMovementKind =
  | "receive"
  | "pull"
  | "adjust"
  | "return"
  | "reserve"
  | "release";

export const STOCK_MOVEMENT_LABELS: Record<string, string> = {
  receive: "Received",
  pull: "Pulled / cut for job",
  adjust: "Adjustment",
  return: "Returned to stock",
  reserve: "Reserved for job",
  release: "Reservation released",
};

export interface StockMovement {
  id: string;
  product_id: string;
  qty: number;
  kind: string;
  job_id: string | null;
  customer_id: string | null;
  roll_id?: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

/** A physical roll OR a remnant (offcut) of a rolled product. */
export interface StockRoll {
  id: string;
  product_id: string;
  kind: "roll" | "remnant";
  unit: string; // sqyd | lnft
  width_ft: number | null;
  initial_qty: number;
  remaining_qty: number;
  location: string | null;
  status: "available" | "depleted" | "scrapped";
  usable: boolean | null;
  needs_shelving: boolean;
  source_roll_id: string | null;
  source_po_id: string | null;
  job_id: string | null;
  scrap_reason: string | null;
  note: string | null;
  created_by: string | null;
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
  length_in: number | null;
  width_in: number | null;
  measure_unit: MeasureUnit;
  material_rate: number | null;
  labor_rate: number | null;
  installed_rate: number | null;
  flat_amount: number | null;
  waste_pct: number | null;
  product_id: string | null;
  manufacturer: string | null;
  style: string | null;
  color: string | null;
  item_no: string | null;
  material_cost: number | null;
  labor_cost: number | null;
  quantity: number | null;
  unit: string | null;
  category: ProductCategory | null;
  from_stock?: boolean; // pulled from our stock → excluded from the PO
  margin_pct?: number | null; // per-line margin override (%); null = follow overall
  order_as_roll?: boolean; // PO shows one roll; work order keeps the cut sizes
  roll_width_ft?: number | null; // broadloom width (12 / 15) for the roll math
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
  discount_kind: "amount" | "percent";
  discount_value: number;
  target_margin: number | null; // estimate-wide gross-margin default (%)
  notes: string | null;
  job_description: string | null;
  customer_response_note: string | null;
  valid_until: string | null;
  sent_at: string | null;
  thankyou_sent_at: string | null;
  viewed_at: string | null;
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

// --- Estimate Wizard (configurable questions) -------------------------------

export type WizardQuestionKind = "detail" | "addon";
export type WizardQuestionInput = "text" | "yesno" | "number";

export interface WizardQuestion {
  id: string;
  label: string;
  help: string | null;
  kind: WizardQuestionKind;
  input: WizardQuestionInput;
  options: string[] | null;
  section: string;
  required: boolean;
  default_amount: number | null;
  position: number;
  active: boolean;
  created_at: string;
}

/** Canonical journey order for wizard sections; unknown sections sort last. */
export const WIZARD_SECTIONS: string[] = [
  "The customer & project",
  "The space",
  "Existing floor & subfloor",
  "Product & style",
  "Installation logistics",
  "Add-ons & extras",
  "Job details",
];

export function wizardSectionRank(section: string): number {
  const i = WIZARD_SECTIONS.indexOf(section);
  return i === -1 ? WIZARD_SECTIONS.length : i;
}

export const WIZARD_KIND_LABELS: Record<WizardQuestionKind, string> = {
  detail: "Detail (adds to job description)",
  addon: "Add-on (adds a line item)",
};

export const WIZARD_INPUT_LABELS: Record<WizardQuestionInput, string> = {
  text: "Text",
  yesno: "Yes / No",
  number: "Number",
};

// --- Jobs & Work Orders -----------------------------------------------------

export type JobStatus =
  | "unscheduled"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface ServiceAddress {
  id: string;
  customer_id: string;
  label: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** One line: "Label — 123 Main St, City ST 00000" (label optional). */
export function formatServiceAddress(a: {
  label?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string {
  const line = [a.street, [a.city, a.state].filter(Boolean).join(", "), a.zip]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (a.label && line) return `${a.label} — ${line}`;
  return a.label || line || "Address";
}

export interface Job {
  id: string;
  customer_id: string;
  estimate_id: string | null;
  option_id: string | null;
  service_address_id?: string | null;
  title: string | null;
  migrated?: boolean; // carried over from prior system at go-live
  status: JobStatus;
  scheduled_date: string | null;
  scheduled_end: string | null;
  arrival_window?: string | null; // install arrival window "HH:MM-HH:MM" (migration 0066)
  assigned_to: string | null;
  assigned_crew_id?: string | null; // managed install crew (parallel to assigned_to)
  site_street: string | null;
  site_city: string | null;
  site_state: string | null;
  site_zip: string | null;
  notes: string | null;
  delivery_type: JobDeliveryType;
  warehouse_status: WarehouseStatus;
  // Warehouse staging lifecycle (migration 0060)
  warehouse_submitted_at?: string | null;
  warehouse_assigned_to?: string | null;
  warehouse_accepted_at?: string | null;
  warehouse_ack_at?: string | null;
  staging_location?: string | null;
  warehouse_ready_at?: string | null;
  open_for_claim: boolean;
  // Job-board target (migration 0088): when you want it done + expected days.
  board_wanted_start?: string | null;
  board_wanted_end?: string | null;
  board_expected_days?: number | null;
  reminder_sent_at: string | null;
  show_prices?: boolean; // show prices on this work order
  installer_collects_balance?: boolean | null; // per-job override; null = inherit global
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type JobDeliveryType =
  | "cash_carry"
  | "deliver"
  | "installer_pickup"
  | "deliver_acclimate";
export type WarehouseStatus =
  | "pending"
  | "staged"
  | "out_for_delivery"
  | "delivered"
  | "picked_up";
export type JobApplicationStatus = "applied" | "accepted" | "declined";

export interface JobApplication {
  id: string;
  job_id: string;
  installer_id: string;
  status: JobApplicationStatus;
  note: string | null;
  created_at: string;
}

export const JOB_DELIVERY_LABELS: Record<JobDeliveryType, string> = {
  deliver: "Deliver to site",
  installer_pickup: "Installer pick-up",
  deliver_acclimate: "Deliver for acclimation",
  cash_carry: "Cash & Carry",
};

export const WAREHOUSE_STATUS_LABELS: Record<WarehouseStatus, string> = {
  pending: "Not started",
  staged: "Staged",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  picked_up: "Picked up",
};

export const WAREHOUSE_STATUS_ORDER: WarehouseStatus[] = [
  "pending",
  "staged",
  "out_for_delivery",
  "delivered",
  "picked_up",
];

export const WAREHOUSE_STATUS_BADGE: Record<WarehouseStatus, string> = {
  pending: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  staged: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  out_for_delivery:
    "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  delivered: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  picked_up: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
};

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  unscheduled: "Unscheduled",
  scheduled: "Scheduled",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const JOB_STATUS_ORDER: JobStatus[] = [
  "unscheduled",
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
];

export const JOB_STATUS_BADGE: Record<JobStatus, string> = {
  unscheduled: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  in_progress:
    "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  completed: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  cancelled: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
};

// --- Purchase Orders --------------------------------------------------------

export type PoStatus = "draft" | "ordered" | "received" | "cancelled";

export interface PoItem {
  id: string;
  po_id: string;
  product_id: string | null;
  position: number;
  description: string;
  quantity: number | null;
  unit: string;
  unit_cost: number | null;
  manufacturer: string | null;
  style: string | null;
  color: string | null;
  item_no: string | null;
}

// Where a PO's materials come from. Manufacturer/Distributor = an outside order;
// "stock" = pulled from our own inventory.
export type PoSourceType = "manufacturer" | "distributor" | "stock";

export const PO_SOURCE_LABELS: Record<PoSourceType, string> = {
  manufacturer: "Manufacturer",
  distributor: "Distributor",
  stock: "From stock",
};

export const PO_SOURCE_BADGE: Record<PoSourceType, string> = {
  manufacturer: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  distributor: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  stock: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
};

export interface PurchaseOrder {
  id: string;
  customer_id: string | null;
  estimate_id: string | null;
  job_id: string | null;
  supplier: string | null;
  supplier_id: string | null;
  source_type: PoSourceType | null;
  status: PoStatus;
  notes: string | null;
  eta_date: string | null;
  backordered: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  items?: PoItem[];
}

export const PO_STATUS_LABELS: Record<PoStatus, string> = {
  draft: "Draft",
  ordered: "Ordered",
  received: "Received",
  cancelled: "Cancelled",
};

export const PO_STATUS_ORDER: PoStatus[] = [
  "draft",
  "ordered",
  "received",
  "cancelled",
];

export const PO_STATUS_BADGE: Record<PoStatus, string> = {
  draft: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  ordered: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  received: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  cancelled: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
};

// --- Client orders (cash-and-carry / pickup) --------------------------------

export type OrderStatus = "submitted" | "approved" | "declined" | "cancelled";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  submitted: "Needs review",
  approved: "Approved",
  declined: "Declined",
  cancelled: "Cancelled",
};

export const ORDER_STATUS_BADGE: Record<OrderStatus, string> = {
  submitted: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  approved: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  declined: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  cancelled: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  position: number;
  description: string;
  color: string | null;
  style: string | null;
  quantity: number | null;
  unit: string;
  cut_notes: string | null;
  retail_price: number | null; // unit retail the customer was shown
  requested_price: number | null; // unit price the customer asked to pay
}

export type OrderStockStatus =
  | "unknown"
  | "in_stock"
  | "out_of_stock"
  | "partial";

export const ORDER_STOCK_LABELS: Record<OrderStockStatus, string> = {
  unknown: "Stock: not checked",
  in_stock: "In stock",
  out_of_stock: "Out of stock",
  partial: "Partial",
};

export const ORDER_STOCK_BADGE: Record<OrderStockStatus, string> = {
  unknown: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  in_stock: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  out_of_stock: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  partial: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
};

export interface Order {
  id: string;
  customer_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  status: OrderStatus;
  source: "portal" | "public";
  notes: string | null;
  decline_reason: string | null;
  stock_status: OrderStockStatus;
  stock_note: string | null;
  stock_checked_at: string | null;
  customer_stock_notified_at: string | null;
  invoice_id: string | null;
  job_id: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  items?: OrderItem[];
}

// --- Invoicing & Payments ---------------------------------------------------

export type InvoiceStatus = "draft" | "sent" | "partial" | "paid" | "void";

export type PaymentMethod =
  | "card"
  | "cash"
  | "check"
  | "echeck"
  | "financing"
  | "link"
  | "other";

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  position: number;
  description: string;
  quantity: number | null;
  unit: string;
  rate: number | null;
}

export interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  paid_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Invoice {
  id: string;
  customer_id: string;
  job_id: string | null;
  estimate_id: string | null;
  number: string | null;
  migrated?: boolean; // carried over from prior system at go-live
  status: InvoiceStatus;
  presentation: EstimatePresentation;
  issue_date: string | null;
  due_date: string | null;
  tax_rate: number;
  notes: string | null;
  terms: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  items?: InvoiceItem[];
  payments?: Payment[];
}

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  partial: "Partially Paid",
  paid: "Paid",
  void: "Void",
};

export const INVOICE_STATUS_ORDER: InvoiceStatus[] = [
  "draft",
  "sent",
  "partial",
  "paid",
  "void",
];

export const INVOICE_STATUS_BADGE: Record<InvoiceStatus, string> = {
  draft: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  sent: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  partial: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  paid: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  void: "bg-zinc-100 text-zinc-500 line-through dark:bg-zinc-800",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  card: "Credit Card",
  cash: "Cash",
  check: "Check",
  echeck: "eCheck / ACH",
  financing: "Financing",
  link: "Online Payment Link",
  other: "Other",
};

// --- Job files (photos + signature) -----------------------------------------

export type JobFileKind = "photo" | "signature";

export interface JobFile {
  id: string;
  job_id: string;
  path: string;
  kind: JobFileKind;
  caption: string | null;
  signer_name: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface JobFileWithUrl extends JobFile {
  url: string | null;
}

// --- Messaging --------------------------------------------------------------

export type MessageChannel = "internal" | "client";

export interface Message {
  id: string;
  customer_id: string;
  channel: MessageChannel;
  author_id: string | null;
  body: string;
  created_at: string;
}

export interface MessageWithAuthor extends Message {
  author_name: string;
}

// --- Expenses / Finance -----------------------------------------------------

export type ExpenseCategory =
  | "materials"
  | "labor"
  | "subcontractor"
  | "vehicle"
  | "fuel"
  | "rent"
  | "utilities"
  | "insurance"
  | "marketing"
  | "tools"
  | "payroll"
  | "office"
  | "other";

export interface Expense {
  id: string;
  date: string;
  category: ExpenseCategory;
  amount: number;
  vendor: string | null;
  note: string | null;
  job_id: string | null;
  created_by: string | null;
  created_at: string;
}

export type LaborBasis = "flat" | "per_sqft" | "per_sqyd";

export const LABOR_BASIS_LABELS: Record<LaborBasis, string> = {
  flat: "Flat (per job)",
  per_sqft: "Per sq ft",
  per_sqyd: "Per sq yd",
};

/** A subcontractor / crew payout recorded against a job (the real labor cost). */
export interface JobLabor {
  id: string;
  job_id: string;
  payee: string | null;
  basis: LaborBasis;
  rate: number | null;
  area: number | null;
  amount: number;
  paid: boolean;
  paid_on: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BusinessSettings {
  id: string;
  target_gross_margin_pct: number;
  monthly_revenue_goal: number;
  sample_loan_days: number;
  sample_reminder_lead_days: number;
  sample_default_deposit: number;
  sample_max_out: number; // 0 = no limit
  installer_collects_balance: boolean; // installers can collect the balance on site
  updated_at: string;
}

// --- Sample checkout / return ----------------------------------------------

export type SampleStatus = "out" | "returned" | "lost";

export interface SampleCheckoutItem {
  id: string;
  checkout_id: string;
  product_id: string | null;
  label: string;
  qty: number;
  returned: boolean;
  created_at: string;
}
export interface SampleCheckout {
  id: string;
  customer_id: string;
  status: SampleStatus;
  checked_out_at: string;
  due_date: string;
  returned_at: string | null;
  deposit: number | null;
  notes: string | null;
  last_reminder_on: string | null;
  created_at: string;
  items: SampleCheckoutItem[];
  customer_name?: string | null;
}

// --- Booking calendar -------------------------------------------------------

export type AppointmentColor =
  | "blue"
  | "green"
  | "amber"
  | "violet"
  | "rose"
  | "gray"
  | "teal";

export const APPOINTMENT_COLORS: AppointmentColor[] = [
  "blue",
  "green",
  "amber",
  "violet",
  "rose",
  "gray",
  "teal",
];

/** Tailwind classes per color token, for chips and calendar blocks. */
export const APPOINTMENT_COLOR_CLASSES: Record<
  AppointmentColor,
  { block: string; chip: string; dot: string }
> = {
  blue: { block: "border-blue-300 bg-blue-50 text-blue-900", chip: "bg-blue-500/10 text-blue-600", dot: "bg-blue-500" },
  green: { block: "border-emerald-300 bg-emerald-50 text-emerald-900", chip: "bg-emerald-500/10 text-emerald-600", dot: "bg-emerald-500" },
  amber: { block: "border-amber-300 bg-amber-50 text-amber-900", chip: "bg-amber-500/10 text-amber-600", dot: "bg-amber-500" },
  violet: { block: "border-violet-300 bg-violet-50 text-violet-900", chip: "bg-violet-500/10 text-violet-600", dot: "bg-violet-500" },
  rose: { block: "border-rose-300 bg-rose-50 text-rose-900", chip: "bg-rose-500/10 text-rose-600", dot: "bg-rose-500" },
  gray: { block: "border-gray-300 bg-gray-50 text-gray-900", chip: "bg-gray-500/10 text-gray-600", dot: "bg-gray-500" },
  teal: { block: "border-teal-300 bg-teal-50 text-teal-900", chip: "bg-teal-500/10 text-teal-600", dot: "bg-teal-500" },
};

export type AppointmentKind =
  | "showroom"
  | "in_home"
  | "measure"
  | "pickup"
  | "other";

export interface AppointmentType {
  id: string;
  name: string;
  duration_min: number;
  color: AppointmentColor;
  kind: AppointmentKind;
  requires_rep: boolean;
  active: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface ShowroomSettings {
  id: string;
  open_days: string; // CSV of 0..6
  day_start: string; // HH:MM
  day_end: string; // HH:MM
  slot_interval_min: number;
  capacity: number;
  buffer_min: number;
  booking_enabled: boolean;
  booking_notice_hours: number;
  updated_at: string;
}

export type AppointmentStatus =
  | "pending"
  | "scheduled"
  | "completed"
  | "cancelled"
  | "no_show";

export interface Appointment {
  id: string;
  customer_id: string | null;
  estimate_id: string | null;
  salesperson_id: string | null;
  type_id: string | null;
  kind: string;
  starts_at: string;
  ends_at: string | null;
  address: string | null;
  drive_minutes: number | null;
  notes: string | null;
  status: AppointmentStatus;
  seq: number;
  is_block: boolean;
  title: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  source: string;
  created_by: string | null;
  created_at: string;
}

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  materials: "Materials",
  labor: "Labor",
  subcontractor: "Subcontractor",
  vehicle: "Vehicle",
  fuel: "Fuel",
  rent: "Rent",
  utilities: "Utilities",
  insurance: "Insurance",
  marketing: "Marketing",
  tools: "Tools",
  payroll: "Payroll",
  office: "Office",
  other: "Other",
};

export const EXPENSE_CATEGORY_ORDER: ExpenseCategory[] = [
  "materials",
  "labor",
  "subcontractor",
  "vehicle",
  "fuel",
  "rent",
  "utilities",
  "insurance",
  "marketing",
  "tools",
  "payroll",
  "office",
  "other",
];

// --- Workflow stages & handoffs --------------------------------------------

export type StageAutoAction =
  | "none"
  | "schedule_estimate"
  | "build_quote"
  | "collect_deposit"
  | "schedule_install";

export interface WorkflowStage {
  id: string;
  name: string;
  position: number;
  color: string;
  default_owner: string | null;
  owner_duty: string | null; // which duty owns this stage (scopes the owner picker); null = anyone
  auto_action: StageAutoAction;
  next_action: string | null;
  sla_hours: number;
  created_at: string;
}

export const STAGE_AUTO_ACTION_LABELS: Record<StageAutoAction, string> = {
  none: "No auto-action",
  schedule_estimate: "Open estimate scheduler",
  build_quote: "Open quote builder",
  collect_deposit: "Open deposit invoice",
  schedule_install: "Open install scheduler",
};

export interface Handoff {
  id: string;
  customer_id: string;
  from_stage_id: string | null;
  to_stage_id: string | null;
  from_user: string | null;
  to_user: string | null;
  note: string | null;
  created_at: string;
}

/** Tailwind classes for a stage's color token. */
export const STAGE_COLOR_BADGE: Record<string, string> = {
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  cyan: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-300",
  green: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  purple: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300",
  indigo: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  teal: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300",
  rose: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  zinc: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

export const STAGE_COLORS = [
  "blue",
  "amber",
  "cyan",
  "green",
  "purple",
  "indigo",
  "teal",
  "rose",
  "zinc",
];
