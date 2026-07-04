/**
 * Per-user page preferences — which quick actions and tabs each person sees on
 * the customer pages, in the order they like. Server- AND client-safe (pure
 * data + helpers, no React, no server-only imports) so both the settings editor
 * and the pages can share one source of truth.
 */

// --- Quick actions ----------------------------------------------------------

export type QuickAction = "stage" | "assignee" | "estimate" | "install";

/** Canonical order + the full set of quick actions. */
export const QUICK_ACTION_ORDER: QuickAction[] = [
  "stage",
  "assignee",
  "estimate",
  "install",
];

export const QUICK_ACTION_LABELS: Record<QuickAction, string> = {
  stage: "Change stage",
  assignee: "Reassign owner",
  estimate: "Estimate date",
  install: "Install date",
};

// --- Customer-file tabs -----------------------------------------------------

export type CustomerTab =
  | "overview"
  | "contact"
  | "estimates"
  | "jobs"
  | "invoices"
  | "materials"
  | "files"
  | "messages"
  | "activity";

/** Canonical order + the full set of tabs. */
export const TAB_ORDER: CustomerTab[] = [
  "overview",
  "contact",
  "estimates",
  "jobs",
  "invoices",
  "materials",
  "files",
  "messages",
  "activity",
];

export const TAB_LABELS: Record<CustomerTab, string> = {
  overview: "Overview",
  contact: "Contact",
  estimates: "Estimates",
  jobs: "Work orders",
  invoices: "Invoices",
  materials: "Materials & POs",
  files: "Files",
  messages: "Messages",
  activity: "Activity",
};

// --- Resolved preferences ---------------------------------------------------

export interface UserPreferences {
  /** Quick actions on the customer file's bar, in order. */
  quickActions: QuickAction[];
  /** Quick actions offered on the customer LIST rows, in order. */
  listActions: QuickAction[];
  /** Visible tabs on the customer file, in order. */
  tabs: CustomerTab[];
  /** Tab a customer file opens on. */
  defaultTab: CustomerTab;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  quickActions: [...QUICK_ACTION_ORDER],
  listActions: [...QUICK_ACTION_ORDER],
  tabs: [...TAB_ORDER],
  defaultTab: "overview",
};

/** Keep only known values, in the given order, de-duplicated. */
function clean<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  fallback: T[],
): T[] {
  if (!Array.isArray(raw)) return [...fallback];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const v of raw) {
    if (typeof v === "string" && (allowed as readonly string[]).includes(v) && !seen.has(v)) {
      seen.add(v);
      out.push(v as T);
    }
  }
  // Never let a user end up with an empty list — fall back to the defaults.
  return out.length ? out : [...fallback];
}

/**
 * Merge a raw DB row (or null) into a complete, sane UserPreferences — unknown
 * keys dropped, empty lists replaced by defaults, and default_tab guaranteed to
 * be one of the visible tabs. Safe to call with anything.
 */
export function resolvePreferences(row: {
  quick_actions?: unknown;
  list_actions?: unknown;
  tabs?: unknown;
  default_tab?: unknown;
} | null | undefined): UserPreferences {
  if (!row) return { ...DEFAULT_PREFERENCES };
  const quickActions = clean<QuickAction>(
    row.quick_actions,
    QUICK_ACTION_ORDER,
    DEFAULT_PREFERENCES.quickActions,
  );
  const listActions = clean<QuickAction>(
    row.list_actions,
    QUICK_ACTION_ORDER,
    DEFAULT_PREFERENCES.listActions,
  );
  const tabs = clean<CustomerTab>(row.tabs, TAB_ORDER, DEFAULT_PREFERENCES.tabs);
  const dt =
    typeof row.default_tab === "string" && tabs.includes(row.default_tab as CustomerTab)
      ? (row.default_tab as CustomerTab)
      : tabs[0];
  return { quickActions, listActions, tabs, defaultTab: dt };
}
