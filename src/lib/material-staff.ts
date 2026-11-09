import { ownerEmail } from "@/lib/notify";

type EmailRows = { data: { email: string | null }[] | null };

/**
 * Inbox list for a material update: the business owner, every admin, and the
 * people passed in (the customer's salesperson, the account owner, the job
 * owner, and the installer when the job is ready to leave the shop).
 *
 * The database client is untyped here because pinning the Supabase builder
 * makes TypeScript expand the client generics until the check gives up.
 */
export async function materialStaffEmails(
  db: {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => PromiseLike<EmailRows>;
        in: (column: string, values: string[]) => PromiseLike<EmailRows>;
      };
    };
  },
  ids: Array<string | null | undefined>,
): Promise<string[]> {
  const recipients = new Set<string>();
  const owner = ownerEmail().trim();
  if (owner) recipients.add(owner);

  const { data: admins } = await db.from("profiles").select("email").eq("role", "admin");
  for (const row of admins ?? []) {
    const email = (row.email ?? "").trim();
    if (email) recipients.add(email);
  }

  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length) {
    const { data: people } = await db.from("profiles").select("email").in("id", unique);
    for (const row of people ?? []) {
      const email = (row.email ?? "").trim();
      if (email) recipients.add(email);
    }
  }
  return [...recipients];
}
