"use client";

import { useRef } from "react";
import { ROLE_LABELS, type UserRole } from "@/lib/types";
import { setMemberRole } from "./actions";

const ROLES: UserRole[] = ["crew", "warehouse", "office", "admin"];

export function RoleSelect({ id, role }: { id: string; role: UserRole }) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={setMemberRole}>
      <input type="hidden" name="id" value={id} />
      <select
        name="role"
        defaultValue={role}
        onChange={() => formRef.current?.requestSubmit()}
        aria-label="Role"
        className="h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
    </form>
  );
}
