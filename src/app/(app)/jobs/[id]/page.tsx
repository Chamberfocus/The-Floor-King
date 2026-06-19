import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  MapPin,
  Calendar,
  User,
  Trash2,
  Play,
  Check,
  Send,
  Megaphone,
  Ruler,
  FileText,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { SearchPicker } from "@/components/ui/search-picker";
import { JobStatusBadge } from "@/components/job-status-badge";
import {
  getJob,
  listAssignableUsers,
  listJobFiles,
  getJobApplications,
} from "@/lib/data/jobs";
import { getProfileNames } from "@/lib/data/customers";
import { getJobCostAnalysis } from "@/lib/data/finance";
import { listJobLabor } from "@/lib/data/job-labor";
import { getJobMaterials } from "@/lib/data/job-materials";
import { getMeasurementDocuments } from "@/lib/data/documents";
import { JobMeasurementUpload } from "./measurement-upload";
import {
  getSchedulingSettings,
  getInstallerSuggestions,
} from "@/lib/data/scheduling";
import { installDaysForJob } from "@/lib/scheduling";
import { bookInstall } from "../actions";
import { requireProfile } from "@/lib/auth";
import { lineTotal } from "@/lib/estimate-calc";
import { formatDate, formatMoney } from "@/lib/format";
import { JobForm } from "../job-form";
import {
  setJobStatus,
  deleteJob,
  emailJobSchedule,
  postJobToBoard,
  unpostJobFromBoard,
  assignInstaller,
} from "../actions";
import { deleteJobFile } from "../file-actions";
import { JobPhotoUpload } from "../job-photo-upload";
import { SignaturePad } from "../signature-pad";
import { JobLaborCard } from "./job-labor-card";
import { JobMaterialsCard } from "./job-materials-card";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const job = await getJob(id);
  return { title: job?.title ?? "Job" };
}

export default async function JobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireProfile();
  const isStaff = profile.role === "admin" || profile.role === "office";

  const job = await getJob(id);
  if (!job) notFound();

  const users = isStaff ? await listAssignableUsers() : [];
  const names = job.assigned_to ? await getProfileNames([job.assigned_to]) : {};
  const assignedName = job.assigned_to ? names[job.assigned_to] : null;

  const files = await listJobFiles(id);
  const photos = files.filter((f) => f.kind === "photo");
  const signatures = files.filter((f) => f.kind === "signature");

  const isAssignedToMe = job.assigned_to === profile.id;
  const applicants = isStaff ? await getJobApplications(id) : [];

  // Profit/cost analysis is owner & admin only.
  const costAnalysis =
    profile.role === "admin" ? await getJobCostAnalysis(id) : null;
  // Crew pay capture (real labor cost) — staff only.
  const jobLabor = isStaff ? await listJobLabor(id) : [];
  // Materials & sourcing (stock vs special-order) — staff only.
  const jobMaterials = isStaff ? await getJobMaterials(id) : null;
  // Measurement diagrams (uploaded sketch + saved carpet plan) — everyone on
  // the job, crew included, so installers can read them without digging.
  const measureDocs = job.customer_id
    ? await getMeasurementDocuments(job.customer_id)
    : [];

  // Smart install scheduling (staff + scheduler).
  const canSchedule = isStaff || profile.role === "scheduler";
  const schedSettings = canSchedule ? await getSchedulingSettings() : null;
  const installEst =
    schedSettings && job.line_items.length
      ? installDaysForJob(job.line_items, schedSettings)
      : null;
  const installerSuggestions =
    schedSettings && installEst && installEst.days > 0
      ? await getInstallerSuggestions(job.line_items, schedSettings)
      : [];

  const siteParts = [
    job.site_street,
    [job.site_city, job.site_state].filter(Boolean).join(", "),
    job.site_zip,
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/jobs"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to jobs
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {job.title || "Job"}
            </h1>
            <JobStatusBadge status={job.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {isStaff && job.customer ? (
              <Link
                href={`/customers/${job.customer_id}`}
                className="hover:underline"
              >
                {job.customer.full_name}
              </Link>
            ) : (
              job.customer?.full_name
            )}
          </p>
        </div>
        {/* Quick actions — the assigned installer or staff */}
        {isStaff || isAssignedToMe ? (
          <div className="flex items-center gap-2">
            {job.status !== "in_progress" && job.status !== "completed" ? (
              <form action={setJobStatus}>
                <input type="hidden" name="id" value={job.id} />
                <input type="hidden" name="status" value="in_progress" />
                <Button type="submit" variant="outline">
                  <Play className="size-4" /> Start job
                </Button>
              </form>
            ) : null}
            {job.status !== "completed" ? (
              <form action={setJobStatus}>
                <input type="hidden" name="id" value={job.id} />
                <input type="hidden" name="status" value="completed" />
                <Button type="submit">
                  <Check className="size-4" /> Mark complete
                </Button>
              </form>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Schedule / site summary */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 py-4 text-sm">
            <Calendar className="size-4 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">Scheduled</div>
              <div className="font-medium">
                {job.scheduled_date ? formatDate(job.scheduled_date) : "Not set"}
                {job.scheduled_end
                  ? ` – ${formatDate(job.scheduled_end)}`
                  : ""}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4 text-sm">
            <User className="size-4 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">Crew</div>
              <div className="font-medium">{assignedName ?? "Unassigned"}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4 text-sm">
            <MapPin className="size-4 shrink-0 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">Job site</div>
              <div className="font-medium">
                {siteParts.length ? siteParts.join(" · ") : "—"}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {isStaff && job.scheduled_date ? (
        <form action={emailJobSchedule} className="mb-6">
          <input type="hidden" name="id" value={job.id} />
          <Button type="submit" variant="outline" size="sm">
            <Send className="size-3.5" /> Email schedule to customer
          </Button>
        </form>
      ) : null}

      {/* Work order scope */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Work order — scope</CardTitle>
        </CardHeader>
        <CardContent>
          {job.line_items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No scope attached. Link this job to an approved estimate to pull in
              the rooms and materials.
            </p>
          ) : (
            <div className="divide-y text-sm">
              {job.line_items.map((l) => (
                <div
                  key={l.id}
                  className="flex items-start justify-between gap-4 py-2"
                >
                  <div>
                    <div className="font-medium">
                      {l.room ? `${l.room} — ` : ""}
                      {l.description || "Line item"}
                    </div>
                    {l.sqft ? (
                      <div className="text-xs text-muted-foreground">
                        {l.sqft} sq ft
                      </div>
                    ) : null}
                  </div>
                  {isStaff ? (
                    <div className="shrink-0 text-muted-foreground">
                      {formatMoney(lineTotal(l))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {job.notes ? (
            <div className="mt-4 rounded-md bg-muted p-3 text-sm">
              <div className="mb-1 font-medium">Notes for crew</div>
              <p className="whitespace-pre-wrap text-muted-foreground">
                {job.notes}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Measurements & diagrams — big & clear for the installers */}
      {job.customer_id ? (
        <Card className="mb-6 border-primary/30">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Ruler className="size-4 text-primary" /> Measurements &amp; diagrams
            </CardTitle>
            <JobMeasurementUpload jobId={job.id} />
          </CardHeader>
          <CardContent>
            {measureDocs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No measurement diagram yet. Snap a photo of the field measurements
                or attach the salesperson&apos;s drawing so the crew can see it.
              </p>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  {measureDocs.map((d) => {
                    const img = (d.mime ?? "").startsWith("image/");
                    return (
                      <a
                        key={d.id}
                        href={d.url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="block overflow-hidden rounded-lg border transition-colors hover:border-primary"
                      >
                        {img && d.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={d.url}
                            alt={d.name}
                            className="max-h-[28rem] w-full bg-muted object-contain"
                          />
                        ) : (
                          <div className="flex items-center gap-2 p-6 text-sm">
                            <FileText className="size-6 text-muted-foreground" />
                            Open {d.name}
                          </div>
                        )}
                        <div className="border-t px-3 py-2 text-xs font-medium">
                          {d.name}
                        </div>
                      </a>
                    );
                  })}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Tap a diagram to open it full-size.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Smart install scheduling */}
      {schedSettings && installEst ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Smart install scheduling</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {installEst.days === 0 ? (
              <p className="text-sm text-muted-foreground">
                Add material types &amp; quantities to the estimate so the
                scheduler can size this job.
              </p>
            ) : (
              <>
                <div>
                  <div className="text-sm">
                    Estimated{" "}
                    <span className="font-semibold">
                      {installEst.days} day{installEst.days === 1 ? "" : "s"}
                    </span>{" "}
                    based on your crew capacity:
                  </div>
                  <ul className="mt-1 text-xs text-muted-foreground">
                    {installEst.breakdown.map((b, i) => (
                      <li key={i}>
                        • {b.label}: {b.amount.toFixed(0)} {b.unit} →{" "}
                        {b.days.toFixed(2)} day(s)
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium">Next available crews</div>
                  {installerSuggestions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No installers found. Add crew under Team.
                    </p>
                  ) : (
                    installerSuggestions.slice(0, 4).map((sug) => (
                      <div
                        key={sug.installerId}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
                      >
                        <div>
                          <span className="font-medium">{sug.name}</span>{" "}
                          <span className="text-muted-foreground">
                            — {sug.days} day{sug.days === 1 ? "" : "s"},{" "}
                            {formatDate(sug.start)}
                            {sug.end !== sug.start ? ` → ${formatDate(sug.end)}` : ""}
                          </span>
                        </div>
                        <form action={bookInstall}>
                          <input type="hidden" name="job_id" value={job.id} />
                          <input
                            type="hidden"
                            name="installer_id"
                            value={sug.installerId}
                          />
                          <input type="hidden" name="start" value={sug.start} />
                          <input type="hidden" name="end" value={sug.end} />
                          <Button type="submit" size="sm" variant="outline">
                            Book
                          </Button>
                        </form>
                      </div>
                    ))
                  )}
                </div>

                {/* Manual booking */}
                <details className="border-t pt-3">
                  <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
                    Schedule manually
                  </summary>
                  <form
                    action={bookInstall}
                    className="mt-2 flex flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="job_id" value={job.id} />
                    <div>
                      <label className="mb-1 block text-xs text-muted-foreground">
                        Installer
                      </label>
                      <SearchPicker
                        name="installer_id"
                        defaultValue={job.assigned_to ?? ""}
                        placeholder="— Choose —"
                        options={users
                          .filter((u) => u.role === "crew")
                          .map((u) => ({ value: u.id, label: u.name }))}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-muted-foreground">
                        Start
                      </label>
                      <input
                        type="date"
                        name="start"
                        required
                        defaultValue={job.scheduled_date ?? ""}
                        className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-muted-foreground">
                        End
                      </label>
                      <input
                        type="date"
                        name="end"
                        defaultValue={job.scheduled_end ?? ""}
                        className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                      />
                    </div>
                    <Button type="submit" size="sm">
                      Book manually
                    </Button>
                  </form>
                </details>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Materials & sourcing (stock vs special-order) — staff only */}
      {jobMaterials ? <JobMaterialsCard data={jobMaterials} /> : null}

      {/* Crew pay (real subcontractor labor cost) — staff only */}
      {isStaff ? <JobLaborCard jobId={id} rows={jobLabor} /> : null}

      {/* Profitability — estimated vs actual (owner/admin only) */}
      {costAnalysis ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">
              Profitability — estimated vs actual
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!costAnalysis.hasEstimateCosts ? (
              <p className="text-sm text-muted-foreground">
                No costs were entered on the estimate, so there&apos;s nothing to
                compare yet. Add material/labor costs in the wizard to track
                margin here.
              </p>
            ) : null}
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Metric</th>
                    <th className="px-3 py-2 text-right">Estimated</th>
                    <th className="px-3 py-2 text-right">Actual</th>
                    <th className="px-3 py-2 text-right">Variance</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <tr>
                    <td className="px-3 py-2">Material cost</td>
                    <td className="px-3 py-2 text-right">
                      {formatMoney(costAnalysis.estMaterial)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatMoney(costAnalysis.actualMaterial)}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {formatMoney(
                        costAnalysis.actualMaterial - costAnalysis.estMaterial,
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2">Labor / other cost</td>
                    <td className="px-3 py-2 text-right">
                      {formatMoney(costAnalysis.estLabor)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatMoney(costAnalysis.actualExpense)}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {formatMoney(
                        costAnalysis.actualExpense - costAnalysis.estLabor,
                      )}
                    </td>
                  </tr>
                  <tr className="font-medium">
                    <td className="px-3 py-2">Total cost</td>
                    <td className="px-3 py-2 text-right">
                      {formatMoney(costAnalysis.estCost)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatMoney(costAnalysis.actualCost)}
                    </td>
                    <td
                      className={
                        costAnalysis.costVariance > 0
                          ? "px-3 py-2 text-right text-destructive"
                          : "px-3 py-2 text-right text-emerald-600"
                      }
                    >
                      {costAnalysis.costVariance > 0 ? "+" : ""}
                      {formatMoney(costAnalysis.costVariance)}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2">Profit (at sold price)</td>
                    <td className="px-3 py-2 text-right">
                      {formatMoney(costAnalysis.estProfit)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatMoney(costAnalysis.actualProfit)}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {formatMoney(
                        costAnalysis.actualProfit - costAnalysis.estProfit,
                      )}
                    </td>
                  </tr>
                  <tr className="font-semibold">
                    <td className="px-3 py-2">Margin</td>
                    <td className="px-3 py-2 text-right">
                      {costAnalysis.estMargin.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-right">
                      {costAnalysis.actualMargin.toFixed(1)}%
                    </td>
                    <td
                      className={
                        costAnalysis.marginDelta < 0
                          ? "px-3 py-2 text-right text-destructive"
                          : "px-3 py-2 text-right text-emerald-600"
                      }
                    >
                      {costAnalysis.marginDelta >= 0 ? "+" : ""}
                      {costAnalysis.marginDelta.toFixed(1)} pts
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Actual material = purchase orders on this estimate. Actual
              labor/other = expenses logged to this job. Revenue held at the sold
              price to show whether the job hit its target margin.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Photos & sign-off */}
      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Photos &amp; sign-off</CardTitle>
          <JobPhotoUpload jobId={job.id} />
        </CardHeader>
        <CardContent className="space-y-4">
          {photos.length ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {photos.map((f) => (
                <div key={f.id} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {f.url ? (
                    <img
                      src={f.url}
                      alt={f.caption ?? "Job photo"}
                      className="aspect-square w-full rounded-md border object-cover"
                    />
                  ) : null}
                  {isStaff ? (
                    <form
                      action={deleteJobFile}
                      className="absolute right-1 top-1"
                    >
                      <input type="hidden" name="id" value={f.id} />
                      <input type="hidden" name="job_id" value={job.id} />
                      <input type="hidden" name="path" value={f.path} />
                      <Button
                        type="submit"
                        variant="destructive"
                        size="icon-xs"
                        aria-label="Delete photo"
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </form>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No photos yet. Tap &ldquo;Upload photos&rdquo; to add job-site
              pictures (works with your phone camera).
            </p>
          )}

          <div className="border-t pt-4">
            <div className="mb-2 text-sm font-medium">Customer sign-off</div>
            {signatures.length ? (
              <div className="space-y-2">
                {signatures.map((s) => (
                  <div key={s.id} className="rounded-md border p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {s.url ? (
                      <img src={s.url} alt="Signature" className="h-24 bg-white" />
                    ) : null}
                    <div className="mt-1 text-xs text-muted-foreground">
                      {s.signer_name ? `Signed by ${s.signer_name} · ` : ""}
                      {formatDate(s.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <SignaturePad jobId={job.id} />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Staff editing */}
      {isStaff ? (
        <>
          <Card className="mb-6">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Job board</CardTitle>
              {job.open_for_claim ? (
                <form action={unpostJobFromBoard}>
                  <input type="hidden" name="id" value={job.id} />
                  <Button type="submit" variant="outline" size="sm">
                    Remove from board
                  </Button>
                </form>
              ) : (
                <form action={postJobToBoard}>
                  <input type="hidden" name="id" value={job.id} />
                  <Button type="submit" size="sm">
                    <Megaphone className="size-3.5" /> Post to board
                  </Button>
                </form>
              )}
            </CardHeader>
            <CardContent>
              {applicants.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {job.open_for_claim
                    ? "Posted — waiting for installers to apply."
                    : "Post this job so installers can claim it."}
                </p>
              ) : (
                <ul className="divide-y text-sm">
                  {applicants.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <span className="font-medium">{a.installer_name}</span>
                      {job.assigned_to === a.installer_id ? (
                        <span className="text-xs font-medium text-green-600">
                          Assigned ✓
                        </span>
                      ) : (
                        <form action={assignInstaller}>
                          <input type="hidden" name="job_id" value={job.id} />
                          <input
                            type="hidden"
                            name="installer_id"
                            value={a.installer_id}
                          />
                          <Button type="submit" size="sm">
                            Assign
                          </Button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Schedule &amp; details</CardTitle>
            </CardHeader>
            <CardContent>
              <JobForm job={job} users={users} />
            </CardContent>
          </Card>

          <div className="mt-4 flex items-center justify-between">
            {job.estimate_id ? (
              <Link
                href={`/estimates/${job.estimate_id}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                View source estimate
              </Link>
            ) : (
              <span />
            )}
            <form action={deleteJob}>
              <input type="hidden" name="id" value={job.id} />
              <input type="hidden" name="customer_id" value={job.customer_id} />
              <Button type="submit" variant="destructive" size="sm">
                <Trash2 className="size-3.5" /> Delete job
              </Button>
            </form>
          </div>
        </>
      ) : null}
    </div>
  );
}
