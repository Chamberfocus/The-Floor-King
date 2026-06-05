# Floor King CRM — Ideas & Backlog

Running list of every feature idea, tagged by phase. Legend:
✅ done · 🔨 building now · 📋 backlog (build at its phase) · ❓ needs detail

> Capture everything here so nothing is lost. We build each item at the right phase
> to keep the system stable.

---

## ⭐ Master Sales Workflow (owner's spec, 2026-06-05)

Stages are set up (Workflow Stages). Legend: ✅ done · 🔨 build next (no external deps) ·
⏳ needs external setup · 📋 backlog.

1. **New Lead** — customer calls → owner/office **assigns** to a salesperson. ✅ (handoff/assign + email)
2. **Qualifying** — assigned person contacts client, runs **qualifying questions** to confirm
   they're a fit, **with a Skip option**. 🔨 (configurable qualifying questionnaire, like the
   wizard questions). Outcome → schedule estimate OR invite to showroom.
3. **Estimate Scheduled** — book the in-home estimate (carpet measured in home; hard surface
   taken back to the store to break down).
   - **"On our way" button** on customer page → customer notified with **live ETA from our
     store location to their address** (drive time). ⏳ needs store address + Google Maps API key.
4. **Awaiting Price (Measuring)** — customer awaiting price.
   - **"Estimate completed" button → auto-opens the Estimate Wizard.** 🔨
5. **Estimate Sent → Awaiting Customer Response** — moves to this stage on send. ✅ (status)
   - Notify when client **received/opened** it. ⏳ (Resend open-tracking webhook)
   - **Auto thank-you email ~2 hours after sending.** ⏳ (scheduler/cron)
   - Declined → **require a reason**. ✅ (portal + staff)
   - Approved → notify **owner + salesperson**. 🔨 (add salesperson to existing owner notify)
6. **Won — Collect Deposit** — contact client for deposit method.
   - **Invoice auto-populated by picking which estimate items to bring over.** 🔨 (selective item picker)
   - Wait for deposit (record payment). ✅
7. **Ordering Materials** — after deposit → order materials. **Multiple vendors / multiple POs.** ✅ (POs)
   - Notify client **"material ordered."** 🔨
   - Record **order confirmation**; if **backorder** → notify everyone + warehouse + **ETA**. 🔨
8. **Materials Received** — warehouse **receives + verifies** right items + complete; if anything
   **missing → notify all project employees**. 🔨 (warehouse receiving check + alerts)
9. **Install Scheduled** — schedule install (or post to **installer bulletin board** ✅), notify all.
   - **Day-before reminder to everyone.** ⏳ (scheduler/cron)
10. **Installed** — installer gets **customer signature on satisfaction form** ✅ → mark complete.
11. **Installed — Follow-up** — follow-up call to check condition + collect **final payment**.
12. **Closed.**

**External pieces needed:** store address + Google Maps (Distance Matrix) API key for ETA;
a scheduler (cron) for delayed/scheduled emails (2-hr thank-you, day-before reminders);
Resend webhook for email open/receipt tracking.

---

## Phase 2 — Estimates (current)

- ✅ Line-by-line line-item estimate builder
- ✅ Present to the customer **either** detailed line-by-line **or** a "ball of wax"
  single lump-sum total (per-estimate toggle)
- ✅ Add / edit / delete estimates
- ✅ Multiple options per estimate + one-click **duplicate option**
- ✅ Flexible line types: material+labor / installed per sqft / flat amount
- ✅ Materials catalog with rate autofill
- ✅ Tax applied to the full amount (editable rate)
- ✅ Job description / "detailed explanation of the job" field on the estimate
- ✅ Internal approve / decline / request-changes workflow (staff records the outcome;
  decline reason + change request captured)
- ✅ **Estimate Wizard** — guided questionnaire that builds the estimate so the
  salesperson can't forget job details; details flow into the estimate
  - ✅ **One line item per room** (room + sqft + product → a line)
  - ✅ **Editable questions** — owner can add / edit / remove / reorder the wizard's
    questions (Wizard Setup screen); wizard pulls live from that list
  - ✅ Detail questions → compiled into the job description
  - ✅ Add-on questions → each becomes its own line item with a default price
  - 📋 later: per-product-type question branching (carpet/LVP/hardwood/laminate)
- 📋 Customer-facing **approve / decline / request changes** (self-service in the
  portal, Phase 5 — data model already supports it)

## Phase 2.5 — Purchase Orders
- ✅ Generate a PO from an approved estimate (material lines → items with cost)
- ✅ Editable PO (supplier, status, items, total), printable

## Phase 3 — Jobs / Work Orders / Scheduling
- ✅ Work order for installers from the approved estimate (scope by room)
- ✅ Schedule jobs (dates), assign crew, mobile job screen, crew status updates
- ✅ Calendar view of jobs (month grid)
- ✅ On-site photos + customer signature on the work order

## Phase 4 — Invoicing & Payments
- ✅ Clear, informational invoices (items, tax, terms, printable) + balance tracking
- ✅ Record payments by method: credit card, cash, check, eCheck/ACH, financing, other
- 📋 Online **payment link** (Stripe) — needs Stripe account
- 📋 Real **financing** provider integration (Wisetack/Synchrony/etc.)
- 📋 emailed/photographed check → electronic debit automation

## Phase 5 — Customer Portal & Automation
- ✅ Customer logs in to view, approve, decline (with reason), or request changes
- ✅ Customer portal: see estimates, project schedule (jobs), invoices
- ✅ Staff "invite to portal" creates a linked customer login
- 📋 Notifications (email/text) for quote sent, approved, scheduled, invoice due
- 📋 Online invoice payment in the portal (with Stripe)

---

_Add new ideas anywhere; I'll re-sort by phase._
