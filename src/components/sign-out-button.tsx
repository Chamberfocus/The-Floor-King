import { LogOut } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A real submit. The menu button was not ending the session. */
export function SignOutButton({ className }: { className?: string }) {
  return (
    <form action="/auth/signout" method="post">
      <button
        type="submit"
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "justify-start text-muted-foreground",
          className,
        )}
      >
        <LogOut className="size-4" />
        Sign out
      </button>
    </form>
  );
}
