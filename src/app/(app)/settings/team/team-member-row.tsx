"use client";

import { ChevronRight, Mail, Phone } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { PhoneInput } from "@/components/ui/phone-input";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS, type UserRole } from "@/lib/types";
import { cn } from "@/lib/utils";
import { RoleSelect } from "./role-select";
import { MemberLogin } from "./member-login";
import { RemoveMember } from "./remove-member";
import { ActiveToggle } from "./active-toggle";
import {
  setMemberName,
  setMemberTitle,
  setMemberHome,
  setMemberPhonePin,
  setMemberSkills,
} from "./actions";

export interface TeamMemberRowData {
  id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  title: string | null;
  role: UserRole;
  active: boolean;
  home_address: string | null;
}

const Section = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-1.5">
    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {label}
    </div>
    {children}
  </div>
);

/**
 * One team member as a clickable list row → a detail Sheet with every edit
 * control, so the list stays a clean roster instead of a wall of inline forms.
 */
export function TeamMemberRow({
  member: m,
  isMe,
  canToggleActive,
  canRemove,
  isCrew,
  skills,
}: {
  member: TeamMemberRowData;
  isMe: boolean;
  canToggleActive: boolean;
  canRemove: boolean;
  isCrew: boolean;
  skills: string[];
}) {
  const name = m.full_name || m.email;
  const initials = (m.full_name || m.email || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  return (
    <Sheet>
      <SheetTrigger
        render={
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-3 px-1 py-3 text-left transition-colors hover:bg-muted/50",
              !m.active && "opacity-60",
            )}
          />
        }
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
          {initials || "?"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{name}</span>
            {isMe ? <span className="text-xs text-muted-foreground">· you</span> : null}
            {!m.active ? (
              <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                Deactivated
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span className="rounded-full bg-muted px-1.5 py-0.5 font-medium">
              {ROLE_LABELS[m.role]}
            </span>
            {m.email ? (
              <span className="inline-flex items-center gap-1 truncate">
                <Mail className="size-3" /> {m.email}
              </span>
            ) : null}
            {m.phone ? (
              <span className="inline-flex items-center gap-1">
                <Phone className="size-3" /> {m.phone}
              </span>
            ) : null}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </SheetTrigger>

      <SheetContent className="w-full gap-5 p-5 sm:max-w-md">
        <SheetHeader className="p-0">
          <SheetTitle className="flex items-center gap-2">
            {name}
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {ROLE_LABELS[m.role]}
            </span>
          </SheetTitle>
        </SheetHeader>

        <Section label="Name">
          <form action={setMemberName} className="flex items-center gap-2">
            <input type="hidden" name="id" value={m.id} />
            <input
              name="full_name"
              defaultValue={m.full_name ?? ""}
              placeholder="Full name"
              className="h-9 flex-1 rounded-md border border-input bg-transparent px-2.5 text-sm"
            />
            <Button type="submit" variant="outline" size="sm">
              Save
            </Button>
          </form>
        </Section>

        <Section label="Job title">
          <form action={setMemberTitle} className="flex items-center gap-2">
            <input type="hidden" name="id" value={m.id} />
            <input
              name="title"
              defaultValue={m.title ?? ""}
              placeholder="e.g. Lead installer"
              className="h-9 flex-1 rounded-md border border-input bg-transparent px-2.5 text-sm"
            />
            <Button type="submit" variant="outline" size="sm">
              Save
            </Button>
          </form>
        </Section>

        <Section label="Role">
          <RoleSelect id={m.id} role={m.role} />
        </Section>

        <Section label="Login — email & password">
          <MemberLogin id={m.id} email={m.email} />
        </Section>

        <Section label="Phone sign-in (phone + PIN)">
          <form action={setMemberPhonePin} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="id" value={m.id} />
            <PhoneInput
              name="phone"
              defaultValue={m.phone ?? ""}
              placeholder="Phone for sign-in"
              className="h-9 w-40 text-sm"
            />
            <input
              name="pin"
              placeholder="New PIN (6+)"
              className="h-9 w-28 rounded-md border border-input bg-transparent px-2.5 text-sm"
            />
            <Button type="submit" variant="outline" size="sm">
              Set PIN
            </Button>
          </form>
        </Section>

        <Section label="Home base (routes their estimates)">
          <form action={setMemberHome} className="flex items-center gap-2">
            <input type="hidden" name="id" value={m.id} />
            <input
              name="home_address"
              defaultValue={m.home_address ?? ""}
              placeholder="Home base address"
              className="h-9 flex-1 rounded-md border border-input bg-transparent px-2.5 text-sm"
            />
            <Button type="submit" variant="outline" size="sm">
              Save
            </Button>
          </form>
        </Section>

        {isCrew ? (
          <Section label="Installs (controls their Job Board)">
            <form action={setMemberSkills} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="id" value={m.id} />
              <input type="hidden" name="name" value={m.full_name ?? ""} />
              {(
                [
                  ["carpet", "Carpet"],
                  ["hard", "Hard surface"],
                ] as const
              ).map(([v, lbl]) => (
                <label key={v} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    name="skills"
                    value={v}
                    defaultChecked={skills.includes(v)}
                    className="size-4 rounded border-input"
                  />
                  {lbl}
                </label>
              ))}
              <Button type="submit" variant="outline" size="sm">
                Save skills
              </Button>
            </form>
          </Section>
        ) : null}

        {(canToggleActive || canRemove) && !isMe ? (
          <div className="flex items-center justify-between gap-2 border-t pt-4">
            {canToggleActive ? (
              <ActiveToggle id={m.id} name={name} active={m.active} />
            ) : (
              <span />
            )}
            {canRemove ? <RemoveMember id={m.id} name={name} /> : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
