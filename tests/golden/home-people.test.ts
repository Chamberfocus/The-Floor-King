import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  homePersonKinds,
  homePersonName,
  homePersonWhy,
  pickHomePeople,
  type HomePerson,
} from "@/lib/home-people";

function person(id: string, href = `/customers/${id}`): HomePerson {
  return { id, name: id, why: "why", href };
}

describe("home people", () => {
  it("keeps named rows on the queues that role already sees", () => {
    expect(homePersonKinds("salesman")).toEqual(["lead", "followup", "estimate", "today"]);
    expect(homePersonKinds("salesman")).not.toContain("decline");
    expect(homePersonKinds("office")).toEqual([
      "lead",
      "decline",
      "followup",
      "estimate",
      "today",
    ]);
    expect(homePersonKinds("scheduler")).toEqual(["followup", "today"]);
    expect(homePersonKinds("crew")).toEqual(["today"]);
    expect(homePersonKinds("warehouse")).toEqual([]);
    expect(homePersonWhy("lead", "salesman")).toBe("Accept this lead");
    expect(homePersonWhy("lead", "office")).toBe("Waiting to be accepted");
    expect(homePersonWhy("followup", "office", "  Call about the measure  ")).toBe(
      "Call about the measure",
    );
    expect(homePersonWhy("followup", "office", "  ")).toBe("Follow-up is due");
    expect(homePersonWhy("decline", "office")).toBe("A salesperson declined this lead");
    expect(homePersonWhy("estimate", "salesman")).toBe("Estimate is out — follow up");
    expect(homePersonWhy("today", "crew")).toBe("Install today");
    expect(homePersonName("  Ada  ", "Unnamed customer")).toBe("Ada");
    expect(homePersonName("   ", "Unnamed customer")).toBe("Unnamed customer");
  });

  it("shows two from each queue before filling the rest, and skips a repeated link", () => {
    const leads = ["a", "b", "c"].map((id) => person(id));
    const followups = ["d", "a", "e"].map((id) => person(id));
    const estimates = ["f", "g", "h"].map((id) => person(id, `/estimates/${id}`));
    const picked = pickHomePeople([leads, followups, estimates]);
    expect(picked.map((row) => row.href)).toEqual([
      "/customers/a",
      "/customers/b",
      "/customers/d",
      "/customers/e",
      "/estimates/f",
      "/estimates/g",
    ]);
    expect(pickHomePeople([leads]).map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(pickHomePeople([[person("only")]])).toHaveLength(1);
  });

  it("loads names with the signed-in client and renders the name and the reason", () => {
    const loader = readFileSync("src/lib/data/home-people.ts", "utf8");
    expect(loader).toContain("createClient");
    expect(loader).not.toContain("createAdminClient");
    expect(loader).toContain("estimate_queue_page");
    expect(loader).toContain("listJobsOnDate");
    expect(loader).toContain("homeEstimateCountArgs");
    expect(loader).toContain("homeTodayScope");
    const leads = loader.slice(loader.indexOf("// Pending leads"), loader.indexOf("// Follow-ups due"));
    expect(leads).toContain('eq("assigned_to", userId)');
    expect(leads).toContain('eq("lead_acceptance", "pending")');
    const follow = loader.slice(loader.indexOf("// Follow-ups due"), loader.indexOf("// Declined leads"));
    expect(follow).toContain('lt("next_action_due"');
    expect(follow).not.toContain("assigned_to");
    const declines = loader.slice(loader.indexOf("// Declined leads"), loader.indexOf("async function sentEstimates"));
    expect(declines).toContain('eq("lead_acceptance", "declined")');
    expect(declines).not.toContain("assigned_to");
    expect(loader).not.toContain("from(\"invoices\")");
    expect(loader).not.toContain("customer_deposits");
    for (const word of ["balance", "margin", "payment", "accounting"]) {
      expect(loader.toLowerCase()).not.toContain(word);
    }

    const page = readFileSync("src/app/(app)/home/page.tsx", "utf8");
    expect(page).toContain("loadHomePeople");
    expect(page).toContain("loadHomeCenter");

    const view = readFileSync("src/components/home-center-view.tsx", "utf8");
    expect(view).toContain("Who needs you");
    expect(view).toContain("{person.name}");
    expect(view).toContain("{person.why}");
    expect(view).toContain("aria-labelledby");
    expect(view).toContain("min-h-11");
    expect(view).not.toContain("<table");
    expect(view).toContain("Nothing is waiting right now.");
  });
});
