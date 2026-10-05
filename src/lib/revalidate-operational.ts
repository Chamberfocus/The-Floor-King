import { revalidatePath } from "next/cache";
import { OPERATIONAL_SURFACE_PATHS } from "@/lib/customer-lifecycle";

/** One list for archive, restore, and cancel so a dependent screen is not left stale. */
export function revalidateOperationalSurfaces(extra: string[] = []): void {
  const seen = new Set<string>();
  for (const path of [...OPERATIONAL_SURFACE_PATHS, ...extra]) {
    if (seen.has(path)) continue;
    seen.add(path);
    revalidatePath(path);
  }
}
