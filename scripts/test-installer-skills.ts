// Regression tests for the Job Board skill gate. Run: node scripts/test-installer-skills.ts
import { installerCanDoJob } from "@/lib/job-scope";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => {
  if (c) pass++;
  else { fail++; console.log(`  ✗ ${m}`); }
};

// The reported bug: carpet-only Ryan must NOT be offered a hard-surface job.
ok(installerCanDoJob(["carpet"], "hard") === false, "carpet-only installer is NOT offered a hard-surface job");
ok(installerCanDoJob(["carpet"], "carpet") === true, "carpet installer IS offered a carpet job");
ok(installerCanDoJob(["hard"], "hard") === true, "hard installer IS offered a hard-surface job");
ok(installerCanDoJob(["hard"], "carpet") === false, "hard-only installer is NOT offered a carpet job");

// Mixed carpet+hard jobs need BOTH skills (chosen: only both-skilled installers).
ok(installerCanDoJob(["carpet", "hard"], "both") === true, "both-skilled installer IS offered a mixed job");
ok(installerCanDoJob(["carpet"], "both") === false, "carpet-only installer is NOT offered a mixed job");
ok(installerCanDoJob(["hard"], "both") === false, "hard-only installer is NOT offered a mixed job");
ok(installerCanDoJob(["carpet", "hard"], "carpet") === true, "both-skilled installer sees a carpet job");
ok(installerCanDoJob(["carpet", "hard"], "hard") === true, "both-skilled installer sees a hard job");

// Unset skills → sees everything (safe rollout).
ok(installerCanDoJob([], "hard") === true, "unset skills → sees a hard job");
ok(installerCanDoJob([], "carpet") === true, "unset skills → sees a carpet job");
ok(installerCanDoJob([], "both") === true, "unset skills → sees a mixed job");
ok(installerCanDoJob(undefined, "hard") === true, "null skills → sees everything");

// Unknown material type is never hidden.
ok(installerCanDoJob(["carpet"], null) === true, "unknown material → shown even to a specialist");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
