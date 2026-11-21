/**
 * A new price list replaces that manufacturer's old prices.
 * The same product is one row: same name, or the same maker, style, color, and unit.
 * Rows the new list does not include are turned off. Nothing is deleted.
 */

export type PriceListIdentity = {
  name: string;
  manufacturer?: string | null;
  style?: string | null;
  color?: string | null;
  unit?: string | null;
  category?: string | null;
};

export type ExistingPriceListProduct = PriceListIdentity & {
  id: string;
  active?: boolean | null;
  updated_at?: string | null;
  material_rate?: number | null;
};

export type PriceListReplacePlan = {
  /** Existing row to overwrite with this incoming product. */
  updates: { id: string; index: number }[];
  /** Incoming rows that are not already in the book. */
  inserts: number[];
  /** Existing rows to turn off. */
  retire: string[];
};

export function normalizeProductName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function clean(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** Maker + style + color + unit + category. Null when style or color is missing. */
export function styleColorKey(product: PriceListIdentity): string | null {
  const style = clean(product.style);
  const color = clean(product.color);
  if (!style || !color) return null;
  return [
    clean(product.manufacturer),
    style,
    color,
    clean(product.unit),
    clean(product.category),
  ].join("|");
}

export function sameCatalogProduct(a: PriceListIdentity, b: PriceListIdentity): boolean {
  const name = normalizeProductName(a.name);
  if (name && name === normalizeProductName(b.name)) {
    const left = clean(a.manufacturer);
    const right = clean(b.manufacturer);
    if (!left || !right || left === right) return true;
  }
  const key = styleColorKey(a);
  return key != null && key === styleColorKey(b);
}

function keepRank(product: ExistingPriceListProduct): [number, number, string, string] {
  return [
    product.active === false ? 0 : 1,
    (product.material_rate ?? 0) > 0 ? 1 : 0,
    product.updated_at ?? "",
    product.id,
  ];
}

function preferKeep(a: ExistingPriceListProduct, b: ExistingPriceListProduct): number {
  const left = keepRank(a);
  const right = keepRank(b);
  for (let i = 0; i < left.length; i++) {
    if (left[i] === right[i]) continue;
    return left[i] < right[i] ? 1 : -1;
  }
  return 0;
}

export function planPriceListReplace(
  existing: ExistingPriceListProduct[],
  incoming: PriceListIdentity[],
): PriceListReplacePlan {
  const claimed = new Map<string, number>();
  const extras = new Set<string>();
  const inserts: number[] = [];

  incoming.forEach((row, index) => {
    const matches = existing.filter((product) => sameCatalogProduct(product, row));
    if (!matches.length) {
      inserts.push(index);
      return;
    }
    const ranked = [...matches].sort(preferKeep);
    claimed.set(ranked[0].id, index);
    for (const other of ranked.slice(1)) extras.add(other.id);
  });

  const keepIds = new Set(claimed.keys());
  const retire = new Set<string>();
  for (const id of extras) if (!keepIds.has(id)) retire.add(id);
  for (const id of supersededIds(existing, incoming)) if (!keepIds.has(id)) retire.add(id);
  for (const id of duplicateIds(existing)) if (!keepIds.has(id)) retire.add(id);

  return {
    updates: [...claimed.entries()].map(([id, index]) => ({ id, index })),
    inserts,
    retire: [...retire],
  };
}

/** Active products of a manufacturer on this list, in a category the list covers, that the list left off. */
function supersededIds(
  existing: ExistingPriceListProduct[],
  incoming: PriceListIdentity[],
): string[] {
  const byMaker = new Map<string, PriceListIdentity[]>();
  for (const row of incoming) {
    const maker = clean(row.manufacturer);
    if (!maker) continue;
    const list = byMaker.get(maker) ?? [];
    list.push(row);
    byMaker.set(maker, list);
  }
  const retire: string[] = [];
  for (const [maker, rows] of byMaker) {
    const categories = new Set(rows.map((row) => clean(row.category)).filter(Boolean));
    const kept = new Set<string>();
    for (const row of rows) {
      for (const product of existing) {
        if (sameCatalogProduct(product, row)) kept.add(product.id);
      }
    }
    for (const product of existing) {
      if (product.active === false) continue;
      if (clean(product.manufacturer) !== maker) continue;
      const category = clean(product.category);
      if (categories.size && !categories.has(category)) continue;
      if (kept.has(product.id)) continue;
      retire.push(product.id);
    }
  }
  return retire;
}

/** Extra copies of the same product. The kept copy is the active, priced, newest row. */
function duplicateIds(existing: ExistingPriceListProduct[]): string[] {
  const groups = new Map<string, ExistingPriceListProduct[]>();
  for (const product of existing) {
    if (product.active === false) continue;
    const name = normalizeProductName(product.name);
    const keys = name ? [`name:${clean(product.manufacturer)}|${name}`] : [];
    const styleKey = styleColorKey(product);
    if (styleKey) keys.push(`style:${styleKey}`);
    for (const key of keys) {
      if (key === "name:") continue;
      const list = groups.get(key) ?? [];
      list.push(product);
      groups.set(key, list);
    }
  }
  const retire = new Set<string>();
  for (const group of groups.values()) {
    const unique = [...new Map(group.map((product) => [product.id, product])).values()];
    if (unique.length < 2) continue;
    const keep = [...unique].sort(preferKeep)[0];
    for (const product of unique) if (product.id !== keep.id) retire.add(product.id);
  }
  return [...retire];
}
