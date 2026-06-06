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
  qualified: boolean | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface QualifyingQuestion {
  id: string;
  label: string;
  help: string | null;
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
  length_in: number | null;
  width_in: number | null;
  measure_unit: MeasureUnit;
  material_rate: number | null;
  labor_rate: number | null;
  installed_rate: number | null;
  flat_amount: number | null;
  product_id: string | null;
  manufacturer: string | null;
  style: string | null;
  color: string | null;
  item_no: string | null;
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
  default_amount: number | null;
  position: number;
  active: boolean;
  created_at: string;
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

export interface Job {
  id: string;
  customer_id: string;
  estimate_id: string | null;
  option_id: string | null;
  title: string | null;
  status: JobStatus;
  scheduled_date: string | null;
  scheduled_end: string | null;
  assigned_to: string | null;
  site_street: string | null;
  site_city: string | null;
  site_state: string | null;
  site_zip: string | null;
  notes: string | null;
  delivery_type: JobDeliveryType;
  warehouse_status: WarehouseStatus;
  open_for_claim: boolean;
  reminder_sent_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type JobDeliveryType = "cash_carry" | "deliver" | "deliver_acclimate";
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
  cash_carry: "Cash & Carry",
  deliver: "Deliver to site",
  deliver_acclimate: "Deliver for acclimation",
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

export interface PurchaseOrder {
  id: string;
  customer_id: string | null;
  estimate_id: string | null;
  job_id: string | null;
  supplier: string | null;
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
  status: InvoiceStatus;
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

export interface WorkflowStage {
  id: string;
  name: string;
  position: number;
  color: string;
  default_owner: string | null;
  created_at: string;
}

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
