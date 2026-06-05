import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { COMPANY_NAME } from "@/lib/nav";
import { signout } from "@/app/(app)/actions";

export const dynamic = "force-dynamic";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();
  if (profile.role !== "customer") redirect("/dashboard");

  return (
    <div className="flex min-h-svh flex-col bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-4xl items-center justify-between p-4">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
              FK
            </div>
            <span className="font-semibold">{COMPANY_NAME}</span>
          </div>
          <form action={signout}>
            <Button variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 p-4 md:p-8">
        {children}
      </main>
    </div>
  );
}
