import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { priceBookGate } from "@/lib/data/price-book";
import { COMPANY_NAME } from "@/lib/nav";
import { SignOutButton } from "@/components/sign-out-button";

export const dynamic = "force-dynamic";

export default async function PriceBookLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const gate = await priceBookGate(profile.id);
  if (!gate) redirect(profile.role === "customer" ? "/portal" : "/");

  return (
    <div className="flex min-h-svh flex-col bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="truncate font-semibold">{COMPANY_NAME}</p>
            <p className="text-sm text-muted-foreground">
              {profile.full_name ? `${profile.full_name} · ` : ""}Price book
            </p>
          </div>
          <SignOutButton />
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
