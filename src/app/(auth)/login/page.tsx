import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getProfile, getUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { LoginForm } from "./login-form";

function destinationFor(next: string | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const destination = destinationFor(next);
  const configured = isSupabaseConfigured();
  let blocked: string | null = null;
  if (configured) {
    const user = await getUser();
    if (user) {
      const profile = await getProfile();
      if (profile) redirect(destination);
      blocked =
        "This login has no profile, so the app can't open it. Ask an admin to restore the account.";
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          Welcome back. Enter your credentials to access the dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {configured ? (
          <>
            {blocked ? (
              <p className="mb-4 text-sm text-destructive" role="alert">
                {blocked}
              </p>
            ) : null}
            <LoginForm next={destination} />
          </>
        ) : (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Almost there.</p>
            <p className="mt-1">
              Connect your Supabase project by filling in{" "}
              <code className="rounded bg-muted px-1 py-0.5">.env.local</code>,
              then restart the app. Sign-in will activate automatically.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
