# Customer / Job Workflow Audit

Read-only audit. No source files were modified. Every claim below cites the real
file and line it came from (`path:line`). Nothing here is inferred from naming —
it is traced from the code that runs.

---

## 0. How the pipeline is actually modeled (read this first)

There are **two coupled stage representations**, kept in lock-step:

| Representation | Where it lives | Values |
|---|---|---|
| **Editable workflow spine** (source of truth) | `customers.workflow_stage_id` → `workflow_stages` table | Dynamic UUID rows. Seeded default set below. |
| **Legacy coarse pipeline** (derived, never edited directly) | `customers.stage` (`lead_stage` enum) | `new`, `contacted`, `estimate_scheduled`, `quoted`, `won`, `lost` — `supabase/migrations/0002_customers.sql:7` |

- `workflow_stages` schema: `supabase/migrations/0013_workflow.sql:7` — columns `id, name, position, color, default_owner, created_at`, plus later additions: `auto_action` (default `'none'`, `0029_stage_auto_action.sql:5`), `next_action` + `sla_hours` (default `0`, `0034_stage_next_action_sla.sql:4`), `owner_duty` (`0051_stage_owner_duty.sql:6`).
- **Seeded default stages** (`0013_workflow.sql:63`): `New Lead`(10,blue) · `Estimating`(20,amber) · `Proposal Sent`(30,cyan) · `Sold / Approved`(40,green) · `Materials & Warehouse`(50,purple) · `Scheduling`(60,indigo) · `Installation`(70,teal) · `Invoicing & Payment`(80,rose) · `Complete`(90,zinc). These are **editable** in Settings → Stages (`src/app/(app)/settings/stages/`), so a live shop's names/positions may differ.
- The **legacy `stage` enum is derived from the workflow stage** by `deriveLeadStage()` (`src/lib/workflow-engine.ts:66`) on every move, so they never diverge. Anchors used: a stage's `auto_action` = `collect_deposit` → `won`, `build_quote` → `quoted`, `schedule_estimate` → `estimate_scheduled`; name matching `lost|declin|dead|cancel` → `lost`.

### The guided spine the user actually clicks through

The customer dashboard renders **one** driver — `GuidedFlow` (`src/app/(app)/customers/[id]/guided-flow.tsx`). It maps the customer's current `workflow_stage` to one of **13 flow steps** via `resolveFlowStep()` (`src/lib/job-flow.ts:96`), then renders that step's inline tool + a strict "Ready for next stage" gate.

`resolveFlowStep` anchor order (`src/lib/job-flow.ts:104`): **(1) `auto_action` marker** (`schedule_estimate`→`schedule_estimate`, `build_quote`→`build_quote`, `collect_deposit`→`collect_deposit`, `schedule_install`→`schedule_install`); **(2) stage name regex**; **(3) position between anchors**. First mainline stage → `contact`, last → `complete`.

> Dependency worth flagging: steps `schedule_estimate`, `build_quote`, `collect_deposit`, `schedule_install` only resolve if a stage carries that `auto_action`. The seed (`0013`) does **not** set `auto_action` — it must be configured in Settings → Stages, otherwise those stages fall back to name/position matching in `resolveFlowStep`.

The **advance gate** is `stepGate()` (`src/lib/job-flow.ts:160`) reading real records (`FlowFacts`, computed at `guided-flow.tsx:203`). Advancing is otherwise **manual** via the `advanceWorkflow` server action. Separately, real events **auto-advance forward-only** through the workflow engine (`src/lib/workflow-engine.ts`, `AUTO_ADVANCE_DISABLED = false` at line 30).

---

## Per-stage rows

Each row is a **flow step** (what the user is actually looking at on the dashboard), mapped to its workflow stage + derived `lead_stage`. "Clicks to advance" are the literal in-order clicks in the guided hero. The gate reason (why advance is blocked) is quoted from `stepGate`.

---

### STAGE 1 — `contact` · "Reach out & set the estimate"

1. **DB value:** first mainline `workflow_stages` row (seed `New Lead`, pos 10). `resolveFlowStep`→`contact` (`job-flow.ts:110`). Derived `customers.stage` = `new` (`workflow-engine.ts:83`). `STEP_TITLES.contact` (`job-flow.ts:70`).
2. **Route(s):** `/customers/[id]` only.
3. **Component(s):** `src/app/(app)/customers/[id]/page.tsx` → `GuidedFlow` (`guided-flow.tsx:222`, `step==="contact"` branch) → `EstimateScheduler` (`estimate-scheduler.tsx`).
4. **Clicks to advance (in order):**
   a. (Path A) In **Activity** tab, type a note/call → **"Save"** (`AddActivityForm` → `addActivity`, `customers/actions.ts:230`). — OR —
   b. (Path B) In the hero, **"Schedule estimate"** → pick rep/date/time → **"Book"** (`EstimateScheduler` → `bookEstimateAppointment`, `schedule-actions.ts:75`).
   c. Gate opens once `hasActivity || estimateBooked` (`job-flow.ts:163`); click **"Ready for next stage"** (`AdvanceButton` → `advanceWorkflow`, `guided-flow.tsx:101` / `customers/actions.ts:267`).
   - Gate-blocked reason: *"Log a call or note in Activity (or book the estimate) before advancing."* (`job-flow.ts:165`).
5. **Navigated away from dashboard:** none for this step. All three actions revalidate/stay on `/customers/[id]` (`addActivity` returns state; `advanceWorkflow` `redirect(redirectTo ?? /customers/${id})` at `customers/actions.ts:374`; `bookEstimateAppointment` `redirect(redirectTo ?? /customers/${id})` at `schedule-actions.ts:224`).
6. **Data written:**
   - `addActivity` → `activities` (`customer_id, user_id, type, body`) `customers/actions.ts:245`; then `advanceFromFirstStage` (`workflow-engine.ts` — moves stage-1 lead to stage 2, writing `customers.workflow_stage_id/workflow_owner_id/next_action_due/stage` + `handoffs` + `activities`).
   - `bookEstimateAppointment` → see STAGE 2.
   - `advanceWorkflow` → `customers` (`workflow_stage_id, workflow_owner_id, next_action_due, stage`, + `cancelled_at/cancel_reason` when Lost) `customers/actions.ts:311`; `handoffs` (`customer_id, from/to_stage_id, from/to_user, note`) `:333`; `activities` (`type:'stage_change'`) `:342`.

---

### STAGE 2 — `schedule_estimate` · "Schedule the estimate"

1. **DB value:** stage with `auto_action = 'schedule_estimate'` (`job-flow.ts:105`). Derived `stage` = `estimate_scheduled` once at/after that stage (`workflow-engine.ts:81`).
2. **Route(s):** `/customers/[id]`. (Qualification, if used, is a side trip — see List C.)
3. **Component(s):** `guided-flow.tsx:222` (`schedule_estimate` shares the `contact` branch, `autoOpen`) → `EstimateScheduler` (`estimate-scheduler.tsx`).
4. **Clicks to advance:**
   a. Hero scheduler is auto-opened; pick rep → **"Suggest times"** (`suggestEstimateTimes`, `schedule-actions.ts:41`) or manual date/time.
   b. **"Book"** → `bookEstimateAppointment` (`schedule-actions.ts:75`).
   c. Booking **auto-advances** off this stage (`advanceFromAutoAction(customerId,"schedule_estimate")`, `schedule-actions.ts:216`). Manual **"Ready for next stage"** also available; gate needs `estimateBooked` (`job-flow.ts:168`).
   - Blocked reason: *"Book the in-home estimate or showroom visit to advance."*
5. **Navigated away:** none — `bookEstimateAppointment` ends `redirect(redirectTo ?? /customers/${id})` (`schedule-actions.ts:224`).
6. **Data written by `bookEstimateAppointment`:**
   - `appointments`: cancels prior scheduled estimate appts (`status:'cancelled'`, `:113`), inserts new (`customer_id, salesperson_id, kind:'estimate', starts_at, ends_at, address, drive_minutes, status:'scheduled', created_by`) `schedule-actions.ts:143`.
   - `activities` (`type:'note'`, "Estimate appointment scheduled…") `:161`.
   - Side effects: Google Calendar sync (`syncAppointmentToGoogle`), email to rep + customer, SMS to customer (`:170`–`:214`).
   - `advanceFromAutoAction` → `customers` + `handoffs` + `activities` (via `applyMove`, `workflow-engine.ts:88`).

---

### STAGE 3 — `estimate_booked` · "Measure & meet the customer"

1. **DB value:** the stage after `schedule_estimate` on the spine; name matching `estimate|measur` (`job-flow.ts:115`) → step `estimate_booked`. Derived `stage` typically `estimate_scheduled`.
2. **Route(s):** `/customers/[id]`.
3. **Component(s):** `guided-flow.tsx:237` (`estimate_booked` branch) → collapsible `EstimateScheduler` (reschedule only).
4. **Clicks to advance:**
   a. (Soft step — no digital measurement record.) Optionally reschedule via the `<details>` scheduler.
   b. Click **"Ready for next stage"** — **always allowed** (`stepGate` returns `OK`, `job-flow.ts:171`: "advances freely").
5. **Navigated away:** none.
6. **Data written:** only `advanceWorkflow` (customers/handoffs/activities). Reschedule writes `appointments` as in STAGE 2.

---

### STAGE 4 — `build_quote` · "Build & send the quote"

1. **DB value:** stage with `auto_action = 'build_quote'` (`job-flow.ts:106`). Derived `stage` = `quoted` at/after (`workflow-engine.ts:80`).
2. **Route(s):** `/customers/[id]` **plus one of** `/estimates/guided`, `/estimates/[id]/edit`, `/estimates/[id]` (this step **requires leaving** the dashboard — see List C).
3. **Component(s):** `guided-flow.tsx:258` (`build_quote` branch) → `EstimateSourceGate` (`estimate-source-gate.tsx`) + "Continue current draft" `Link`. Builder route: `src/app/(app)/estimates/[id]/edit/page.tsx`. Guided questionnaire: `src/app/(app)/estimates/guided/page.tsx`.
4. **Clicks to advance:**
   a. **"Guided questionnaire"** → (if source unset, fills source dialog first) → `router.push('/estimates/guided?customer=<id>')` (`estimate-source-gate.tsx:42`). — OR — **"Build estimate"** → `createEstimate` → `redirect('/estimates/<id>/edit')` (`estimates/actions.ts:80`). — OR — **"Continue current draft"** `Link` → `/estimates/<id>/edit` (`guided-flow.tsx:266`).
   b. On the builder/questionnaire, build lines and **send** the estimate (`setEstimateStatus status=sent`, `estimates/actions.ts:246`, or `sendEstimateById`, `:692`). Sending **auto-advances** off `build_quote` (`advanceFromAutoAction(...,"build_quote")`, `estimates/actions.ts:278` / `:711`).
   c. If returning to the dashboard still on this stage: **"Ready for next stage"**; gate needs `estimateSent` (`job-flow.ts:174`). Blocked reason: *"Send the quote to the customer to advance."*
5. **Navigated away from dashboard:**
   - `router.push('/estimates/guided?customer=<id>')` (`estimate-source-gate.tsx:42`).
   - `createEstimate` → `redirect('/estimates/<id>/edit')` (`estimates/actions.ts:80`).
   - "Continue current draft" `Link href="/estimates/<id>/edit"` (`guided-flow.tsx:266`).
   - (Guided questionnaire finalize lands on `/estimates/<id>/edit` — `estimates/actions.ts:80` / `smart-actions.ts:247`.)
   - `setEstimateStatus` ends `redirect('/estimates/<id>')` (`estimates/actions.ts:358`) — user stays on the estimate, not the dashboard.
6. **Data written:**
   - `createEstimate` → `estimates` (`customer_id, created_by, title, valid_until`) `:64`; `estimate_options` (`estimate_id, name, position`) `:76`.
   - Builder save `saveEstimate` → `estimates`, `estimate_options`, `estimate_line_items` (`estimates/actions.ts:84`+).
   - `setEstimateStatus`/`sendEstimateById` → `estimates` (`status:'sent', sent_at, thankyou_sent_at`) `:253`/`:696`; auto-advance writes `customers/handoffs/activities`.

---

### STAGE 5 — `approve` · "Get the quote approved"

1. **DB value:** stage between `build_quote` and `collect_deposit`, or name matching `response|approv` (`job-flow.ts:114`,`:130`) → step `approve`. Derived `stage` = `quoted`.
2. **Route(s):** `/customers/[id]` (+ optional `/estimates/[id]` to open it).
3. **Component(s):** `guided-flow.tsx:280` (`approve` branch); "Open estimate" `Link`; inline **Mark approved** form (`setEstimateStatus`).
4. **Clicks to advance:**
   a. Optional **"Open estimate"** `Link` → `/estimates/<id>` (`guided-flow.tsx:290`).
   b. **"Mark approved"** (inline form, `guided-flow.tsx:296` → `setEstimateStatus status=approved`, `estimates/actions.ts:246`). On approval it **auto-jumps to the deposit stage** (`moveToAutoActionStage(...,"collect_deposit")`, `:277`) **and auto-creates the job** (`ensureJobForEstimate`, `:288`).
   c. Gate needs `estimateApproved` (`job-flow.ts:177`). Blocked reason: *"Mark the estimate approved (customer said yes) to advance."*
5. **Navigated away:** "Open estimate" `Link` → `/estimates/<id>` (`guided-flow.tsx:290`). Marking approved **from the dashboard form** posts and returns; but `setEstimateStatus` itself ends `redirect('/estimates/<id>')` (`estimates/actions.ts:358`) → lands on the estimate page.
6. **Data written by approval:** `estimates` (`status:'approved', accepted_option_id`) `:262`; `moveToAutoActionStage` → `customers`(`workflow_stage_id, workflow_owner_id, next_action_due, stage`)+`handoffs`+`activities` (`workflow-engine.ts:88`); `ensureJobForEstimate` → `jobs` insert (see STAGE 7 columns) `jobs/actions.ts:533`; approval emails to owner + rep.

---

### STAGE 6 — `collect_deposit` · "Collect the deposit"

1. **DB value:** stage with `auto_action = 'collect_deposit'` (`job-flow.ts:107`). Derived `stage` = `won` at/after (`workflow-engine.ts:79`).
2. **Route(s):** `/customers/[id]` **plus** `/estimates/[id]/invoice` or `/invoices/[id]` (**requires leaving** to create/record the deposit).
3. **Component(s):** `guided-flow.tsx:316` (`collect_deposit` branch) — "Open invoice & record payment" / "Create deposit invoice" `Link`s. Routes: `src/app/(app)/estimates/[id]/invoice/page.tsx`, `src/app/(app)/invoices/[id]/page.tsx`.
4. **Clicks to advance:**
   a. **"Create deposit invoice"** `Link` → `/estimates/<id>/invoice` (`guided-flow.tsx:333`), builds invoice from estimate → `/invoices/<id>` (`createInvoiceFromEstimate`, `invoices/actions.ts:203`). — OR — **"Open invoice & record payment"** `Link` → `/invoices/<id>` (`guided-flow.tsx:326`).
   b. On the invoice page, **"Record payment"** → `recordPayment` (`invoices/actions.ts:365`). A deposit here **auto-advances** off `collect_deposit` (`advanceFromAutoAction(...,"collect_deposit")`, `:393`).
   c. Gate needs `depositPaid` (any invoice with a payment; `job-flow.ts:180`). Blocked reason: *"Record the deposit payment to advance."*
5. **Navigated away:** "Create deposit invoice" `Link`→`/estimates/<id>/invoice`; "Open invoice…" `Link`→`/invoices/<id>` (`guided-flow.tsx:326`,`:333`). `recordPayment` stays on the invoice (revalidate only, no redirect).
6. **Data written:** `createInvoiceFromEstimate` → `invoices` + `invoice_items` (`invoices/actions.ts:141`,`:200`); `recordPayment` → `payments` (`invoice_id, amount, method, reference, paid_at, notes, created_by`) `:374`, `recomputeStatus` updates `invoices.status`; auto-advance writes `customers/handoffs/activities`.

---

### STAGE 7 — `materials` · "Order & prep materials"

1. **DB value:** stage between `collect_deposit` and `schedule_install`, or name `material|order|warehouse|stag` (`job-flow.ts:132`,`:135`) → step `materials`. Seed `Materials & Warehouse` (50). Derived `stage` = `won`.
2. **Route(s):** `/customers/[id]` **plus** `/jobs/[id]` (create job) and/or `/purchase-orders`, `/purchase-orders/[id]`.
3. **Component(s):** `guided-flow.tsx:346` (`materials` branch) — inline **Create job** / **Create purchase order** forms, **Purchase orders** `Link`, `JobMaterialsCard`. Routes: `src/app/(app)/jobs/[id]/page.tsx`, `src/app/(app)/purchase-orders/`.
4. **Clicks to advance:**
   a. If no job yet: **"Create job"** (`createJobFromEstimate`, `jobs/actions.ts:563`) → `redirect('/jobs/<id>?created=1')`. (Note: approval in STAGE 5 usually already created the job.)
   b. **"Create purchase order"** (`createPOFromEstimate`, `purchase-orders/actions.ts:250`) → `redirect('/purchase-orders/<id>')`; and/or **"Purchase orders"** `Link` → `/purchase-orders`.
   c. Receiving a PO (`setPurchaseOrderStatus status=received`, `purchase-orders/actions.ts:609`) **auto-advances to "Materials Received"** (`advanceToNamedStage(..., /material.*received/)`, `:648`). Warehouse staging (`completeWarehouseJob`/`setWarehouseStatus status=staged`) **auto-advances to `schedule_install`** (`moveToAutoActionStage(...,"schedule_install")`, `jobs/actions.ts:1310`,`:1521`).
   d. Manual gate needs `workOrderExists` (a job exists; `job-flow.ts:183`). Blocked reason: *"Create the work order to advance."*
5. **Navigated away from dashboard:**
   - **"Create job"** form → `createJobFromEstimate` → `redirect('/jobs/<id>?created=1')` (`jobs/actions.ts:571`).
   - **"Create purchase order"** form → `createPOFromEstimate` → `redirect('/purchase-orders/<id>')` (`purchase-orders/actions.ts:275`/`:349`/`:421`).
   - **"Purchase orders"** `Link href="/purchase-orders"` (`guided-flow.tsx:371`).
6. **Data written:**
   - `ensureJobForEstimate`/`createJobFromEstimate` → `jobs` (`customer_id, estimate_id, option_id, service_address_id, title, notes, created_by, site_street/city/state/zip`) `jobs/actions.ts:533`; queues `prepareJobMaterialsFor` (stock reserve + POs).
   - `createPOFromEstimate` → `purchase_orders` (+ `po_items`) `purchase-orders/actions.ts:341`/`:388`.
   - `setPurchaseOrderStatus` → `purchase_orders.status` + `reconcilePoStock` + auto-advance (`customers/handoffs/activities`).
   - Warehouse staging → `jobs` (`warehouse_status:'staged', warehouse_ready_at, staging_location`) `jobs/actions.ts:1289` + auto-advance.

---

### STAGE 8 — `schedule_install` · "Schedule the install"

1. **DB value:** stage with `auto_action = 'schedule_install'` (`job-flow.ts:108`). Seed `Scheduling` (60). Derived `stage` = `won`.
2. **Route(s):** `/customers/[id]` only (the scheduler lives on the file).
3. **Component(s):** `guided-flow.tsx:380` (`schedule_install` branch) → `InstallSchedule` (`install-schedule.tsx`), fed `installScheduleProps` built in `page.tsx:299`.
4. **Clicks to advance:**
   a. In the inline scheduler, pick installer + date (+ arrival window) from suggestions or manually → **"Book install"** (`InstallSchedule` → `bookInstall`, `jobs/actions.ts:163`).
   b. Booking **auto-advances to "Install Scheduled"** (`advanceToNamedStage(..., STAGE_INSTALL_SCHEDULED /^(?!.*\bneeds\b).*install.*sched/)`, `jobs/actions.ts:208`) and **auto-submits to warehouse** (`ensureWarehouseSubmitted`, `:214`).
   c. Manual gate needs `installBooked` (job has `scheduled_date`; `job-flow.ts:186`). Blocked reason: *"Book the install date in the scheduler to advance."*
5. **Navigated away:** **none** by default — `bookInstall` only redirects if a `redirect_to` is posted (`jobs/actions.ts:225`); the guided flow/file pass none, so it revalidates in place.
6. **Data written by `bookInstall`:** `jobs` (`assigned_to`, `assigned_crew_id?`, `scheduled_date`, `scheduled_end`, `status:'scheduled'`, `open_for_claim:false`) `jobs/actions.ts:181`; separate `jobs.arrival_window` update `:194`; `assigned_crew_id` reconcile `:218`; auto-advance → `customers/handoffs/activities`; warehouse submit side effects.

---

### STAGE 9 — `await_install` · "Install scheduled"

1. **DB value:** stage after install scheduled; name contains `install` (not matching earlier anchors) (`job-flow.ts:131`) → step `await_install`. Seed `Installation` (70). Derived `stage` = `won`. `jobs.status` transitions `scheduled`→`in_progress`→`completed` (`job_status` enum, `0005_jobs.sql:8`).
2. **Route(s):** `/customers/[id]` **plus** `/jobs/[id]` (mark install complete on the work order).
3. **Component(s):** `guided-flow.tsx:396` (`await_install` branch) — "Install booked" banner + **Open work order** `Link`. Route: `src/app/(app)/jobs/[id]/page.tsx`.
4. **Clicks to advance:**
   a. **"Open work order"** `Link` → `/jobs/<id>` (`guided-flow.tsx:417`).
   b. On the job page, set status **completed** (`setJobStatus`, `jobs/actions.ts:748`, or `updateJob`, `:700`). Completing **auto-advances to "Installed – Follow-up"** (`advanceToNamedStage(..., STAGE_INSTALLED /installed|follow/)`, `:766`/`:739`).
   c. Manual gate needs `installComplete` (a job `status==='completed'`; `job-flow.ts:189`). Blocked reason: *"Mark the install complete on the work order to advance."*
5. **Navigated away from dashboard:** **"Open work order"** `Link href="/jobs/<id>"` (`guided-flow.tsx:417`). `setJobStatus` returns void (revalidate); `updateJob` returns form state.
6. **Data written:** `setJobStatus`/`updateJob` → `jobs.status` (`:754`/`:713`) + auto-advance (`customers/handoffs/activities`).

---

### STAGE 10 — `followup` · "Sign-off & collect the balance"

1. **DB value:** stage name `follow|installed|satisf` (`job-flow.ts:129`) → step `followup`. Seed `Invoicing & Payment` (80). Derived `stage` = `won`.
2. **Route(s):** `/customers/[id]` **plus** `/invoices/[id]` (record final payment).
3. **Component(s):** `guided-flow.tsx:426` (`followup` branch) → `SatisfactionForm` (`jobs/[id]/satisfaction-form`) + open-balance list with **Record payment** `Link`s.
4. **Clicks to advance:**
   a. Optional: complete `SatisfactionForm` (customer sign-off).
   b. For each open invoice, **"Record payment"** `Link` → `/invoices/<id>` (`guided-flow.tsx:446`), then record on that page (`recordPayment`).
   c. Gate needs `balancePaid` (no open invoice balance; `job-flow.ts:192`). Blocked reason: *"Collect the remaining balance to advance."*
5. **Navigated away from dashboard:** **"Record payment"** `Link href="/invoices/<id>"` (`guided-flow.tsx:446`).
6. **Data written:** `SatisfactionForm` → job satisfaction record (`getJobSatisfaction` source); `recordPayment` → `payments` + `invoices.status` (`invoices/actions.ts:374`).

---

### STAGE 11 — `complete` · "Job complete"

1. **DB value:** last mainline stage (`job-flow.ts:111`). Seed `Complete` (90). Derived `stage` = `won`. **Terminal** — not gated (`stepGate` default `OK`, `job-flow.ts:195`).
2. **Route(s):** `/customers/[id]`.
3. **Component(s):** `guided-flow.tsx:455` (`complete` branch) — celebratory message, no advance control (`guided-flow.tsx:592` excludes `step==='complete'`).
4. **Clicks to advance:** none — end of spine.
5. **Navigated away:** none.
6. **Data written:** none from this step.

---

### OFF-SPINE STAGE A — `waiting` · "Waiting on the customer" (park)

1. **DB value:** any stage matching `waiting|on hold|hold|park` (`isParkStage`, `job-flow.ts:60`). `resolveFlowStep`→`waiting`. Reachable from any stage.
2. **Route:** `/customers/[id]`.
3. **Component:** `guided-flow.tsx:389` (`waiting` branch) + resume/lost controls at `:557`.
4. **Clicks:** reached via **"Not yet? → Put on hold"** (`guided-flow.tsx:642` → `advanceWorkflow` to the park stage). Leave via **"Resume"** (`:564`, advances to `resumeStage` — install-scheduled stage if a job is booked, else the schedule-install stage; `:169`–`:180`) or **"Mark lost / declined"** (`:571`).
5. **Navigated away:** none (`advanceWorkflow` stays on `/customers/[id]`).
6. **Data written:** `advanceWorkflow` → `customers/handoffs/activities` as above.

---

### OFF-SPINE STAGE B — `lost` · "Lost / Declined" (off-ramp)

1. **DB value:** stage name matching `lost|declin|dead|cancel` (`isLostStage`, `job-flow.ts:58`). `deriveLeadStage`→ `customers.stage = 'lost'` (`workflow-engine.ts:73`), and `advanceWorkflow` also sets `cancelled_at` + `cancel_reason` (`customers/actions.ts:321`).
2. **Route:** `/customers/[id]`.
3. **Component:** `guided-flow.tsx:669` (`currentIsLost` branch) — **Reopen this job** button.
4. **Clicks:** reached via **"Mark lost / declined"** `ConfirmButton` (`guided-flow.tsx:575`/`:652` → `advanceWorkflow` to the lost stage). Leave via **"Reopen this job"** (`:671`, advances to `mainline[0]`).
5. **Navigated away:** none.
6. **Data written:** `advanceWorkflow` sets `customers.cancelled_at/cancel_reason/stage='lost'/next_action_due=null` (`customers/actions.ts:321`) + `handoffs` + `activities`.

---

### PRE-STAGE (optional) — Qualify

Not a spine stage; a gated pop-up/side route. `QualifyDialog` on the file (`page.tsx:594`, auto-opens on `?new=1`). Saving via `qualifyCustomer` (`qualify-actions.ts`) sets `customers.qualified=true, workflow_owner_id(, assigned_to)` (`:58`,`:73`), writes `activities`, then `moveToAutoActionStage(...,"schedule_estimate")` (`:88`) and `redirect('/customers/<id>')` (`:91`). Standalone route `/customers/[id]/qualify` (`qualify/page.tsx`) is reachable from the Contact tab "View" link (`page.tsx:921`).

---

## LIST A — Every route that touches a customer or job record

Traced from `src/app/(app)/**` + `src/app/portal/**` + public routes + API. `[id]` = dynamic segment.

**Customer-record routes**
- `/customers` — list (`customers/page.tsx`)
- `/customers/new` — create (`customers/new/page.tsx` → `createCustomer`)
- `/customers/import` — bulk import (`customers/import/page.tsx`)
- `/customers/[id]` — **the dashboard** (`customers/[id]/page.tsx`)
- `/customers/[id]/qualify` — qualification (`customers/[id]/qualify/page.tsx`)
- `/leads` — lead list (`leads/page.tsx`)
- `/pipeline` — pipeline board keyed on `customers.stage`/`workflow_stage_id` (`pipeline/page.tsx`)
- `/board` — job/lead board (`board/page.tsx`)
- `/dashboard` — pulls customer counts (`dashboard/page.tsx`)
- `/search` — customer/record search (`search/page.tsx`, `search/actions.ts`)
- `/carry-over` — stalled-customer carry-over (`carry-over/page.tsx`)

**Job / work-order routes**
- `/jobs` (`jobs/page.tsx`), `/jobs/[id]` (`jobs/[id]/page.tsx`), `/jobs/[id]/staging-sheet` (`jobs/[id]/staging-sheet/page.tsx`)
- `/jobs/calendar` (`jobs/calendar/page.tsx`), `/jobs/quick` (`jobs/quick/page.tsx`, `jobs/quick/actions.ts`)
- `/install-scheduler` (`install-scheduler/page.tsx`), `/installer` (`installer/page.tsx`)
- `/warehouse` (`warehouse/page.tsx`), `/schedule`, `/schedule/route` (`schedule/page.tsx`, `schedule/route/page.tsx`)
- `/calendar` (`calendar/page.tsx`) — estimate + install appointments

**Records tied to a customer/job**
- `/estimates`, `/estimates/start`, `/estimates/guided`, `/estimates/[id]`, `/estimates/[id]/edit`, `/estimates/[id]/invoice`
- `/invoices`, `/invoices/[id]`
- `/purchase-orders`, `/purchase-orders/[id]`; `/inventory/po/[id]`
- `/orders` (`orders/page.tsx`), `/samples` (`samples/page.tsx`), `/bills`, `/bills/[id]`
- `/financials`, `/financials/expenses`, `/financials/scorecard`, `/pulse` — read customer/job money
- `/reports`, `/reports/win-loss`, `/reports/lead-sources`, `/reports/products`, `/reports/purchasing`

**Customer-facing portal (also mutate customer/job records)**
- `/portal`, `/portal/estimates/[id]` (approve/decline → `setEstimateStatus`), `/portal/invoices/[id]`, `/portal/order`
- Public: `/book` (booking → `appointments`/customer), `/order` (public order)

**API routes touching these records**
- `/api/cron/daily` (`api/cron/daily/route.ts`) — SLA/stall sweeps
- `/api/import/process` (`api/import/process/route.ts`) — customer/product import
- `/api/telnyx-webhook`, `/api/resend-webhook` — inbound SMS/email → `messages`/`activities`
- `/api/google/connect`, `/api/google/callback` — calendar sync for appointments
- `/api/property/streetview` — customer property

---

## LIST B — Every navigation call that leaves the customer dashboard

Grouped by trigger. "Leaves" = a `Link`/`router.push`/server-action `redirect` whose target is **not** `/customers/[id]`. In-page `#anchor` links are excluded (they scroll, per the tabs design).

**From `page.tsx` (header / panels)**
- `Link href="/customers"` — "Back to customers" (`page.tsx:485`).
- `Link href="/customers/<id>/qualify"` — "View" qualification (`page.tsx:921`).
- Jobs panel **New job** `form action={createJob}` → `redirect('/jobs/<id>?created=1')` (`jobs/actions.ts:637`).
- Invoices panel **New invoice** `form action={createInvoice}` → `redirect('/invoices/<id>')` (`invoices/actions.ts:303`).
- `EstimateSourceGate` in Estimates header (`page.tsx:975`) — see build_quote pushes below.
- `DocumentShortcuts` tiles (`document-shortcuts.tsx:97`): `Link` → `/estimates/<id>?print=1` (`:47`), `/jobs/<id>?print=work_order` (`:53`), `/jobs/<id>/staging-sheet` (`:59`), `/invoices/<id>?print=1` (`:65`).
- `CustomerSwitcher` (`customer-switcher.tsx:47`) — `router.push('/customers/<otherId>')` (jumps to a **different** customer).
- Inline record rows "Open full …" `Link`s (`customer-record-rows.tsx`): `/estimates/<id>` (`:95`), `/jobs/<id>` (`:153`), `/invoices/<id>` (`:196`). (Rows expand in place first; the link is the only away-nav.)

**From `guided-flow.tsx` (the spine hero)**
- build_quote: `router.push('/estimates/guided?customer=<id>')` (`estimate-source-gate.tsx:42`); `createEstimate`→`redirect('/estimates/<id>/edit')` (`estimates/actions.ts:80`); "Continue current draft" `Link`→`/estimates/<id>/edit` (`guided-flow.tsx:266`).
- approve: "Open estimate" `Link`→`/estimates/<id>` (`guided-flow.tsx:290`); "Mark approved" → `setEstimateStatus`→`redirect('/estimates/<id>')` (`estimates/actions.ts:358`).
- collect_deposit: "Create deposit invoice" `Link`→`/estimates/<id>/invoice` (`guided-flow.tsx:333`); "Open invoice & record payment" `Link`→`/invoices/<id>` (`guided-flow.tsx:326`).
- materials: "Create job" → `createJobFromEstimate`→`redirect('/jobs/<id>?created=1')` (`jobs/actions.ts:571`); "Create purchase order" → `createPOFromEstimate`→`redirect('/purchase-orders/<id>')` (`purchase-orders/actions.ts:275`/`:349`/`:421`); "Purchase orders" `Link`→`/purchase-orders` (`guided-flow.tsx:371`).
- await_install: "Open work order" `Link`→`/jobs/<id>` (`guided-flow.tsx:417`).
- followup: "Record payment" `Link`→`/invoices/<id>` (`guided-flow.tsx:446`).

**Server actions that redirect OFF the dashboard**
- `createEstimate` → `/estimates/<id>/edit` (`estimates/actions.ts:80`); also bounces to `/customers/<id>` if source unset (`:57`).
- `createEstimateFromWizard` finalize / `smart-actions` → `/estimates/<id>/edit` (`estimates/actions.ts:80`, `smart-actions.ts:247`).
- `setEstimateStatus` → `/estimates/<id>` (`estimates/actions.ts:358`).
- `createJob` / `createJobFromEstimate` → `/jobs/<id>?created=1` (`jobs/actions.ts:637`,`:571`).
- `createInvoice` / `createInvoiceFromEstimate` → `/invoices/<id>` (`invoices/actions.ts:303`,`:203`).
- `createPOFromEstimate` / `createBlankPO` → `/purchase-orders/<id>` or `/purchase-orders` (`purchase-orders/actions.ts:275`/`:733`).
- `deleteCustomer` → `/customers` (`customers/actions.ts:741`).

**Actions that stay on / return to the dashboard (for contrast — NOT away-nav)**
- `advanceWorkflow`, `overrideAdvanceWorkflow`, `cancelCustomer`, `reopenCustomer` → `redirect(redirectTo ?? '/customers/<id>')` (`customers/actions.ts:374`,`:451`,`:620`,`:665`).
- `bookEstimateAppointment` → `/customers/<id>` (`schedule-actions.ts:224`); `bookInstall` → stays unless `redirect_to` posted (`jobs/actions.ts:225`); `recordPayment`, `reassignCustomer`, `addActivity` → revalidate only.

---

## LIST C — Stages that require visiting MORE THAN ONE route to complete

A stage qualifies if the user must leave `/customers/[id]` and act on another route before the advance gate opens.

| Stage | Extra route(s) required | Why the dashboard alone can't complete it | Evidence |
|---|---|---|---|
| **STAGE 4 `build_quote`** | `/estimates/guided` **or** `/estimates/[id]/edit`, then send | The estimate is built/sent on the builder or questionnaire; gate needs `estimateSent`. There is no inline "send" on the file. | gate `job-flow.ts:174`; nav `estimate-source-gate.tsx:42`, `estimates/actions.ts:80` |
| **STAGE 5 `approve`** *(partial)* | `/estimates/[id]` optional; inline "Mark approved" exists but its action redirects to `/estimates/<id>` | Can be done inline, but the confirming action ends on the estimate page, not the file. | `guided-flow.tsx:296`; redirect `estimates/actions.ts:358` |
| **STAGE 6 `collect_deposit`** | `/estimates/[id]/invoice` (create) **and** `/invoices/[id]` (record payment) | Deposit invoice is created and payment recorded on the invoice route; gate needs `depositPaid`. | gate `job-flow.ts:180`; nav `guided-flow.tsx:326`,`:333`; `recordPayment` `invoices/actions.ts:365` |
| **STAGE 7 `materials`** | `/jobs/[id]` (create job) and/or `/purchase-orders[/id]` (create/receive PO) | Work order + POs are created/received off-file; gate needs `workOrderExists`; PO-receive/warehouse auto-advance happen on those routes. | gate `job-flow.ts:183`; nav `guided-flow.tsx:355`,`:363`,`:371`; PO receive `purchase-orders/actions.ts:648` |
| **STAGE 9 `await_install`** | `/jobs/[id]` (mark completed) | Install is marked complete only on the work order; gate needs `installComplete`. | gate `job-flow.ts:189`; nav `guided-flow.tsx:417`; `setJobStatus` `jobs/actions.ts:766` |
| **STAGE 10 `followup`** | `/invoices/[id]` (record final payment) | Remaining balance is collected on the invoice route; gate needs `balancePaid`. | gate `job-flow.ts:192`; nav `guided-flow.tsx:446`; `recordPayment` `invoices/actions.ts:365` |

**Stages completable entirely on `/customers/[id]` (single route):** `contact` (STAGE 1), `schedule_estimate` (STAGE 2), `estimate_booked` (STAGE 3), `schedule_install` (STAGE 8 — `InstallSchedule` is inline and `bookInstall` doesn't redirect), `complete` (STAGE 11), and the off-spine `waiting` / `lost` transitions.

---

## Notes / caveats surfaced during the audit

- **Two write paths to the same stage move.** Manual `advanceWorkflow` (`customers/actions.ts:267`) and the auto-advance engine (`workflow-engine.ts` `applyMove`, `advanceFromAutoAction`, `moveToAutoActionStage`, `advanceToNamedStage`) both update `customers.workflow_stage_id/stage/next_action_due` and log to `handoffs`+`activities`. They are forward-only-coordinated but are distinct code paths.
- **`auto_action` is not seeded.** `resolveFlowStep`/`deriveLeadStage`/engine anchoring rely on `auto_action` markers that the seed (`0013`) leaves as `'none'` (`0029:5`); they are set via Settings → Stages. Without them, resolution degrades to name/position matching (`job-flow.ts:112`+).
- **Back-half stages are matched by name regex**, not `auto_action`: `STAGE_INSTALL_SCHEDULED = /^(?!.*\bneeds\b).*install.*sched/` (`jobs/actions.ts:24`), `STAGE_INSTALLED = /installed|follow/` (`:25`), `STAGE_MATERIALS_RECEIVED = /material.*received/` (`purchase-orders/actions.ts:14`). Renaming those stages past the regex silently disables their auto-advance (best-effort, no-op by design).
- **The job-status "next step" popup was intentionally removed from the dashboard** to avoid a second, conflicting progression — `GuidedFlow` is the single spine there (`page.tsx:481` comment). It still appears on `/jobs/[id]` and `/installer`.
