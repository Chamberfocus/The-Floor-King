"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { login, loginWithPhone, type LoginState } from "./actions";

const initialState: LoginState = { error: null };

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"email" | "phone">("email");
  const [emailState, emailAction, emailPending] = useActionState(
    login,
    initialState,
  );
  const [phoneState, phoneAction, phonePending] = useActionState(
    loginWithPhone,
    initialState,
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        {(["email", "phone"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              "rounded-md py-1.5 text-sm font-medium transition-colors",
              mode === m
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m === "email" ? "Email" : "Phone & PIN"}
          </button>
        ))}
      </div>

      {mode === "email" ? (
        <form action={emailAction} className="space-y-4">
          <input type="hidden" name="next" value={next} />
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@clevelandfloorking.com"
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              required
            />
          </div>
          {emailState.error ? (
            <p className="text-sm text-destructive" role="alert">
              {emailState.error}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={emailPending}>
            {emailPending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      ) : (
        <form action={phoneAction} className="space-y-4">
          <input type="hidden" name="next" value={next} />
          <div className="space-y-2">
            <Label htmlFor="phone">Phone number</Label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="(216) 555-1212"
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pin">PIN</Label>
            <Input
              id="pin"
              name="pin"
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              placeholder="••••••"
              required
            />
          </div>
          {phoneState.error ? (
            <p className="text-sm text-destructive" role="alert">
              {phoneState.error}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={phonePending}>
            {phonePending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      )}
    </div>
  );
}
