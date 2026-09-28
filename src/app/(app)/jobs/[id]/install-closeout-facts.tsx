import { formatDateTime, formatMoney } from "@/lib/format";
import {
  installCloseoutFacts,
  type InstallCloseoutFacts,
} from "@/lib/install-closeout";
import type { JobStatus } from "@/lib/types";

export function InstallCloseoutFacts({
  status,
  completedAt,
  signOffRecorded,
  photoCount,
  openCallbacks,
  openBalance,
  crewName,
}: {
  status: JobStatus | null | undefined;
  completedAt: string | null | undefined;
  signOffRecorded: boolean;
  photoCount: number;
  openCallbacks: number;
  openBalance: number | null;
  crewName: string | null;
}) {
  const facts: InstallCloseoutFacts = installCloseoutFacts({
    status,
    completedAt,
    signOffRecorded,
    photoCount,
    openCallbacks,
    openBalance,
    formatMoney,
  });

  return (
    <div className="mb-4 rounded-lg border bg-card p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Installation closeout
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Installation" value={facts.installation} />
        <Fact
          label="Completed"
          value={
            status === "completed" && completedAt
              ? formatDateTime(completedAt)
              : facts.completion
          }
        />
        <Fact label="Crew" value={crewName || "Not assigned"} />
        <Fact label="Customer sign-off" value={facts.signOff} />
        <Fact
          label="Completion photos"
          value={
            facts.photoCount === 0
              ? "None uploaded"
              : `${facts.photoCount} uploaded`
          }
        />
        <Fact
          label="Service callback"
          value={
            facts.openCallbacks === 0
              ? "No open callback"
              : facts.openCallbacks === 1
                ? "1 open callback"
                : `${facts.openCallbacks} open callbacks`
          }
        />
        {facts.balanceLabel ? (
          <Fact label="Collection" value={facts.balanceLabel} />
        ) : null}
      </dl>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
