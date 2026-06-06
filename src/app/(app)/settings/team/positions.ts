import type { UserRole } from "@/lib/types";

/** Job positions offered when adding a team member, mapped to a permission role. */
export interface Position {
  id: string;
  label: string;
  role: UserRole;
}

export const POSITIONS: Position[] = [
  { id: "owner", label: "Owner", role: "admin" },
  { id: "admin", label: "Administrator", role: "admin" },
  { id: "sales_manager", label: "Sales Manager", role: "sales_manager" },
  { id: "salesman", label: "Salesman", role: "salesman" },
  { id: "scheduler", label: "Scheduler", role: "scheduler" },
  { id: "office", label: "Office Staff", role: "office" },
  { id: "installer", label: "Installer", role: "crew" },
  { id: "warehouse", label: "Warehouse", role: "warehouse" },
];

export function positionById(id: string): Position | undefined {
  return POSITIONS.find((p) => p.id === id);
}
