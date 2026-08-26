/**
 * Turn the archive dump into one searchable page of work orders.
 *
 * Design read: this is a REFERENCE document, not a showpiece. It gets opened in
 * two years to answer "what did we lay at that house, how much, and what did we
 * charge". So it's built like a trade document — Georgia headings against a
 * system sans, quantities in tabular mono, hairline rules, no hero — and the
 * only interactive thing is a filter that actually earns its place across 38
 * jobs. Prints cleanly, because a work order sometimes needs to be on paper.
 */
import { readFileSync, writeFileSync } from "node:fs";

const STAMP = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const DIR = `${process.env.HOME}/Documents/floorking-archive-${STAMP}`;
const d = JSON.parse(readFileSync(`${DIR}/data.json`, "utf8"));

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const money = (n) =>
  Number(n)
    ? `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "—";
const day = (x) => (x ? String(x).slice(0, 10) : "—");
const by = (rows, key) => {
  const m = new Map();
  for (const r of rows ?? []) {
    const a = m.get(r[key]) ?? [];
    a.push(r);
    m.set(r[key], a);
  }
  return m;
};

const cust = new Map((d.customers ?? []).map((c) => [c.id, c]));
const est = new Map((d.estimates ?? []).map((e) => [e.id, e]));
const linesByJob = by(d.job_line_items, "job_id");
const linesByOpt = by(d.estimate_line_items, "option_id");
const invByJob = by(d.invoices, "job_id");
const itemsByInv = by(d.invoice_items, "invoice_id");
const payByInv = by(d.payments, "invoice_id");
const poByJob = by(d.purchase_orders, "job_id");

const jobs = (d.jobs ?? [])
  .slice()
  .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

let billedAll = 0;
let paidAll = 0;

const cards = jobs
  .map((j) => {
    const c = cust.get(j.customer_id) ?? {};
    const site =
      [j.site_street, j.site_city, j.site_state, j.site_zip].filter(Boolean).join(", ") || "";
    const lines = (
      linesByJob.get(j.id) ??
      (j.option_id ? linesByOpt.get(j.option_id) : []) ??
      []
    )
      .slice()
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

    const invs = invByJob.get(j.id) ?? [];
    let billed = 0;
    let paid = 0;
    for (const inv of invs) {
      billed += (itemsByInv.get(inv.id) ?? []).reduce(
        (s, it) => s + (Number(it.quantity) || 0) * (Number(it.rate) || 0),
        0,
      );
      paid += (payByInv.get(inv.id) ?? []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    }
    billedAll += billed;
    paidAll += paid;

    const pos = poByJob.get(j.id) ?? [];
    const status = String(j.status ?? "").replace(/_/g, " ");
    const tone =
      j.status === "completed" ? "done" : j.status === "cancelled" ? "void" : "live";

    const rows = lines.length
      ? lines
          .map(
            (l) => `<tr>
            <td>${esc(l.room ?? "")}</td>
            <td class="what">${esc(l.description ?? "")}${l.note ? `<span class="note">${esc(l.note)}</span>` : ""}</td>
            <td class="n">${esc(l.sqft ?? l.quantity ?? "")}</td>
            <td class="u">${esc(l.unit ?? "")}</td>
            <td class="n">${money(l.material_rate)}</td>
            <td class="n">${money(l.labor_rate)}</td>
          </tr>`,
          )
          .join("")
      : `<tr><td colspan="6" class="empty">No scope recorded on this job.</td></tr>`;

    // Everything the filter should match, in one attribute.
    const hay = [c.full_name, site, j.title, c.phone, c.email, status]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return `<article class="job" data-find="${esc(hay)}">
      <header class="job-head">
        <div class="who">
          <h2>${esc(c.full_name ?? "Unknown customer")}</h2>
          ${site ? `<p class="site">${esc(site)}</p>` : ""}
          ${j.title ? `<p class="what-job">${esc(j.title)}</p>` : ""}
        </div>
        <div class="meta">
          <span class="pill ${tone}">${esc(status || "—")}</span>
          <dl>
            <dt>Scheduled</dt><dd>${day(j.scheduled_date)}</dd>
            <dt>Created</dt><dd>${day(j.created_at)}</dd>
            ${c.phone ? `<dt>Phone</dt><dd>${esc(c.phone)}</dd>` : ""}
            ${c.email ? `<dt>Email</dt><dd class="wrap">${esc(c.email)}</dd>` : ""}
          </dl>
        </div>
      </header>
      ${
        j.notes
          ? `<div class="notes">${esc(j.notes).replace(/\n/g, "<br>")}</div>`
          : ""
      }
      <div class="scroll">
        <table>
          <thead><tr><th>Room</th><th>What</th><th class="n">Qty</th><th>Unit</th><th class="n">Material</th><th class="n">Labor</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <footer class="job-foot">
        ${
          invs.length
            ? `<span><b>Invoiced</b> ${money(billed)}</span><span><b>Paid</b> ${money(paid)}</span>`
            : `<span class="muted">No invoice raised</span>`
        }
        ${
          pos.length
            ? `<span><b>POs</b> ${pos.map((p) => esc(`#${p.po_number ?? "?"} ${p.supplier ?? ""}`.trim())).join(", ")}</span>`
            : ""
        }
        ${
          j.estimate_id && est.get(j.estimate_id)
            ? `<span class="muted">Estimate: ${esc(est.get(j.estimate_id).status)}</span>`
            : ""
        }
      </footer>
    </article>`;
  })
  .join("\n");

const html = `<title>Floor King Job Archive</title>
<style>
  /* ── Tokens. Light is the default; the two dark paths below cover an explicit
     choice and an un-stamped OS preference. Every colour is defined here and
     only redefined — never introduced — in a theme block. ─────────────────── */
  :root {
    --paper:   #FBFAF8;   /* barely-warm paper, not cream */
    --card:    #FFFFFF;
    --ink:     #1B1D21;
    --muted:   #6C6A66;   /* neutral biased toward the walnut accent */
    --rule:    #E4E1DB;
    --accent:  #7A5C3E;   /* walnut — the trade, without the terracotta cliché */
    --done:    #2F6B4F;
    --live:    #8A6D1F;
    --void:    #8C4A44;
    --tint:    #F3F0EA;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --paper:  #131417;
      --card:   #191B1F;
      --ink:    #ECEAE6;
      --muted:  #9A9791;
      --rule:   #2A2D33;
      --accent: #C79C6E;
      --done:   #6FBF95;
      --live:   #D6B36A;
      --void:   #E08A82;
      --tint:   #21242A;
    }
  }
  :root[data-theme="dark"] {
    --paper:  #131417;
    --card:   #191B1F;
    --ink:    #ECEAE6;
    --muted:  #9A9791;
    --rule:   #2A2D33;
    --accent: #C79C6E;
    --done:   #6FBF95;
    --live:   #D6B36A;
    --void:   #E08A82;
    --tint:   #21242A;
  }

  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font: 400 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 60rem; margin: 0 auto; padding: 2.5rem 1.25rem 5rem; }

  /* Masthead — a compact record header, not a hero. */
  .mast { border-bottom: 2px solid var(--ink); padding-bottom: 1rem; margin-bottom: 1.25rem; }
  .mast h1 {
    font: 600 1.9rem/1.15 ui-serif, Georgia, "Times New Roman", serif;
    letter-spacing: -0.01em; margin: 0 0 .35rem; text-wrap: balance;
  }
  .mast p { margin: 0; color: var(--muted); font-size: .9rem; }
  .stats { display: flex; flex-wrap: wrap; gap: 1.5rem; margin-top: .9rem; }
  .stats div { display: flex; flex-direction: column; }
  .stats b {
    font: 600 1.25rem/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
  }
  .stats span { font-size: .72rem; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }

  .tools { position: sticky; top: 0; z-index: 5; background: var(--paper); padding: .75rem 0 1rem; }
  input[type="search"] {
    width: 100%; padding: .7rem .9rem; font-size: 1rem; color: var(--ink);
    background: var(--card); border: 1px solid var(--rule); border-radius: .4rem;
  }
  input[type="search"]:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .count { margin-top: .5rem; font-size: .8rem; color: var(--muted); }

  .job {
    background: var(--card); border: 1px solid var(--rule); border-radius: .4rem;
    margin-bottom: 1rem; overflow: hidden;
  }
  .job-head { display: flex; flex-wrap: wrap; gap: 1rem; justify-content: space-between; padding: 1rem 1.1rem .8rem; }
  .who h2 {
    margin: 0; font: 600 1.15rem/1.25 ui-serif, Georgia, serif; letter-spacing: -0.005em;
  }
  .site { margin: .2rem 0 0; font-weight: 500; color: var(--accent); }
  .what-job { margin: .1rem 0 0; font-size: .87rem; color: var(--muted); }
  .meta { text-align: right; }
  .meta dl { display: grid; grid-template-columns: auto auto; gap: .05rem .6rem; margin: .5rem 0 0; font-size: .78rem; }
  .meta dt { color: var(--muted); }
  .meta dd { margin: 0; font-variant-numeric: tabular-nums; }
  .meta dd.wrap { word-break: break-all; }

  .pill {
    display: inline-block; padding: .12rem .5rem; border-radius: 1rem;
    font-size: .7rem; font-weight: 600; text-transform: uppercase; letter-spacing: .06em;
    border: 1px solid currentColor;
  }
  .pill.done { color: var(--done); }
  .pill.live { color: var(--live); }
  .pill.void { color: var(--void); }

  .notes {
    margin: 0 1.1rem .8rem; padding: .6rem .75rem; background: var(--tint);
    border-radius: .3rem; font-size: .84rem; color: var(--muted);
  }

  .scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: .86rem; }
  th {
    text-align: left; font-size: .68rem; text-transform: uppercase; letter-spacing: .07em;
    color: var(--muted); font-weight: 600; padding: .5rem .6rem;
    border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule);
    white-space: nowrap;
  }
  td { padding: .45rem .6rem; border-bottom: 1px solid var(--rule); vertical-align: top; }
  tr:last-child td { border-bottom: 0; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; }
  td.u { color: var(--muted); white-space: nowrap; }
  td.what { min-width: 14rem; }
  .note { display: block; font-size: .78rem; color: var(--live); margin-top: .1rem; }
  .empty { color: var(--muted); font-style: italic; }

  .job-foot {
    display: flex; flex-wrap: wrap; gap: 1.25rem; padding: .7rem 1.1rem;
    border-top: 1px solid var(--rule); font-size: .82rem;
  }
  .job-foot b { font-weight: 600; color: var(--muted); font-size: .7rem;
    text-transform: uppercase; letter-spacing: .06em; margin-right: .25rem; }
  .muted { color: var(--muted); }

  .none { display: none; }
  .nohits { padding: 2rem; text-align: center; color: var(--muted); }

  @media print {
    .tools { display: none; }
    .job { break-inside: avoid; border-color: #ccc; }
    body { background: #fff; color: #000; }
  }
  @media (max-width: 46rem) {
    .meta { text-align: left; }
    .job-head { flex-direction: column; gap: .5rem; }
  }
</style>

<div class="wrap">
  <header class="mast">
    <h1>Floor King Job Archive</h1>
    <p>Every job on record at the reset of ${esc(STAMP)}. Quantities and prices exactly as they stood.</p>
    <div class="stats">
      <div><b>${jobs.length}</b><span>Jobs</span></div>
      <div><b>${(d.customers ?? []).length}</b><span>Customers</span></div>
      <div><b>${money(billedAll)}</b><span>Invoiced</span></div>
      <div><b>${money(paidAll)}</b><span>Paid</span></div>
    </div>
  </header>

  <div class="tools">
    <input type="search" id="q" placeholder="Search a customer, address, phone or job…" autocomplete="off">
    <p class="count" id="count">${jobs.length} jobs</p>
  </div>

  <main id="list">
${cards}
  </main>
  <p class="nohits none" id="nohits">Nothing matches that.</p>
</div>

<script>
  const q = document.getElementById("q");
  const jobs = [...document.querySelectorAll(".job")];
  const count = document.getElementById("count");
  const nohits = document.getElementById("nohits");
  q.addEventListener("input", () => {
    const t = q.value.trim().toLowerCase();
    let n = 0;
    for (const j of jobs) {
      const hit = !t || j.dataset.find.includes(t);
      j.classList.toggle("none", !hit);
      if (hit) n++;
    }
    count.textContent = n === jobs.length ? n + " jobs" : n + " of " + jobs.length + " jobs";
    nohits.classList.toggle("none", n > 0);
  });
</script>`;

writeFileSync(`${DIR}/work-orders.html`, html);
console.log(`WROTE ${DIR}/work-orders.html`);
console.log(`  ${jobs.length} jobs · invoiced ${money(billedAll)} · paid ${money(paidAll)}`);
