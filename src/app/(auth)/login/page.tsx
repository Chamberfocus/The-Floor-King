import type { Metadata } from "next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isSupabaseConfigured } from "@/lib/env";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const configured = isSupabaseConfigured();

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
          <LoginForm next={next ?? "/dashboard"} />
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
