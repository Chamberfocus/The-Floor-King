import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";

/**
 * Keep /customers behind the authenticated app shell without performing a
 * second profile-table read during the same server render. Production was
 * crashing only inside this nested layout while the parent app layout had
 * already authenticated and rendered the signed-in Administrator shell.
 *
 * Staff navigation still hides this area from non-sales roles, server actions
 * keep their own authorization checks, and database RLS remains the final data
 * boundary. When the auth token itself carries a role, reject known roles that
 * must never open customer financial data.
 */
export default async function CustomersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();
  if (!user) redirect("/login");

  const tokenRole =
    (user.app_metadata?.role as string | undefined) ??
    (user.user_metadata?.role as string | undefined);

  if (tokenRole && ["crew", "warehouse", "customer"].includes(tokenRole)) {
    redirect("/");
  }

  return <>{children}</>;
}
