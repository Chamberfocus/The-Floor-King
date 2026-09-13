"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatDate, formatMoney } from "@/lib/format";
import type { DuplicateGroup } from "@/lib/customer-duplicate-cleanup";
import { markNotDuplicate, type MergeActionState } from "./actions";

const initial: MergeActionState = { ok: false, error: null };

function MemberBlock({
  member,
}: {
  member: DuplicateGroup["members"][number];
}) {
  return (
    <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
      <div className="font-semibold tracking-tight">{member.full_name}</div>
      <div className="font-mono text-xs text-muted-foreground">ID {member.id}</div>
      <div>{member.phone || "No phone"}</div>
      <div>{member.email || "No email"}</div>
      <div>
        {[member.street, member.city, member.state, member.zip]
          .filter(Boolean)
          .join(", ") || "No address"}
      </div>
      <div className="text-muted-foreground">
        Created {formatDate(member.created_at)}
        {member.salespersonName ? ` · ${member.salespersonName}` : ""}
      </div>
      <div className="text-muted-foreground">
        {member.jobCount} jobs
        {member.openJobCount ? ` (${member.openJobCount} open)` : ""}
        {" · "}
        {member.estimateCount} estimates
        {" · "}
        {member.invoiceCount} invoices
        {member.cashAndCarryCount ? ` · ${member.cashAndCarryCount} C&C` : ""}
        {member.openAr > 0 ? ` · AR ${formatMoney(member.openAr)}` : ""}
      </div>
    </div>
  );
}

export function DuplicateGroupCard({
  group,
  canMerge,
}: {
  group: DuplicateGroup;
  canMerge: boolean;
}) {
  const [state, excludeAction] = useActionState(markNotDuplicate, initial);
  const [a, b] = group.memberIds;
  const tone =
    group.confidence === "high"
      ? "default"
      : group.confidence === "medium"
        ? "secondary"
        : "outline";

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">Possible duplicate customer</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{group.label}</p>
        </div>
        <Badge variant={tone}>{group.confidence.toUpperCase()}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {group.members.map((m) => (
            <MemberBlock key={m.id} member={m} />
          ))}
        </div>
        {group.confidence === "low" ? (
          <p className="text-xs text-muted-foreground">
            Low confidence is never suggested as an automatic merge. Review only if you
            already know these records are the same person.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {canMerge && a && b ? (
            <Link
              href={`/customers/duplicates/review?a=${a}&b=${b}`}
              className={buttonVariants()}
            >
              Review
            </Link>
          ) : (
            <Button disabled>Review</Button>
          )}
          {canMerge && a && b ? (
            <form action={excludeAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="customer_a" value={a} />
              <input type="hidden" name="customer_b" value={b} />
              <input
                name="reason"
                required
                placeholder="Why these are separate"
                className="h-10 min-w-56 rounded-lg border bg-background px-3 text-sm"
              />
              <SubmitButton variant="outline" confirm="Marked not a duplicate">
                Not a Duplicate
              </SubmitButton>
            </form>
          ) : null}
        </div>
        {state.error ? (
          <p className="text-sm text-destructive">{state.error}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
