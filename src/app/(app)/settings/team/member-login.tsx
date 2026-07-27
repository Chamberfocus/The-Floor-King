"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Mail, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setMemberEmail, setMemberPassword } from "./actions";

const initial: { error: string | null; ok?: boolean } = { error: null };

/** Edit a team member's LOGIN — their email and password. Admin only. */
export function MemberLogin({ id, email }: { id: string; email: string | null }) {
  const [emailState, emailAction] = useActionState(setMemberEmail, initial);
  const [pwState, pwAction] = useActionState(setMemberPassword, initial);
  const pwRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (emailState.ok) toast.success("Login email updated");
    else if (emailState.error) toast.error(emailState.error);
  }, [emailState]);

  useEffect(() => {
    if (pwState.ok) {
      toast.success("Password set");
      pwRef.current?.reset();
    } else if (pwState.error) toast.error(pwState.error);
  }, [pwState]);

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <form action={emailAction} className="flex items-center gap-1">
        <input type="hidden" name="id" value={id} />
        <Mail className="size-3.5 text-muted-foreground" />
        <Input
          name="email"
          type="email"
          defaultValue={email ?? ""}
          placeholder="Login email"
          className="h-8 w-56 text-sm"
        />
        <Button type="submit" variant="ghost" size="sm">
          Save email
        </Button>
      </form>
      <form ref={pwRef} action={pwAction} className="flex items-center gap-1">
        <input type="hidden" name="id" value={id} />
        <KeyRound className="size-3.5 text-muted-foreground" />
        <Input
          name="password"
          type="text"
          placeholder="New password (6+)"
          autoComplete="off"
          className="h-8 w-40 text-sm"
        />
        <Button type="submit" variant="ghost" size="sm">
          Set password
        </Button>
      </form>
    </div>
  );
}
