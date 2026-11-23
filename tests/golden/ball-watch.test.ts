import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ballItemsFromPeople,
  companionBrief,
  companionStaysOnFacts,
  employeeNudge,
  firstMove,
  mergeWatchPeople,
  oversightNudge,
  type WatchTask,
} from "@/lib/ball-watch";
import type { HomePerson } from "@/lib/home-people";

function person(name: string, href: string): HomePerson {
  return { id: href, name, why: "Follow-up is due", href };
}

function task(id: string, title: string, customerId: string | null = null): WatchTask {
  return { id, title, customer_id: customerId, job_id: null, source_key: null };
}

describe("ball watch", () => {
  it("puts overdue tasks ahead of the customers already on Home", () => {
    const merged = mergeWatchPeople(
      [person("Jon Hale", "/customers/jon")],
      {
        overdue: [task("t1", "Call Maria about the estimate", "maria")],
        dueToday: [task("t2", "Order the pad")],
      },
      true,
    );
    expect(merged.map((row) => row.name)).toEqual([
      "Call Maria about the estimate",
      "Order the pad",
      "Jon Hale",
    ]);
    expect(merged[0].why).toBe("This task is overdue");
    expect(merged[0].href).toBe("/customers/maria");
    expect(merged[1].href).toBe("/tasks?view=mine#t2");
    expect(merged[1].why).toBe("This task is due today");
  });

  it("keeps one link when the task and the customer open the same file", () => {
    const merged = mergeWatchPeople(
      [person("Maria Lopez", "/customers/maria")],
      { overdue: [task("t1", "Call Maria", "maria")], dueToday: [] },
      true,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe("Call Maria");
  });

  it("skips a task a crew member cannot open", () => {
    const merged = mergeWatchPeople(
      [],
      { overdue: [task("t1", "Count the remnant")], dueToday: [] },
      false,
    );
    expect(merged).toEqual([]);
  });

  it("says the first move from the rows and nothing else", () => {
    const items = ballItemsFromPeople([
      person("Maria Lopez", "/customers/maria"),
      person("Jon Hale", "/customers/jon"),
    ]);
    expect(firstMove(items)).toBe("Maria Lopez. Follow-up is due. 1 more is also waiting.");
    expect(firstMove(items.slice(0, 1))).toBe("Maria Lopez. Follow-up is due.");
    expect(firstMove([])).toBe("");
  });

  it("asks the model to stay on the supplied lines", () => {
    const items = ballItemsFromPeople([person("Maria Lopez", "/customers/maria")]);
    const brief = companionBrief(items);
    expect(brief?.prompt).toContain("Maria Lopez");
    expect(brief?.system).toContain("Do not add a customer");
    expect(companionBrief([])).toBeNull();
    expect(companionStaysOnFacts("Start with Maria Lopez. Her follow-up is due.", items)).toBe(true);
    expect(companionStaysOnFacts("Call Sam and collect $400.", items)).toBe(false);
    expect(companionStaysOnFacts("Check the warehouse.", items)).toBe(false);
  });

  it("writes one employee reminder for stuck clients and overdue tasks", () => {
    const onlyClients = employeeNudge({
      customers: [{ name: "Maria Lopez", stage: "Estimate sent", action: "Follow up" }],
      tasks: [],
    });
    expect(onlyClients?.subject).toBe("1 client needs your attention");
    expect(onlyClients?.heading).toBe("Clients waiting on you");
    expect(onlyClients?.path).toBe("/client-status?who=mine&overdue=1");

    const both = employeeNudge({
      customers: [{ name: "A & B <script>", stage: "Sold", action: "Collect" }],
      tasks: [{ title: "Call back" }, { title: "  " }],
    });
    expect(both?.subject).toBe("1 client and 1 overdue task need you");
    expect(both?.innerHtml).toContain("A &amp; B &lt;script&gt;");
    expect(both?.innerHtml).toContain("Call back");
    expect(both?.innerHtml).not.toContain("<script>");

    expect(employeeNudge({ customers: [], tasks: [{ title: "Order the pad" }] })?.subject).toBe(
      "1 task is overdue",
    );
    expect(employeeNudge({ customers: [], tasks: [] })).toBeNull();
  });

  it("keeps the owner digest on the same facts", () => {
    const digest = oversightNudge({
      customers: [{ name: "Maria Lopez", stage: "Estimate sent", action: "Follow up" }],
      tasks: [],
    });
    expect(digest?.subject).toBe("1 client is stuck too long");
    expect(digest?.heading).toBe("Clients stuck too long — full view");
    const withTasks = oversightNudge({
      customers: [{ name: "Maria Lopez", stage: "Estimate sent", action: "Follow up" }],
      tasks: [{ title: "Order the pad" }],
    });
    expect(withTasks?.subject).toBe("1 client is stuck too long, and 1 task is overdue");
    expect(withTasks?.innerHtml).toContain("Order the pad");
    expect(oversightNudge({ customers: [], tasks: [] })).toBeNull();
  });

  it("is wired into Home, the other desks, and the daily reminder", () => {
    const home = readFileSync("src/app/(app)/home/page.tsx", "utf8");
    expect(home).toContain("loadHomePeople");
    expect(home).toContain("mergeWatchPeople");
    const view = readFileSync("src/components/home-center-view.tsx", "utf8");
    expect(view).toContain("Who needs you");
    expect(view).toContain("BallCompanion");
    const cron = readFileSync("src/app/api/cron/daily/route.ts", "utf8");
    expect(cron).toContain("employeeNudge");
    expect(cron).toContain("oversightNudge");
    expect(cron).toContain("isTaskOverdue");
    expect(cron).toContain('from("office_tasks")');
    const action = readFileSync("src/app/(app)/home/companion-actions.ts", "utf8");
    expect(action).toContain("loadBallPeople");
    expect(action).not.toContain("customers: ");
  });
});
