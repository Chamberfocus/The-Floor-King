/**
 * Measured rooms are the only room list in Guided Estimate.
 * Carpet & Cuts hangs cut pieces on those rooms. It does not collect a
 * second set of room names. Cut length × width is the order quantity.
 * Measured square feet stays the measured area.
 */

export interface MeasuredCutRoom<P = unknown> {
  id: string;
  name: string;
  sqft: number;
  lenIn: number | null;
  widIn: number | null;
  /** Already chosen on the floor map. Not a suggestion. */
  product?: P | null;
}

export interface AlignableCut {
  id: string;
  lf: string;
  li: string;
  width: string;
}

export interface AlignableCutGroup<P = unknown> {
  id: string;
  area: string;
  product: P | null;
  cuts: AlignableCut[];
  /** Area-row id. Set on measured rooms. Absent on an unplanned cut. */
  sourceRoomId?: string;
  /** A cut that was not one of the measured rooms. */
  unplanned?: boolean;
}

function normName(s: string): string {
  return s.trim().toLowerCase();
}

export function cutHasEnteredSize(cuts: AlignableCut[]): boolean {
  return cuts.some((c) => c.lf.trim() !== "" || c.li.trim() !== "" || c.width.trim() !== "");
}

/** A measured room already has a name. The cut step must not ask for it again. */
export function cutGroupAsksForRoomName(g: {
  sourceRoomId?: string;
  unplanned?: boolean;
}): boolean {
  return !g.sourceRoomId || !!g.unplanned;
}

export function isUntouchedCutPlaceholder(groups: AlignableCutGroup[]): boolean {
  if (groups.length !== 1) return false;
  const g = groups[0];
  if (g.unplanned || g.sourceRoomId || g.area.trim() || g.product) return false;
  return !cutHasEnteredSize(g.cuts);
}

export function formatInchDim(inches: number | null | undefined): string | null {
  if (inches == null || !(inches > 0)) return null;
  let ft = Math.floor(inches / 12);
  let inch = Math.round(inches % 12);
  if (inch === 12) {
    ft += 1;
    inch = 0;
  }
  if (inch) return ft ? `${ft}' ${inch}"` : `${inch}"`;
  return `${ft}'`;
}

/** Reference only. This string is not an order quantity. */
export function formatMeasuredRoomReference(room: {
  sqft: number;
  lenIn: number | null;
  widIn: number | null;
}): string {
  const a = formatInchDim(room.lenIn);
  const b = formatInchDim(room.widIn);
  const sq = Number.isInteger(room.sqft) ? String(room.sqft) : String(room.sqft);
  const area = `${sq} sq ft`;
  if (a && b) return `${a} × ${b} = ${area}`;
  return area;
}

/**
 * Carpet rooms, or sheet-vinyl rooms, from the measured list.
 * With no floor-map assignment yet, every measured room stays — the
 * salesperson has not split the job. Once a room has a product family,
 * only rooms of this roll family are cuts for this step.
 */
export function selectRoomsForRollCuts<R extends { id: string }>(
  roll: "carpet" | "vinyl",
  rooms: R[],
  assignments: { roomId: string; family: string | null; category: string | null }[] | null,
): R[] {
  if (!assignments || !assignments.length) return rooms;
  const anyAssigned = assignments.some((a) => a.family && a.family !== "other");
  if (!anyAssigned) return rooms;
  const wanted = new Set(
    assignments
      .filter((a) => {
        if (roll === "vinyl") return a.family === "vinyl" || a.category === "vinyl";
        return a.family === "carpet" || a.category === "carpet";
      })
      .map((a) => a.roomId),
  );
  return rooms.filter((r) => wanted.has(r.id));
}

export function distinctRoomProducts<P extends { productId?: string; label?: string }>(
  rooms: { product?: P | null }[],
): P[] {
  const out: P[] = [];
  const seen = new Set<string>();
  for (const r of rooms) {
    const p = r.product;
    if (!p) continue;
    const k = (p.productId || "").trim() || (p.label || "").trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/**
 * One cut group per measured room. Cuts already entered for that room stay.
 * A blank "Area / room" row is not a second room — it is dropped, or its
 * cuts move onto a measured room when that is the only place they can live.
 * Extra groups the salesperson marked unplanned stay.
 */
export function alignCutGroupsToMeasuredRooms<P, G extends AlignableCutGroup<P>>(
  rooms: MeasuredCutRoom<P>[],
  groups: G[],
  createGroup: (room: MeasuredCutRoom<P> | null) => G,
): G[] {
  if (!rooms.length) {
    const kept = groups.filter(
      (g) => g.unplanned || g.area.trim() !== "" || cutHasEnteredSize(g.cuts) || g.product,
    );
    if (kept.length) return kept;
    return groups.length ? groups : [createGroup(null)];
  }

  const used = new Set<G>();
  const take = (g: G | undefined): G | undefined => {
    if (!g || used.has(g)) return undefined;
    used.add(g);
    return g;
  };

  const aligned = rooms.map((room) => {
    const name = normName(room.name);
    const byId = take(groups.find((g) => !g.unplanned && g.sourceRoomId === room.id));
    const byName =
      byId ??
      (name
        ? take(
            groups.find(
              (g) => !g.unplanned && !g.sourceRoomId && normName(g.area) === name,
            ),
          )
        : undefined);
    const byStaleName =
      byName ??
      (name
        ? take(
            groups.find(
              (g) =>
                !g.unplanned &&
                !!g.sourceRoomId &&
                g.sourceRoomId !== room.id &&
                normName(g.area) === name,
            ),
          )
        : undefined);
    const existing = byId ?? byName ?? byStaleName;
    if (!existing) {
      const fresh = createGroup(room);
      return {
        ...fresh,
        area: room.name,
        sourceRoomId: room.id,
        unplanned: false,
        product: room.product ?? null,
      };
    }
    return {
      ...existing,
      area: room.name,
      sourceRoomId: room.id,
      unplanned: false,
      product: existing.product ?? room.product ?? null,
    };
  });

  const unplanned: G[] = [];
  for (const g of groups) {
    if (used.has(g)) continue;
    if (g.unplanned) {
      unplanned.push(g);
      continue;
    }
    if (!g.area.trim() && !cutHasEnteredSize(g.cuts) && !g.product) continue;
    unplanned.push({ ...g, unplanned: true, sourceRoomId: undefined });
  }

  const blankOrphans = unplanned.filter((g) => !g.area.trim() && cutHasEnteredSize(g.cuts));
  if (blankOrphans.length === 1) {
    const target = aligned.find((g) => !cutHasEnteredSize(g.cuts));
    if (target) {
      target.cuts = blankOrphans[0].cuts;
      const idx = unplanned.indexOf(blankOrphans[0]);
      if (idx >= 0) unplanned.splice(idx, 1);
    }
  }

  return [...aligned, ...unplanned];
}

/**
 * Same SKU for every existing room. Does not create rooms.
 * Different per area keeps those same rooms and a product on each.
 */
export function planCutGroups<
  P extends { productId?: string; label?: string },
  G extends AlignableCutGroup<P>,
>(args: {
  rooms: MeasuredCutRoom<P>[];
  groups: G[];
  same: boolean;
  product: P | null;
  earlierProduct?: P | null;
  createGroup: (room: MeasuredCutRoom<P> | null) => G;
}): { groups: G[]; same: boolean; product: P | null } {
  const placeholder = isUntouchedCutPlaceholder(args.groups);
  let same = args.same;
  let product = args.product;
  if (placeholder) {
    const distinct = distinctRoomProducts(args.rooms);
    if (distinct.length > 1) {
      same = false;
      product = null;
    } else if (distinct.length === 1) {
      same = true;
      product = product ?? distinct[0];
    } else if (!product && args.earlierProduct) {
      same = true;
      product = args.earlierProduct;
    }
  }
  const groups = alignCutGroupsToMeasuredRooms(args.rooms, args.groups, args.createGroup);
  return { groups, same, product };
}

export function cutGroupsEqual<P extends { productId?: string; label?: string; sellPrice?: string }>(
  a: AlignableCutGroup<P>[],
  b: AlignableCutGroup<P>[],
): boolean {
  if (a.length !== b.length) return false;
  const key = (p: P | null) =>
    p ? `${p.productId ?? ""}|${p.label ?? ""}|${p.sellPrice ?? ""}` : "";
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.id !== y.id) return false;
    if (x.area !== y.area) return false;
    if ((x.sourceRoomId ?? "") !== (y.sourceRoomId ?? "")) return false;
    if (!!x.unplanned !== !!y.unplanned) return false;
    if (key(x.product) !== key(y.product)) return false;
    if (x.cuts.length !== y.cuts.length) return false;
    for (let j = 0; j < x.cuts.length; j++) {
      const c = x.cuts[j];
      const d = y.cuts[j];
      if (c.id !== d.id || c.lf !== d.lf || c.li !== d.li || c.width !== d.width) return false;
    }
  }
  return true;
}
