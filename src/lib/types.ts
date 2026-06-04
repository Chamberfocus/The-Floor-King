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
