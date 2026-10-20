/**
 * Product search has to find the item a salesperson actually typed:
 * brand + line, a color out of order, a SKU, a trade word, or a typo.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCatalogQuery, rankCatalogProducts, tokenMatchOr } from "@/lib/catalog-query";
import { searchCatalogWith } from "@/lib/data/products";

const root = process.cwd();

const coretec = {
  id: "coretec",
  name: "CORETEC ORIGINALS Gold Coast Acacia",
  manufacturer: "Shaw",
  sku: "CT-ACACIA",
  style: "Originals",
  color: "Gold Coast Acacia",
  category: "lvp",
  active: true,
};
const coral = {
  id: "coral",
  name: "Coral Shores",
  manufacturer: "Mohawk",
  sku: "MH-1",
  category: "carpet",
  active: true,
};
const partialCoast = {
  id: "coast",
  name: "LW PLANK Gold Coast",
  manufacturer: "Shaw",
  sku: "LW-1",
  category: "lvp",
  active: true,
};
const mop = {
  id: "mop",
  name: "Vibrant Mop Pad",
  manufacturer: "Misc",
  sku: "MOP-1",
  category: "other",
  active: true,
};
const rebond = {
  id: "rebond",
  name: "8lb Rebond",
  manufacturer: "Leggett",
  sku: "PAD-8",
  category: "underlayment",
  fiber: null,
  active: true,
};
const halfPad = {
  id: "half",
  name: '1/2" 8 lb Rebond',
  manufacturer: "Leggett",
  sku: "PAD-HALF",
  category: "underlayment",
  active: true,
};
const dream = {
  id: "dream",
  name: "Dreamweaver Natural Wonder",
  manufacturer: "Engineered Floors",
  sku: "DW-1",
  category: "carpet",
  fiber: "Anso Nylon",
  active: true,
};
const rev = {
  id: "rev",
  name: "Shaw RevWood Plus",
  manufacturer: "Shaw",
  sku: "RV-1",
  category: "laminate",
  active: true,
};
const tmold = {
  id: "tmold",
  name: "T-Molding Satin Nickel",
  manufacturer: "Schluter",
  sku: "TM-1",
  category: "trim",
  active: true,
};
const quarter = {
  id: "quarter",
  name: "Quarter Round White",
  manufacturer: "Floor King",
  sku: "QR-1",
  category: "trim",
  active: true,
};
const whiteOak = {
  id: "white-oak",
  name: "Natural Classics White Oak",
  manufacturer: "Hallmark",
  sku: "HW-OAK",
  category: "hardwood",
  active: true,
};
const justOak = {
  id: "just-oak",
  name: "White Oak",
  manufacturer: "Hallmark",
  sku: "HW-2",
  category: "hardwood",
  active: true,
};

const catalog = [
  coral,
  partialCoast,
  mop,
  rebond,
  halfPad,
  dream,
  rev,
  tmold,
  quarter,
  justOak,
  whiteOak,
  coretec,
];

function top(query: string) {
  return rankCatalogProducts(catalog, query).map((row) => row.id);
}

describe("catalog search understands how products are typed", () => {
  it("puts the product that matches every word ahead of a lookalike", () => {
    expect(top("shaw coretec")[0]).toBe("coretec");
    expect(top("shaw coretec")).not.toContain("coral");
    expect(top("gold coast acacia")[0]).toBe("coretec");
    expect(top("gold coast acacia").indexOf("coretec")).toBeLessThan(top("gold coast acacia").indexOf("coast"));
  });

  it("finds padding from trade words, weights, and fractions", () => {
    const eight = top("8lb pad");
    expect(["rebond", "half"]).toContain(eight[0]);
    expect(eight).toContain("rebond");
    expect(eight[0]).not.toBe("mop");
    const cushion = top("cushion");
    expect(["rebond", "half"]).toContain(cushion[0]);
    expect(cushion).not.toContain("mop");
    expect(top("1/2 8lb")[0]).toBe("half");
    expect(top("carpett pad")[0]).not.toBe("coral");
    expect(["rebond", "half"]).toContain(top("carpett pad")[0]);
  });

  it("finds a brand, a fiber, a trim shape, and a color through typos", () => {
    expect(top("coretech")[0]).toBe("coretec");
    expect(top("dreamweever")[0]).toBe("dream");
    expect(top("acaia")[0]).toBe("coretec");
    expect(top("anso nylon")[0]).toBe("dream");
    expect(top("rev wood")[0]).toBe("rev");
    expect(top("t mold")[0]).toBe("tmold");
    expect(top("t-mold")[0]).toBe("tmold");
    expect(top("quarter round")[0]).toBe("quarter");
  });

  it("keeps a full color name ahead of a shorter one", () => {
    const ids = top("natural classics white oak");
    expect(ids[0]).toBe("white-oak");
    expect(ids.indexOf("white-oak")).toBeLessThan(ids.indexOf("just-oak"));
  });

  it("treats carpet pad as padding, and still ranks a SKU exactly", () => {
    const plan = parseCatalogQuery("carpett pad");
    expect(plan.find((token) => token.raw === "carpett")?.optional).toBe(true);
    expect(plan.find((token) => token.categories.includes("underlayment"))?.optional).toBe(false);
    expect(top("RS-2044")).toEqual([]);
    expect(top("CT-ACACIA")[0]).toBe("coretec");
    expect(top("2044")).toEqual([]);
  });

  it("asks the database for each word, including the pad category", () => {
    const [pad] = parseCatalogQuery("cushion");
    const clause = tokenMatchOr(pad, ["search_text"]);
    expect(clause).toContain("search_text.ilike.");
    expect(clause).toContain("category.eq.underlayment");
    expect(clause).not.toContain("category.eq.carpet");
  });
});

describe("catalog search runs the same plan against the query builder", () => {
  it("does not call the old similarity search, and ranks the scoped hit", async () => {
    const rpcCalls: string[] = [];
    const filters: string[] = [];
    const products = [coretec, coral];
    const productChain: Record<string, unknown> = {};
    const self = () => productChain;
    productChain.select = self;
    productChain.order = self;
    productChain.limit = self;
    productChain.eq = (col: string, val: string) => {
      filters.push(`eq:${col}:${val}`);
      return productChain;
    };
    productChain.in = self;
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
      rpc(name: string) {
        rpcCalls.push(name);
        return Promise.resolve({ data: [], error: { message: "not installed" } });
      },
      from(table: string) {
        return table === "products" ? productChain : dead;
      },
    };

    const rows = await searchCatalogWith(client, "coretec", { limit: 5, activeOnly: true });
    expect(rpcCalls).toEqual(["search_products_smart"]);
    expect(rows.map((row) => row.id)).toEqual(["coretec"]);
    expect(filters.some((f) => f.includes("coretec"))).toBe(true);
  });
});

describe("0495 product search migration", () => {
  const sql = readFileSync(
    join(root, "supabase/migrations/0495_smarter_product_search.sql"),
    "utf8",
  );

  it("ranks by how many words matched and does not read valuation columns", () => {
    expect(sql).toMatch(/create or replace function public\.search_products_smart/i);
    expect(sql).toContain("avg_unit_cost");
    expect(sql).toContain("inventory_carrying_value");
    expect(sql).toMatch(/null::/i);
    expect(sql).not.toMatch(/select \*\s+from public\.products\b/i);
    expect(sql).toContain("underlayment");
    expect(sql).toContain("_hits");
    expect(sql).not.toContain("word_similarity");
    expect(sql).toContain("Does NOT enable accounting");
    expect(sql).not.toMatch(/posting_enabled\s*=\s*true/);
  });

  it("keeps search_products_smart off anon and still gates inventory search", () => {
    expect(sql).toContain(
      "revoke all on function public.search_products_smart(text, int, boolean, boolean, text[]) from public",
    );
    expect(sql).toContain(
      "revoke all on function public.search_products_smart(text, int, boolean, boolean, text[]) from anon",
    );
    expect(sql).toContain("grant execute on function public.search_products_smart(text, int, boolean, boolean, text[]) to authenticated");
    expect(sql).toContain("accounting_require_roles");
    expect(sql).toContain("security definer");
    expect(sql).toContain("inv_list_inventory_products_ops");
  });
});
