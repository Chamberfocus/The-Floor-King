import { describe, expect, it } from "vitest";
import { searchCatalogWith } from "@/lib/data/products";
import {
  HARD_SURFACE_CATEGORIES,
  catalogSuggestionPlan,
  pickerCatalogScope,
  productInPickerScope,
  rankCatalogProducts,
} from "@/lib/catalog-search";
import {
  alignCutGroupsToMeasuredRooms,
  cutGroupAsksForRoomName,
  formatMeasuredRoomReference,
  planCutGroups,
  selectRoomsForRollCuts,
  type AlignableCutGroup,
  type MeasuredCutRoom,
} from "@/lib/guided-estimate-rooms";
import { carpetYardageFromCuts } from "@/lib/questionnaire-calc";
import {
  hydrateBuilderMaterialRate,
  resolveGuidedProductRates,
} from "@/lib/guided-estimate-price";
import {
  areaDerivedMaterialAllowed,
  computeMaterialTakeoff,
} from "@/lib/flooring-knowledge";

type Sku = { productId: string; label: string; sellPrice?: string };
type Group = AlignableCutGroup<Sku>;

const living: MeasuredCutRoom<Sku> = {
  id: "a1",
  name: "Living Room",
  sqft: 168,
  lenIn: 12 * 12,
  widIn: 14 * 12,
  product: null,
};
const bedroom: MeasuredCutRoom<Sku> = {
  id: "a2",
  name: "Bedroom",
  sqft: 132,
  lenIn: 11 * 12,
  widIn: 12 * 12,
  product: null,
};
const hallway: MeasuredCutRoom<Sku> = {
  id: "a3",
  name: "Hallway",
  sqft: 30,
  lenIn: 3 * 12,
  widIn: 10 * 12,
  product: null,
};
const saga: Sku = { productId: "saga", label: "Mohawk Refined Saga II", sellPrice: "8.50" };

let n = 0;
function createGroup(room: MeasuredCutRoom<Sku> | null): Group {
  n += 1;
  const id = `g${n}`;
  return {
    id,
    area: room?.name ?? "",
    product: room?.product ?? null,
    sourceRoomId: room?.id,
    unplanned: !room,
    cuts: [{ id: `c${n}`, lf: "", li: "", width: "" }],
  };
}

function blankGroup(): Group {
  return {
    id: "blank",
    area: "",
    product: null,
    cuts: [{ id: "c0", lf: "", li: "", width: "" }],
  };
}

describe("guided estimate rooms flow into carpet cuts", () => {
  it("shows measured carpet rooms without asking for the name again", () => {
    const planned = planCutGroups({
      rooms: [living, bedroom, hallway],
      groups: [blankGroup()],
      same: true,
      product: null,
      createGroup,
    });
    expect(planned.groups.map((g) => g.area)).toEqual([
      "Living Room",
      "Bedroom",
      "Hallway",
    ]);
    expect(planned.groups.every((g) => !cutGroupAsksForRoomName(g))).toBe(true);
    expect(formatMeasuredRoomReference(living)).toBe("12' × 14' = 168 sq ft");
    expect(formatMeasuredRoomReference(bedroom)).toBe("11' × 12' = 132 sq ft");
    expect(formatMeasuredRoomReference(hallway)).toBe("3' × 10' = 30 sq ft");
  });

  it("keeps more than one cut on the same measured room", () => {
    const once = alignCutGroupsToMeasuredRooms([living], [blankGroup()], createGroup);
    once[0].cuts = [
      { id: "c1", lf: "14", li: "0", width: "12" },
      { id: "c2", lf: "6", li: "0", width: "12" },
    ];
    const again = alignCutGroupsToMeasuredRooms([living], once, createGroup);
    expect(again).toHaveLength(1);
    expect(again[0].area).toBe("Living Room");
    expect(again[0].cuts.map((c) => c.lf)).toEqual(["14", "6"]);
    expect(cutGroupAsksForRoomName(again[0])).toBe(false);
  });

  it("applies one SKU to the existing rooms when the carpet is the same", () => {
    const rooms = [living, bedroom, hallway].map((r) => ({ ...r, product: saga }));
    const planned = planCutGroups({
      rooms,
      groups: [blankGroup()],
      same: true,
      product: null,
      createGroup,
    });
    expect(planned.same).toBe(true);
    expect(planned.product).toEqual(saga);
    expect(planned.groups).toHaveLength(3);
    expect(planned.groups.map((g) => g.area)).toEqual([
      "Living Room",
      "Bedroom",
      "Hallway",
    ]);
    expect(new Set(planned.groups.map((g) => g.product?.productId))).toEqual(new Set(["saga"]));
  });

  it("uses the existing rooms when each area has its own carpet", () => {
    const a = { productId: "a", label: "Saga" };
    const b = { productId: "b", label: "Tonal" };
    const c = { productId: "c", label: "Wool" };
    const rooms = [
      { ...living, product: a },
      { ...bedroom, product: b },
      { ...hallway, product: c },
    ];
    const planned = planCutGroups({
      rooms,
      groups: [blankGroup()],
      same: true,
      product: null,
      createGroup,
    });
    expect(planned.same).toBe(false);
    expect(planned.groups.map((g) => g.product?.productId)).toEqual(["a", "b", "c"]);
    expect(planned.groups.every((g) => !cutGroupAsksForRoomName(g))).toBe(true);
  });

  it("orders carpet from the cuts and leaves measured square feet as measured area", () => {
    const yards = carpetYardageFromCuts([
      { lengthFt: 14, lengthIn: 0, rollWidthFt: 12 },
    ]);
    expect(yards.sqft).toBe(168);
    expect(yards.sqyd).toBe(18.67);
    const measured = 12 * 14;
    expect(measured).toBe(168);
    const takeoff = computeMaterialTakeoff({
      family: "carpet",
      measuredSqft: measured,
      cutsSqft: 144,
      carpetSystems: ["stretch_in"],
      billingUnit: "sqyd",
    });
    expect(takeoff.measured.sqft).toBe(168);
    expect(takeoff.orderBasis).toBe("cuts");
    expect(takeoff.orderSqft).toBe(144);
    expect(takeoff.orderSqft).not.toBe(measured);
    expect(areaDerivedMaterialAllowed("carpet", "sq yd", ["stretch_in"])).toBe(false);
    const fromCuts = carpetYardageFromCuts([
      { lengthFt: 12, lengthIn: 0, rollWidthFt: 12 },
    ]);
    expect(fromCuts.sqyd).toBe(16);
    expect(fromCuts.sqyd).not.toBe(Math.round((measured / 9) * 100) / 100);
  });

  it("keeps a typed selling price on the room's carpet through builder hydration", () => {
    const rooms = [{ ...living, product: saga }];
    const planned = planCutGroups({
      rooms,
      groups: [blankGroup()],
      same: true,
      product: null,
      createGroup,
    });
    expect(planned.product?.sellPrice).toBe("8.50");
    const rates = resolveGuidedProductRates({
      catalogCostInLineUnit: 5,
      costMissing: false,
      enteredSell: planned.product?.sellPrice ?? "",
      derivedSell: 8.33,
    });
    expect(rates.material_rate).toBe(8.5);
    expect(rates.material_cost).toBe(5);
    expect(rates.sellLocked).toBe(true);
    expect(hydrateBuilderMaterialRate(rates.material_rate, rates.material_cost, "carpet")).toBe(
      "8.5",
    );
  });

  it("does not add a product the salesperson did not choose", () => {
    const planned = planCutGroups({
      rooms: [living, bedroom],
      groups: [blankGroup()],
      same: true,
      product: null,
      createGroup,
    });
    expect(planned.product).toBeNull();
    expect(planned.groups.every((g) => g.product == null)).toBe(true);
    expect(catalogSuggestionPlan()).toEqual({ autoAdd: false, compatibleClaim: false });
  });

  it("keeps an unplanned cut and drops carpet rooms off a sheet-vinyl step", () => {
    const aligned = alignCutGroupsToMeasuredRooms([living], [blankGroup()], createGroup);
    const withExtra = alignCutGroupsToMeasuredRooms(
      [living],
      [
        ...aligned,
        {
          id: "extra",
          area: "Closet",
          product: null,
          unplanned: true,
          cuts: [{ id: "cx", lf: "4", li: "", width: "12" }],
        },
      ],
      createGroup,
    );
    expect(withExtra.map((g) => g.area)).toEqual(["Living Room", "Closet"]);
    expect(withExtra[1].unplanned).toBe(true);
    expect(cutGroupAsksForRoomName(withExtra[1])).toBe(true);

    const mixed = selectRoomsForRollCuts(
      "carpet",
      [living, bedroom],
      [
        { roomId: living.id, family: "carpet", category: "carpet" },
        { roomId: bedroom.id, family: "lvp", category: "lvp" },
      ],
    );
    expect(mixed.map((r) => r.name)).toEqual(["Living Room"]);
  });
});

describe("catalog context and search ranking", () => {
  const sagaRow = {
    id: "saga",
    name: "Refined Saga II",
    manufacturer: "Mohawk",
    sku: "RS-2044",
    style: "Refined Saga II",
    color: "Linen",
    category: "carpet",
    supplier: "Mohawk",
    active: true,
  };
  const lvp = {
    id: "lvp",
    name: "Coretec Oak",
    manufacturer: "Shaw",
    sku: "CT-1",
    category: "lvp",
    active: true,
  };
  const pad = {
    id: "pad",
    name: "8lb Rebond",
    manufacturer: "Leggett",
    sku: "PAD-8",
    category: "underlayment",
    active: true,
  };
  const hardwood = {
    id: "hw",
    name: "White Oak",
    manufacturer: "Hallmark",
    sku: "HW-1",
    category: "hardwood",
    active: true,
  };

  it("narrows carpet, padding, and hard surface without dropping search-all", () => {
    const carpet = pickerCatalogScope({ key: "carpet_cuts", category: "carpet" });
    expect(carpet.categories).toEqual(["carpet"]);
    expect(productInPickerScope("carpet", carpet)).toBe(true);
    expect(productInPickerScope("lvp", carpet)).toBe(false);
    expect(productInPickerScope("underlayment", carpet)).toBe(false);
    expect(productInPickerScope("hardwood", carpet)).toBe(false);
    expect(productInPickerScope("tile", carpet)).toBe(false);
    expect(productInPickerScope("trim", carpet)).toBe(false);

    const padding = pickerCatalogScope({ key: "carpet_pad", category: "underlayment" });
    expect(padding.label).toBe("Padding");
    expect(padding.categories).toEqual(["underlayment"]);
    expect(productInPickerScope("underlayment", padding)).toBe(true);
    expect(productInPickerScope("carpet", padding)).toBe(false);

    const hs = pickerCatalogScope({ key: "hard_surface" });
    expect(hs.categories).toEqual([...HARD_SURFACE_CATEGORIES]);
    expect(productInPickerScope("lvp", hs)).toBe(true);
    expect(productInPickerScope("hardwood", hs)).toBe(true);
    expect(productInPickerScope("tile", hs)).toBe(true);
    expect(productInPickerScope("vinyl", hs)).toBe(true);
    expect(productInPickerScope("carpet", hs)).toBe(false);
    expect(productInPickerScope("underlayment", hs)).toBe(false);

    expect(pickerCatalogScope({ category: "lvp" }).categories).toEqual(["lvp"]);
    expect(pickerCatalogScope({ key: "adhesive" }).browseTokens).toEqual(["adhesive", "glue"]);
    expect(pickerCatalogScope({ key: "hs_underlayment" }).label).toBe("Underlayment");
    expect(pickerCatalogScope({ key: "hs_transitions" }).categories).toEqual(["trim"]);
    expect(pickerCatalogScope({}).categories).toBeNull();
  });

  it("ranks a partial name, a manufacturer plus product, and a SKU", () => {
    const rows = [lvp, pad, hardwood, sagaRow];
    expect(rankCatalogProducts(rows, "ref saga")[0].id).toBe("saga");
    expect(rankCatalogProducts(rows, "mohawk saga")[0].id).toBe("saga");
    expect(rankCatalogProducts(rows, "RS-2044")[0].id).toBe("saga");
    expect(rankCatalogProducts(rows, "2044")[0].id).toBe("saga");
    const shawSaga = {
      id: "shaw",
      name: "Saga",
      manufacturer: "Shaw",
      sku: "SH-1",
      category: "carpet",
      active: true,
    };
    expect(rankCatalogProducts([shawSaga, sagaRow], "mohawk saga")[0].id).toBe("saga");
  });

  it("searches a category without scoring the whole catalog", async () => {
    const rpcCalls: string[] = [];
    const filters: string[] = [];
    const products = [
      { ...sagaRow, active: true },
      { ...lvp, active: true },
    ];
    const productChain: Record<string, unknown> = {};
    const self = () => productChain;
    productChain.select = self;
    productChain.order = self;
    productChain.limit = self;
    productChain.eq = (col: string, val: string) => {
      filters.push(`eq:${col}:${val}`);
      return productChain;
    };
    productChain.in = (col: string, vals: string[]) => {
      filters.push(`in:${col}:${vals.join(",")}`);
      return productChain;
    };
    productChain.or = (expr: string) => {
      filters.push(`or:${expr}`);
      return productChain;
    };
    productChain.then = (resolve: (v: unknown) => unknown) => {
      const cat = filters.find((f) => f.startsWith("eq:category:"));
      const want = cat?.split(":")[2];
      const data = products.filter((p) => !want || p.category === want);
      return Promise.resolve({ data, error: null }).then(resolve);
    };
    const dead: Record<string, unknown> = {};
    const deadSelf = () => dead;
    dead.select = deadSelf;
    dead.eq = deadSelf;
    dead.in = deadSelf;
    dead.order = deadSelf;
    dead.maybeSingle = () => Promise.resolve({ data: null, error: { message: "no" } });
    dead.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: null, error: { message: "no" } }).then(resolve);

    const client = {
      rpc() {
        rpcCalls.push("rpc");
        return Promise.resolve({ data: [], error: { message: "should not run" } });
      },
      from(table: string) {
        return table === "products" ? productChain : dead;
      },
    };

    const rows = await searchCatalogWith(client, "saga", {
      categories: ["carpet"],
      limit: 10,
      activeOnly: true,
    });
    expect(rpcCalls).toEqual([]);
    expect(filters.some((f) => f === "eq:category:carpet")).toBe(true);
    expect(rows.map((r) => r.id)).toEqual(["saga"]);
    expect(rows.some((r) => r.category === "lvp")).toBe(false);
  });
});
