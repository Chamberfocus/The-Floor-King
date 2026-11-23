/**
 * All Surfaces RL price lists (Aquaproof, Casabella Firmfit, Congoleum
 * Triversa Prime, Contract 180, LifeCore Tactical).
 *
 * A color row is the plank or tile at the printed Price / Price/SF / Price/SY.
 * That price is the cost. Molding columns to the right are separate trim,
 * priced each from the header above the colors. Accessories with their own
 * price are kept. Diagram pages, warranties, and "contact sales" rows are not
 * products. No price is invented.
 */
import type { PriceRow } from "@/lib/extract";

export interface RlTextItem {
  str: string;
  x: number;
  y: number;
}

export interface RlPriceBook {
  rows: PriceRow[];
  distributor: string;
  manufacturer: string;
  effective: string;
}

const DISTRIBUTOR = "All Surfaces";

interface Band {
  y: number;
  items: RlTextItem[];
}

interface TrimCol {
  profile: string;
  length: string;
  price: number;
  x: number;
}

interface Draft extends PriceRow {
  kind: "floor" | "trim" | "other";
  width: string;
}

const HEADER_WORD =
  /^(color|item\s*#?|price(?:\s*\/\s*(?:sf|sy)|\s+per\s+sf)?|species|visual|product|size|description|description\/size|retail|display\s*price|warranty|sf\/ctn|sf\/pallet|sy\/roll|ea\/ctn|price\s*ea|price\s*each|price\/sy|type|coverage|cove\s*base)$/i;

const NOISE_LINE =
  /^(terms:|packaging:|warranty:|installation:|install:|\*end cap|\*\s*"|\*\s*special|\*\*|standard delivery|http|effective|molding profiles|stair systems|each waterproof|recommended adhesives|built to pair|repair kits)/i;

function bandsOf(items: RlTextItem[]): Band[] {
  const sorted = items
    .filter((it) => (it.str.trim().length > 1 || /[0-9$]/.test(it.str)))
    .map((it) => ({ ...it, str: it.str.replace(/\s+/g, " ").trim() }))
    .filter((it) => it.str && !/^[A-Za-z]$/.test(it.str) && it.str !== "/" && it.str !== "•")
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const bands: Band[] = [];
  for (const it of sorted) {
    const last = bands[bands.length - 1];
    if (!last || last.y - it.y > 2.4) bands.push({ y: it.y, items: [it] });
    else last.items.push(it);
  }
  for (const band of bands) band.items.sort((a, b) => a.x - b.x);
  return bands;
}

function text(band: Band): string {
  return band.items
    .map((it) => it.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function money(token: string): number | null {
  const m = token.replace(/,/g, "").match(/^\$(\d+\.\d{2})(?:\s|\/|$)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function skuLike(token: string): boolean {
  const t = token.replace(/\*+$/g, "").trim();
  if (t.length < 4 || t.length > 28) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(t)) return false;
  if (/^\d+\.\d+$/.test(t)) return false;
  if (/^various$/i.test(t)) return false;
  if (/\d/.test(t)) return true;
  // Molding codes such as CBLFTECARDEN are all capitals and have no digit.
  return t.length >= 8 && t === t.toUpperCase();
}

function pretty(raw: string): string {
  const s = raw.replace(/\*+$/g, "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (s === s.toUpperCase() && /^[A-Z0-9]{2,4}$/.test(s) && (s.match(/[AEIOU]/g)?.length ?? 0) < 2) {
    return s;
  }
  if (s === s.toUpperCase() && /[A-Z]/.test(s) && /[A-Z]{2,}/.test(s)) {
    return s
      .toLowerCase()
      .replace(/(^|[^a-z0-9'])([a-z])/g, (_, lead: string, ch: string) => lead + ch.toUpperCase());
  }
  return s;
}

function productTitle(manufacturer: string, family: string, color: string, piece = ""): string {
  let fam = family.trim();
  if (fam.toLowerCase() === manufacturer.toLowerCase()) fam = "";
  else if (fam.toLowerCase().startsWith(`${manufacturer.toLowerCase()} `)) {
    fam = fam.slice(manufacturer.length).trim();
  }
  return [manufacturer, fam, color, piece].filter(Boolean).join(" ").replace(/\s+/g, " ");
}

function profileOf(label: string): { profile: string; length: string } | null {
  const length = label.match(/(\d+(?:\.\d+)?)\s*"/)?.[1];
  const len = length ? `${length}"` : "";
  if (/end\s*cap|threshold|square\s*nose/i.test(label)) return { profile: "End Cap", length: len };
  if (/flush\s*(mount\s*)?stair/i.test(label)) return { profile: "Flush Stair Nose", length: len };
  if (/overlap\s*stair/i.test(label)) return { profile: "Overlap Stair Nose", length: len };
  if (/stair\s*kit/i.test(label)) return { profile: "Stair Kit", length: len };
  if (/quarter\s*round/i.test(label)) return { profile: "Quarter Round", length: len };
  if (/t-?\s*mold/i.test(label)) return { profile: "T-Molding", length: len };
  if (/reducer/i.test(label)) return { profile: "Reducer", length: len };
  if (/stair\s*nose/i.test(label)) return { profile: "Stair Nose", length: len };
  return null;
}

function looksLike(pages: RlTextItem[][]): boolean {
  const blob = pages
    .flat()
    .map((it) => it.str)
    .join(" ");
  if (/allsurfaces\.com|alltile\.com/i.test(blob) && /price list/i.test(blob)) return true;
  if (/rl price list/i.test(blob)) return true;
  if (/tactical price list/i.test(blob) && /life\s*core/i.test(blob)) return true;
  if (/\bAquaproof\b/.test(blob) && /PRICE LIST/.test(blob) && /Item #/.test(blob)) return true;
  return false;
}

function manufacturerOf(blob: string): string {
  if (/\bAquaproof\b/.test(blob)) return "Aquaproof";
  if (/Casabella|Firmfit/i.test(blob)) return "Casabella";
  if (/Congoleum|Triversa Prime/i.test(blob)) return "Congoleum";
  if (/Contract 180/i.test(blob)) return "Contract 180";
  if (/Life\s*Core/i.test(blob)) return "LifeCore";
  return DISTRIBUTOR;
}

function effectiveOf(blob: string): string {
  const m = blob.match(/Effective(?:\s+Date)?:?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

function categoryOf(desc: string): { category: string; unit: string } {
  const d = desc.toLowerCase();
  if (/carpet/.test(d)) return { category: "carpet", unit: "sqyd" };
  if (/engineered|tongue\s*&\s*groove|hardwood/.test(d)) return { category: "hardwood", unit: "sqft" };
  if (/laminate/.test(d)) return { category: "laminate", unit: "sqft" };
  return { category: "lvp", unit: "sqft" };
}

function familyLabel(raw: string): string {
  const text = pretty(raw);
  const code = text.match(/^([A-Z]{2,4})\s+-\s+/);
  if (code) return code[1];
  return text;
}

function isFamily(band: Band): { name: string; desc: string } | null {
  const left = band.items[0];
  if (!left) return null;
  const name = left.str.trim();
  if (!name || name.length > 48 || HEADER_WORD.test(name) || NOISE_LINE.test(name)) return null;
  if (money(name) != null || skuLike(name)) return null;
  if (/collection$/i.test(name)) return null;
  const desc = band.items
    .slice(1)
    .map((it) => it.str)
    .join(" ");
  if (
    !/(waterproof|wear|plank|tongue|engineered|carpet|terrazzo|terrazo|koncrete|mil\b|mm\b|backing|stone shield|pad thickness)/i.test(
      desc,
    )
  ) {
    return null;
  }
  return { name, desc };
}

function isSection(line: string): "accessory" | "stop" | null {
  if (/^(accessories|displays|vinyl tile adhesives|vinyl tile accessories|underlayment|mapei adhesives|recommended adhesives|transitions|resilient tile all-in-one)/i.test(line)) {
    return "accessory";
  }
  if (/^(stair systems|molding profiles)/i.test(line)) return "stop";
  return null;
}

function unitFromHeader(line: string, fallback: string): string {
  if (/price\s*\/\s*sy|price per sy/i.test(line)) return "sqyd";
  if (/price\s*\/\s*sf|price per sf/i.test(line)) return "sqft";
  return fallback;
}

function trimColumns(band: Band, prev: Band[]): TrimCol[] {
  const prices = band.items
    .map((it) => ({ x: it.x, price: money(it.str) }))
    .filter((it): it is { x: number; price: number } => it.price != null);
  if (prices.length < 2) return [];
  const labels = [band, ...prev.slice(0, 3)]
    .flatMap((b) => b.items)
    .map((it) => ({ x: it.x, parsed: profileOf(it.str) }))
    .filter((it): it is { x: number; parsed: { profile: string; length: string } } => it.parsed != null);
  if (!labels.length) return [];
  const used = new Set<number>();
  const cols: TrimCol[] = [];
  for (const price of prices) {
    let best = -1;
    let dist = 42;
    labels.forEach((label, index) => {
      if (used.has(index)) return;
      const d = Math.abs(label.x - price.x);
      if (d < dist) {
        dist = d;
        best = index;
      }
    });
    if (best < 0) continue;
    used.add(best);
    cols.push({
      profile: labels[best].parsed.profile,
      length: labels[best].parsed.length,
      price: price.price,
      x: price.x,
    });
  }
  return cols;
}

function sizeToken(band: Band): string | null {
  const hit = band.items.find((it) => /\d/.test(it.str) && /\bx\b/i.test(it.str) && !/\$/.test(it.str));
  return hit?.str ?? null;
}

function coverNote(line: string, width: string): string {
  const specific = [...line.matchAll(/(\d+)\s*([½¼])?\s*"?\s*:\s*([\d,.]+)\s*sf\s*\/\s*ctn/gi)];
  if (specific.length) {
    const want = width.replace(/["\s]/g, "");
    for (const m of specific) {
      const label = `${m[1]}${m[2] ?? ""}`;
      if (want.startsWith(label) || want.includes(label)) return `${m[3].replace(/,/g, "")} sf/ctn`;
    }
    return `${specific[0][3].replace(/,/g, "")} sf/ctn`;
  }
  const sf = line.match(/([\d,.]+)\s*SF\s*\/\s*ctn/i) ?? line.match(/([\d,.]+)\s*sf per ctn/i);
  if (sf) return `${sf[1].replace(/,/g, "")} SF/ctn`;
  const sy = line.match(/([\d,.]+)\s*sy per ctn/i);
  if (sy) return `${sy[1].replace(/,/g, "")} sy/ctn`;
  return "";
}

function withMaker(manufacturer: string, name: string): string {
  const clean = name.replace(/™/g, "").replace(/\s+/g, " ").trim();
  if (clean.toLowerCase().startsWith(manufacturer.toLowerCase())) return clean;
  return `${manufacturer} ${clean}`.replace(/\s+/g, " ");
}

function leftTitle(band: Band, sku?: RlTextItem): string {
  const item = band.items.find(
    (it) =>
      it !== sku &&
      it.x < 130 &&
      money(it.str) == null &&
      !HEADER_WORD.test(it.str) &&
      !/^\d+(\.\d+)?$/.test(it.str),
  );
  return item?.str.replace(/\s+/g, " ").trim() ?? "";
}

function detailText(band: Band, sku: RlTextItem | undefined, title: string): string {
  return band.items
    .filter(
      (it) =>
        it !== sku &&
        it.str !== title &&
        it.x >= 130 &&
        money(it.str) == null &&
        !HEADER_WORD.test(it.str) &&
        !/^\d+$/.test(it.str),
    )
    .map((it) => it.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeBlurb(name: string): boolean {
  return name.length > 42 || /-$/.test(name) || /^(use with|for |made |allows |adhesive,)/i.test(name);
}

function earlierTitle(bands: Band[], index: number): string {
  for (let k = index - 1; k >= Math.max(0, index - 5); k--) {
    if (bands[k].items.some((it) => money(it.str) != null)) break;
    if (isSection(text(bands[k]))) continue;
    const title = leftTitle(bands[k]);
    if (!title || NOISE_LINE.test(title) || looksLikeBlurb(title) || isSection(title)) continue;
    return title;
  }
  return "";
}

function sectionBlob(bands: Band[], index: number): string {
  return bands
    .slice(Math.max(0, index - 6), index + 1)
    .map((band) => text(band))
    .join(" ");
}

function noteJoin(parts: (string | null | undefined)[]): string {
  return parts
    .map((p) => (p ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(". ")
    .replace(/\s+\./g, ".");
}

export function parseAllSurfacesRlPriceList(pages: RlTextItem[][]): RlPriceBook | null {
  if (!looksLike(pages)) return null;
  const blob = pages
    .flat()
    .map((it) => it.str)
    .join(" ");
  const manufacturer = manufacturerOf(blob);
  const effective = effectiveOf(blob);
  const draft: Draft[] = [];

  let family = "";
  let familyDesc = "";
  let category = "lvp";
  let unit = "sqft";
  let group = "";
  let width = "";
  let trims: TrimCol[] = [];
  let mode: "floor" | "accessory" | "stop" = "floor";
  let chunkStart = 0;

  const push = (row: Draft) => {
    draft.push(row);
  };

  for (const page of pages) {
    const bands = bandsOf(page);
    for (let i = 0; i < bands.length; i++) {
      const band = bands[i];
      const line = text(band);
      if (!line) continue;

      const section = isSection(line);
      if (section === "accessory") {
        mode = "accessory";
        trims = [];
        continue;
      }
      if (section === "stop") {
        mode = "stop";
        trims = [];
        continue;
      }
      if (NOISE_LINE.test(line) && !/^packaging:/i.test(line)) continue;

      if (/^packaging:/i.test(line)) {
        const cov = coverNote(line, "");
        if (cov) {
          for (let k = chunkStart; k < draft.length; k++) {
            if (draft[k].kind !== "floor") continue;
            const specific = coverNote(line, draft[k].width);
            if (!draft[k].notes?.includes("ctn")) {
              draft[k].notes = noteJoin([draft[k].notes, specific || cov]);
            }
          }
        }
        continue;
      }

      if (
        /collection$/i.test(band.items[0]?.str ?? "") &&
        !band.items.some((it) => money(it.str) != null)
      ) {
        group = pretty(band.items[0].str);
        continue;
      }

      if (/x\s*RL\b/i.test(line) && !band.items.some((it) => money(it.str) != null)) {
        width = line;
        continue;
      }

      const fam = isFamily(band);
      if (fam && mode !== "accessory") {
        family = familyLabel(fam.name);
        familyDesc = fam.desc.replace(/\s+/g, " ").trim();
        const cat = categoryOf(`${fam.name} ${familyDesc}`);
        category = cat.category;
        unit = cat.unit;
        group = "";
        width = "";
        trims = [];
        mode = "floor";
        chunkStart = draft.length;
        continue;
      }

      if (/engineered/i.test(line) && mode === "floor" && !band.items.some((it) => money(it.str) != null)) {
        category = "hardwood";
        unit = "sqft";
        continue;
      }

      const headerUnit = unitFromHeader(line, unit);
      if (/price\s*\/\s*s[fy]|price per sf/i.test(line)) unit = headerUnit;

      const cols = mode === "floor" ? trimColumns(band, bands.slice(Math.max(0, i - 3), i).reverse()) : [];
      if (cols.length >= 2) {
        trims = cols;
        continue;
      }

      const prices = band.items
        .map((it) => ({ x: it.x, token: it.str, price: money(it.str) }))
        .filter((it): it is { x: number; token: string; price: number } => it.price != null);

      if (mode === "floor" && family && prices.length >= 2 && sizeToken(band)) {
        const size = sizeToken(band)!.replace(/^(\d+)\s+x\b/i, '$1" x');
        const ordered = [...prices].sort((a, b) => a.x - b.x);
        const retail = ordered[0].price;
        const display = ordered[1]?.price;
        const coverage = band.items.find((it) => /^\d+\.\d+$/.test(it.str) && it.x > ordered[0].x)?.str;
        push({
          kind: "floor",
          width: "",
          name: productTitle(manufacturer, family, size),
          category,
          unit,
          sku: null,
          material_rate: retail,
          roll_rate: null,
          labor_rate: null,
          manufacturer,
          style: family,
          color: null,
          notes: noteJoin([
            `${manufacturer} RL price list effective ${effective}`,
            familyDesc,
            `Retail $${retail.toFixed(2)}`,
            display != null ? `Display $${display.toFixed(2)}` : "",
            coverage ? `${coverage} SF/ctn` : "",
          ]),
        });
        continue;
      }

      if (prices.length !== 1) {
        if (mode === "accessory" && prices.length === 2) {
          const ordered = [...prices].sort((a, b) => a.x - b.x);
          const sku = band.items.find((it) => skuLike(it.str));
          const title = leftTitle(band, sku);
          const detail = detailText(band, sku, title);
          const cut = ordered[0].price;
          const roll = ordered[1].price;
          if (title) {
            push({
              kind: "other",
              width: "",
              name: withMaker(manufacturer, title),
              category: "underlayment",
              unit: "sqyd",
              sku: sku ? sku.str.replace(/\*+$/g, "") : null,
              material_rate: Math.max(cut, roll),
              roll_rate: Math.min(cut, roll),
              labor_rate: null,
              manufacturer,
              style: title,
              color: null,
              notes: noteJoin([
                `${manufacturer} RL price list effective ${effective}`,
                detail,
                `Cut $${Math.max(cut, roll).toFixed(2)} / SY`,
                `Roll $${Math.min(cut, roll).toFixed(2)} / SY`,
              ]),
            });
          }
        }
        continue;
      }

      const price = prices[0];
      const skuItem = [...band.items]
        .filter((it) => it.x < price.x - 8 && skuLike(it.str))
        .sort((a, b) => b.x - a.x)[0];

      if (mode === "floor" && family && skuItem && price.x < (trims[0]?.x ?? 320) - 8) {
        const left = band.items.filter((it) => it.x < skuItem.x - 4 && money(it.str) == null && !HEADER_WORD.test(it.str));
        const color = pretty(left[0]?.str ?? "");
        if (!color || HEADER_WORD.test(color)) continue;
        const species = left[1]?.str ?? "";
        const visual = left
          .slice(2)
          .map((it) => it.str)
          .join(" ");
        const special = /\*/.test(left[0]?.str ?? "") || /\*/.test(skuItem.str);
        const starredNote = special ? "Special order" : "";
        const baseName = productTitle(manufacturer, family, color);
        push({
          kind: "floor",
          width,
          name: baseName,
          category,
          unit,
          sku: skuItem.str.replace(/\*+$/g, ""),
          material_rate: price.price,
          roll_rate: null,
          labor_rate: null,
          manufacturer,
          style: family,
          color,
          notes: noteJoin([
            `${manufacturer} RL price list effective ${effective}`,
            group,
            familyDesc,
            width,
            species,
            visual,
            starredNote,
          ]),
        });

        const trimSkus = band.items.filter((it) => it.x > price.x + 12 && skuLike(it.str));
        const used = new Set<number>();
        for (const col of trims) {
          let best = -1;
          let dist = 56;
          trimSkus.forEach((it, index) => {
            if (used.has(index)) return;
            const d = Math.abs(it.x - col.x);
            if (d < dist) {
              dist = d;
              best = index;
            }
          });
          if (best < 0) continue;
          used.add(best);
          const code = trimSkus[best].str.replace(/\*+$/g, "");
          push({
            kind: "trim",
            width: "",
            name: productTitle(manufacturer, family, color, col.profile),
            category: "trim",
            unit: "each",
            sku: code,
            material_rate: col.price,
            roll_rate: null,
            labor_rate: null,
            manufacturer,
            style: family,
            color,
            notes: noteJoin([
              `${manufacturer} RL price list effective ${effective}`,
              col.length ? `${col.length} length` : "",
              col.profile === "Stair Kit" ? "Coordinates with the flooring. Color may vary from the trim" : "",
            ]),
          });
        }
        continue;
      }

      if (mode === "accessory" || (mode === "floor" && price.x > 430 && !family)) {
        if (/contact sales/i.test(line)) continue;
        const sku = band.items.find((it) => skuLike(it.str) && Math.abs(it.x - price.x) > 20);
        const size = band.items.find(
          (it) =>
            it !== sku &&
            money(it.str) == null &&
            it.str.length <= 32 &&
            /^\d/.test(it.str) &&
            /("|gal|oz|quart|roll|tube)/i.test(it.str),
        )?.str;
        let name = leftTitle(band, sku);
        if (looksLikeBlurb(name)) {
          const earlier = earlierTitle(bands, i);
          if (earlier) {
            name = /adhesive/i.test(name) && !/adhesive/i.test(earlier) ? `${earlier} Adhesive` : earlier;
          }
        }
        if (!name) {
          const earlier = earlierTitle(bands, i);
          name = earlier || (sku ? sku.str.replace(/\*+$/g, "") : "");
          if (/adhesive/i.test(sectionBlob(bands, i)) && name && !/adhesive/i.test(name)) {
            name = `${name} Adhesive`;
          }
        }
        if (!name && size) {
          const prev = [...draft].reverse().find((row) => row.kind !== "floor");
          const base = prev?.name.replace(new RegExp(`^${manufacturer}\\s+`, "i"), "").replace(/\s+\d.*$/, "") ?? "";
          if (base) name = `${base} ${size}`;
        }
        if (size && name && !name.toLowerCase().includes(size.toLowerCase())) name = `${name} ${size}`;
        const follow = bands[i + 1];
        if (
          follow &&
          !follow.items.some((it) => money(it.str) != null) &&
          /^underlayment$/i.test(leftTitle(follow))
        ) {
          name = `${name} Underlayment`;
        }
        name = name.replace(/™/g, "").replace(/\s+/g, " ").trim();
        if (!name || HEADER_WORD.test(name)) continue;
        const accessoryCategory = /underlay|vapor|scuba/i.test(name)
          ? "underlayment"
          : /multi-trim|stair nose|quarter round|threshold|reducer|end cap|t-mold/i.test(name)
            ? "trim"
            : "other";
        push({
          kind: "other",
          width: "",
          name: withMaker(manufacturer, name),
          category: accessoryCategory,
          unit: "each",
          sku: sku && !/^various$/i.test(sku.str) ? sku.str.replace(/\*+$/g, "") : null,
          material_rate: price.price,
          roll_rate: null,
          labor_rate: null,
          manufacturer,
          style: name,
          color: null,
          notes: noteJoin([
            `${manufacturer} RL price list effective ${effective}`,
            detailText(band, sku, leftTitle(band, sku)),
            size && !detailText(band, sku, leftTitle(band, sku)).includes(size) ? size : "",
            /various/i.test(sku?.str ?? "") ? "Item number varies" : "",
          ]),
        });
      }
    }
  }

  if (draft.length < 3) return null;

  const counts = new Map<string, number>();
  for (const row of draft) {
    const key = row.name.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const rows: PriceRow[] = draft.map((row) => {
    const dup = (counts.get(row.name.toLowerCase()) ?? 0) > 1;
    const name = dup && row.sku ? `${row.name} (${row.sku})` : row.name;
    return {
      name,
      category: row.category,
      unit: row.unit,
      sku: row.sku,
      material_rate: row.material_rate,
      roll_rate: row.roll_rate,
      labor_rate: null,
      manufacturer: row.manufacturer,
      style: row.style,
      color: row.color,
      notes: row.notes,
    };
  });

  return { rows, distributor: DISTRIBUTOR, manufacturer, effective };
}
