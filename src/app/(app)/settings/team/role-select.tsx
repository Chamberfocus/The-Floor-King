"use client";

import { useState, useTransition } from "react";
import { ROLE_LABELS, type UserRole } from "@/lib/types";
import { SegmentedField } from "@/components/ui/segmented-field";
import { setMemberRole } from "./actions";

const ROLES: UserRole[] = [
  "admin",
  "sales_manager",
  "salesman",
  "scheduler",
  "office",
  "crew",
  "warehouse",
];

export function RoleSelect({ id, role }: { id: string; role: UserRole }) {
  const [current, setCurrent] = useState<UserRole>(role);
  const [, start] = useTransition();

  const change = (r: string) => {
    setCurrent(r as UserRole);
    const fd = new FormData();
    fd.set("id", id);
    fd.set("role", r);
    start(() => {
      setMemberRole(fd);
    });
  };

  return (
    <SegmentedField
      size="sm"
      value={current}
      onChange={change}
      options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
    />
  );
}
