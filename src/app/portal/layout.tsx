import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { COMPANY_NAME } from "@/lib/nav";
import { signout } from "@/app/(app)/actions";
import { LiveSync } from "@/components/live-sync";
import { createClient } from "@/lib/supabase/server";
import { PortalNav } from "./portal-nav";

export const dynamic = "force-dynamic";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();
  if (profile.role !== "customer") redirect("/dashboard");

  let replyWaiting = false;
  if (profile.customer_id) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("messages")
      .select("author_id")
      .eq("customer_id", profile.customer_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    replyWaiting = !!data && data.author_id !== profile.id;
  }

  return (
    <div className="flex min-h-svh flex-col bg-muted/30">
      <LiveSync />
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
              FK
            </div>
            <span className="truncate font-semibold">{COMPANY_NAME}</span>
          </div>
          <PortalNav replyWaiting={replyWaiting} />
          <form action={signout}>
            <Button variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 p-4 pb-24 md:p-8 md:pb-8">
        {children}
      </main>
    </div>
  );
}
