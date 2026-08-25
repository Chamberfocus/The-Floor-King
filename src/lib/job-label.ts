/**
 * What a job is CALLED, and where it actually is.
 *
 * This shop runs on addresses. A crew is sent to a door, material is staged for
 * a door, and a property manager's building is one account with a job per unit.
 * The app named work after the customer instead: 34 of 36 live jobs are titled
 * "Flooring for {name}", which tells you nothing about where the work is and
 * nothing at all when one account has twelve units.
 *
 * The addresses were already there — 32 of those 36 jobs carry a site street.
 * Nothing led with them.
 *
 * So: the site is the headline, the customer is the subtitle. One function, so
 * the jobs list, the board, the scheduler, the warehouse and the work order all
 * call the same job the same thing.
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
 * The heading for a job: where it is, falling back to what it's called.
 *
 * Never invents "Flooring for {customer}" — that's the pattern being replaced.
 * A job with no address at all keeps its own title, because something is better
 * than an empty heading, and a pickup order genuinely has no site.
 */
export function jobHeading(job: JobSiteLike): string {
  return jobSiteLine(job) ?? clean(job.title) ?? "Job";
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
