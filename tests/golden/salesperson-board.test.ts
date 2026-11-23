import { describe, expect, it } from "vitest";
import { salespersonBooks, workIsPastDue } from "@/lib/salesperson-board";
import type { WorkUnit } from "@/lib/work-stage";

const now = new Date("2026-11-22T18:00:00Z");

function unit(partial: Partial<WorkUnit> & Pick<WorkUnit, "id" | "salespersonId">): WorkUnit {
  return {
    kind: "customer",
    customerId: partial.id,
    customerName: partial.customerName ?? partial.id,
    title: null,
    site: null,
    stageId: "quote",
    ownerId: partial.salespersonId,
    dueAt: null,
    preJob: true,
    ...partial,
  };
}

const stages = new Map([
  ["quote", { id: "quote", name: "Quote out", position: 60, outcome: "active" as const }],
  ["lost", { id: "lost", name: "Lost", position: 20, outcome: "lost" as const }],
]);

describe("salesperson books", () => {
  it("groups live clients under the assigned salesperson and leads with who is stuck", () => {
    const books = salespersonBooks({
      now,
      names: { sam: "Sam Cole" },
      stageById: stages,
      units: [
        unit({ id: "a", salespersonId: "sam", customerName: "Ada", dueAt: "2026-11-20T12:00:00Z" }),
        unit({ id: "b", salespersonId: "sam", customerName: "Bea" }),
        unit({
          id: "c",
          salespersonId: null,
          customerName: "Cara",
          dueAt: "2026-11-21T12:00:00Z",
          stageId: null,
        }),
        unit({ id: "d", salespersonId: "sam", customerName: "Gone", stageId: "lost" }),
      ],
    });
    expect(books.map((book) => [book.name, book.stuck])).toEqual([
      ["Sam Cole", 1],
      ["No salesperson", 1],
    ]);
    expect(books[0].clients.map((client) => client.customerName)).toEqual(["Ada", "Bea"]);
    expect(books[0].clients[0].stuck).toBe(true);
    expect(books[0].clients[0].laneTitle).toBe("Quote out");
    expect(books[0].clients[0].next).toBe("Follow it up");
    expect(books[1].clients[0].stageName).toBe("No stage set");
    expect(workIsPastDue("2026-11-23T12:00:00Z", now)).toBe(false);
  });
});
