// Proves the regrouped nav loses NOTHING: for every role, the exact set of
// destinations it could reach before (the old flat roles) is still reachable
// after grouping. Drives the REAL exported nav functions.
import {
  navItemsForRole,
  navGroupsForRole,
  pinnedItemsForRole,
  settingsItemForRole,
} from "@/lib/nav";
import { SCHEDULE_ROLES, type UserRole } from "@/lib/types";

// The OLD flat nav, verbatim (label → href → roles) as it shipped before grouping.
const OLD: { href: string; roles: UserRole[] }[] = [
  { href: "/installer", roles: ["crew", "admin", "office"] },
  { href: "/pulse", roles: ["admin"] },
  { href: "/customers", roles: ["admin", "office", "sales_manager", "salesman", "scheduler"] },
  { href: "/pipeline", roles: ["admin", "office"] },
  { href: "/dashboard", roles: ["admin", "office", "sales_manager"] },
  { href: "/orders", roles: ["admin", "office"] },
  { href: "/purchase-orders", roles: ["admin", "office"] },
  { href: "/bills", roles: ["admin", "office"] },
  { href: "/samples", roles: ["admin", "office", "sales_manager", "salesman", "scheduler"] },
  { href: "/calendar", roles: ["admin", "office", "sales_manager", "salesman", "scheduler"] },
  { href: "/schedule", roles: ["admin", "office", "sales_manager", "salesman", "scheduler"] },
  { href: "/team", roles: SCHEDULE_ROLES },
  { href: "/jobs", roles: ["admin", "office", "sales_manager", "salesman", "scheduler", "crew"] },
  { href: "/install-scheduler", roles: ["admin", "office", "scheduler"] },
  { href: "/jobs/quick", roles: ["admin", "office", "scheduler"] },
  { href: "/board", roles: ["admin", "office", "scheduler", "crew"] },
  { href: "/invoices", roles: ["admin", "office", "sales_manager", "salesman"] },
  { href: "/saved", roles: ["admin", "office", "sales_manager", "salesman"] },
  { href: "/catalog", roles: ["admin", "office", "sales_manager", "salesman"] },
  { href: "/inventory", roles: ["admin", "office", "warehouse", "sales_manager"] },
  { href: "/reports", roles: ["admin", "office", "sales_manager"] },
  { href: "/warehouse", roles: ["admin", "office", "warehouse"] },
  { href: "/carry-over", roles: ["admin", "office"] },
  { href: "/settings", roles: ["admin"] },
];

const ROLES: UserRole[] = [
  "admin", "office", "sales_manager", "salesman", "scheduler", "crew", "warehouse",
];

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => {
  if (c) pass++;
  else { fail++; console.log(`  ✗ ${m}`); }
};

for (const role of ROLES) {
  const before = new Set(OLD.filter((i) => i.roles.includes(role)).map((i) => i.href));
  const after = new Set(navItemsForRole(role).map((i) => i.href));

  // 1) Every destination reachable before is still reachable.
  for (const href of before) ok(after.has(href), `[${role}] lost access to ${href}`);
  // 2) Nothing new was granted (no accidental access change).
  for (const href of after) ok(before.has(href), `[${role}] unexpectedly gained ${href}`);
  // 3) No duplicate destinations across the grouped structure.
  const flat = navItemsForRole(role).map((i) => i.href);
  ok(flat.length === new Set(flat).size, `[${role}] has a duplicate nav entry`);
  // 4) Empty groups are dropped.
  ok(navGroupsForRole(role).every((g) => g.items.length > 0), `[${role}] has an empty group`);

  const groups = navGroupsForRole(role);
  const primaryFirst = groups[0]?.label ?? "(none)";
  console.log(
    `${role.padEnd(14)} → pinned[${pinnedItemsForRole(role).map((p) => p.label).join(", ") || "—"}]` +
    ` · groups: ${groups.map((g) => `${g.label}(${g.items.length})`).join(", ")}` +
    `${settingsItemForRole(role) ? " · Settings" : ""}`,
  );
  void primaryFirst;
}

// Role-first spot checks.
console.log("\nrole-first ordering:");
for (const [role, want] of [
  ["warehouse", "Products & Warehouse"],
  ["crew", "Jobs & Field"],
  ["scheduler", "Schedule"],
  ["salesman", "Sales"],
] as [UserRole, string][]) {
  const first = navGroupsForRole(role)[0]?.label;
  ok(first === want, `[${role}] primary group should be "${want}", got "${first}"`);
  console.log(`  ${role.padEnd(12)} first group = ${first}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
