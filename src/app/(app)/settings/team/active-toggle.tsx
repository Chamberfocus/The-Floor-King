"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Power, PowerOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setMemberActive } from "./actions";

export function ActiveToggle({
  id,
  name,
  active,
}: {
  id: string;
  name: string;
  active: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const toggle = () =>
    start(async () => {
      const res = await setMemberActive(id, !active);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(active ? `Deactivated ${name}` : `Reactivated ${name}`);
      router.refresh();
    });

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={toggle}
      disabled={pending}
      className={active ? "text-amber-600" : "text-emerald-600"}
      title={active ? "Disable sign-in, keep records" : "Restore sign-in"}
    >
      {active ? (
        <>
          <PowerOff className="size-4" /> Deactivate
        </>
      ) : (
        <>
          <Power className="size-4" /> Reactivate
        </>
      )}
    </Button>
  );
}
