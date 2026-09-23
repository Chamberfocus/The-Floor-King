"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { quickCreateForRole } from "@/lib/nav";
import type { UserRole } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Global + New. Hidden when this role has no existing create screen. */
export function QuickCreate({
  role,
  onNavigate,
  className,
  fullWidth,
}: {
  role: UserRole;
  onNavigate?: () => void;
  className?: string;
  fullWidth?: boolean;
}) {
  const actions = quickCreateForRole(role);
  if (!actions.length) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            className={cn(fullWidth && "w-full", className)}
            aria-label="New"
          />
        }
      >
        <Plus className="size-5" />
        <span className={fullWidth ? "inline" : "hidden lg:inline"}>New</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={fullWidth ? "start" : "end"} className="min-w-44">
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.id}
            className="min-h-11 px-3 py-2 text-sm"
            render={<Link href={action.href} onClick={onNavigate} />}
          >
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
