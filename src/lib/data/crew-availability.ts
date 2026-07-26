import { createClient } from "@/lib/supabase/server";

/**
 * Installer-owned availability blocks. Crew post when they're off / busy so the
 * office knows when they can be scheduled. Privacy is enforced in the database
 * (see 0127_installer_availability.sql): the raw table is owner-read only, and
 * the office reads through installer_availability_office(), which redacts the
 * note on private rows down to "Unavailable".
 */

export type AvailabilityKind = "off" | "busy";

/** A block as its OWNER (the crew member) sees it — full detail. */
export interface MyAvailabilityBlock {
  id: string;
  start_date: string;
  end_date: string;
  all_day: boolean;
  start_time: string | null;
  end_time: string | null;
  kind: AvailabilityKind;
  note: string | null;
  private: boolean;
}

/** A block as the OFFICE sees it — note already redacted for private rows. */
export interface OfficeAvailabilityBlock {
  id: string;
  installer_id: string;
  installer_name: string | null;
  start_date: string;
  end_date: string;
  all_day: boolean;
  start_time: string | null;
  end_time: string | null;
  kind: AvailabilityKind;
  is_private: boolean;
  /** Safe label to show the office ("Unavailable" when private). */
  label: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** My own upcoming (and recently past) availability blocks — full detail. */
export async function listMyAvailability(
  installerId: string,
): Promise<MyAvailabilityBlock[]> {
  const supabase = await createClient();
  const cutoff = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return d.toISOString().slice(0, 10);
  })();
  const { data } = await supabase
    .from("installer_availability")
    .select(
      "id, start_date, end_date, all_day, start_time, end_time, kind, note, private",
    )
    .eq("installer_id", installerId)
    .gte("end_date", cutoff)
    .order("start_date", { ascending: true });
  return ((data ?? []) as MyAvailabilityBlock[]);
}

/**
 * Crew availability for the office — privacy-redacted at the DB layer. Defaults
 * to the next 60 days from today.
 */
export async function listCrewAvailabilityForOffice(opts?: {
  from?: string;
  to?: string;
}): Promise<OfficeAvailabilityBlock[]> {
  const from = opts?.from ?? today();
  const to =
    opts?.to ??
    (() => {
      const d = new Date();
      d.setDate(d.getDate() + 60);
      return d.toISOString().slice(0, 10);
    })();
  const supabase = await createClient();
  const { data } = await supabase.rpc("installer_availability_office", {
    p_from: from,
    p_to: to,
  });
  return ((data ?? []) as OfficeAvailabilityBlock[]);
}
