# Floor King CRM — Ideas & Backlog

Running list of every feature idea, tagged by phase. Legend:
✅ done · 🔨 building now · 📋 backlog (build at its phase) · ❓ needs detail

> Capture everything here so nothing is lost. We build each item at the right phase
> to keep the system stable.

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
- 📋 Generate a PO from an approved estimate (roll up material quantities by product)

## Phase 3 — Jobs / Work Orders / Scheduling
- 📋 Work order for installers generated from the approved estimate/PO (scope by room)
- 📋 Schedule jobs, assign crew, calendar, mobile job screen, photos, on-site signature

## Phase 4 — Invoicing & Payments
- 📋 Clear, informational invoices
- 📋 Customer payment options:
  - payment link we provide (online card)
  - mailed check
  - emailed/photographed check → electronic debit (ACH / eCheck)
  - credit card
  - cash
  - financing + other financing options we offer

## Phase 5 — Customer Portal & Automation
- 📋 Customer logs in to view, approve, decline (with reason), or request changes
- 📋 Notifications (email/text) for quote sent, approved, scheduled, invoice due

---

_Add new ideas anywhere; I'll re-sort by phase._
