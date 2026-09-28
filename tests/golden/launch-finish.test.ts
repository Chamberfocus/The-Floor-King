import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { homeCommandsForRole } from "@/lib/home-command";
import { taskOperationalHref } from "@/lib/office-task";
import { searchTypesForRole } from "@/lib/search-query";

const read = (path: string) => readFileSync(resolve(__dirname, "../..", path), "utf8");

describe("launch finish links", () => {
  it("opens a service task on the callback", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(
      taskOperationalHref({
        source_key: `service_callback:${id}`,
        customer_id: "cust",
        job_id: "job",
      }),
    ).toBe(`/service/${id}`);
    expect(
      taskOperationalHref({
        source_key: `installer_issue:${id}`,
        customer_id: "cust",
      }),
    ).toBe(`/service/${id}`);
    expect(taskOperationalHref({ customer_id: "cust", job_id: "job" })).toBe("/customers/cust");
    expect(taskOperationalHref({ job_id: "job" })).toBe("/jobs/job");
  });

  it("counts scheduled service visits separately from open issues", () => {
    expect(homeCommandsForRole("office").find((row) => row.id === "visits")?.href).toBe(
      "/service?view=scheduled",
    );
    expect(homeCommandsForRole("crew").some((row) => row.id === "visits")).toBe(false);
    expect(homeCommandsForRole("warehouse").some((row) => row.id === "visits")).toBe(false);
    const loader = read("src/lib/data/home-center.ts");
    expect(loader).toContain('p_statuses: ["scheduled"]');
  });

  it("lets service roles search callbacks and keeps money off the warehouse", () => {
    expect(searchTypesForRole("office")).toContain("service");
    expect(searchTypesForRole("warehouse")).not.toContain("service");
    expect(searchTypesForRole("crew")).not.toContain("service");
    const search = read("src/app/(app)/search/actions.ts");
    expect(search).toContain("service_callbacks");
    expect(search).toContain("description.ilike");
    expect(search).not.toContain("resolution_notes");
  });

  it("links a purchase order back to its job", () => {
    const page = read("src/app/(app)/purchase-orders/[id]/page.tsx");
    expect(page).toContain("/jobs/${po.job_id}");
    expect(page).toContain("/customers/${customer.id}");
  });
});
