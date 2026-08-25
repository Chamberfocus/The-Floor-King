/**
 * Which job this is — the CUSTOMER, and then which of their addresses.
 *
 * You look work up by customer. What the app couldn't express is that one
 * customer has several addresses: a property manager's building is one account
 * with a job per unit, and every one of those jobs was called "Flooring for
 * Abington Arms C/O The Finch Group". Identical names, twelve different doors,
 * no way to tell them apart.
 *
 * So the name leads and the SITE is what distinguishes one job from another on
 * the same account. One function for it, so the jobs list, the board, the
 * warehouse and the work order all identify the same job the same way.
 *
 * (An earlier pass put the address first and demoted the customer. That was the
 * wrong read: the address is the discriminator, not the identity.)
 */

export interface JobSiteLike {
  title?: string | null;
  site_street?: string | null;
  site_city?: string | null;
  site_state?: string | null;
  site_zip?: string | null;
  /** A named job site on the account — "Unit 813" beats a street every time. */
  site_label?: string | null;
}

const clean = (s: string | null | undefined): string => (s ?? "").trim();

/**
 * The site, as you'd say it out loud. A named unit wins over the street: on a
 * building where every job shares one street, "Unit 814" is the only part that
 * identifies the work.
 */
export function jobSiteLine(job: JobSiteLike): string | null {
  const label = clean(job.site_label);
  const street = clean(job.site_street);
  const city = clean(job.site_city);

  if (label && street) return `${label} · ${street}`;
  if (label) return label;
  if (street) return city ? `${street}, ${city}` : street;
  return null;
}

/** Just the street line, for places too narrow for the city. */
export function jobSiteShort(job: JobSiteLike): string | null {
  return clean(job.site_label) || clean(job.site_street) || null;
}

/**
 * The headline: the customer. Falls back to the job's own title only when there
 * is no customer name to show.
 */
export function jobHeading(job: JobSiteLike, customerName?: string | null): string {
  return clean(customerName) || clean(job.title) || "Job";
}

/**
 * The line UNDER the headline — which of this customer's addresses, and what the
 * work is when the title says something the address doesn't.
 *
 * This is the part that tells two jobs on one account apart, so it's built to be
 * shown always, not tucked into small print.
 */
export function jobIdentityLine(
  job: JobSiteLike,
  customerName?: string | null,
): string | null {
  const site = jobSiteLine(job);
  const what = jobSubtitle(job, customerName);
  return [site, what].filter(Boolean).join(" · ") || null;
}

/**
 * The subtitle under that heading: what the work is, when the title says
 * something the address doesn't. "Flooring for Joyce Gatti" adds nothing beside
 * her address, so it's dropped; "Home Addition" or "Master bedroom carpet" is
 * the useful half of a two-job account and is kept.
 */
export function jobSubtitle(job: JobSiteLike, customerName?: string | null): string | null {
  const title = clean(job.title);
  const name = clean(customerName);
  if (!title) return null;
  // Titles that are just the customer's name in a sentence carry no information
  // once the address is the heading.
  const generic =
    /^(flooring|carpet|job|work|install(?:ation)?)\s*(for\b|—|-|$)/i.test(title) ||
    (!!name && title.toLowerCase().includes(name.toLowerCase()));
  return generic ? null : title;
}

/**
 * The default name for a NEW job — the address, not the customer.
 *
 * A job called "Flooring for Abington Arms C/O The Finch Group" is
 * indistinguishable from the eleven others on that account. "Unit 814" isn't.
 */
export function defaultJobTitle(
  site: JobSiteLike,
  fallback: string | null | undefined,
): string {
  return jobSiteLine(site) ?? clean(fallback) ?? "Job";
}
