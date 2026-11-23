import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDocumentProxy } from "unpdf";
import { parseAllSurfacesRlPriceList, type RlTextItem } from "@/lib/all-surfaces-rl-price";
import { pdfJsItems } from "@/lib/pdf-layout";

async function pages(file: string): Promise<RlTextItem[][]> {
  const pdf = await getDocumentProxy(new Uint8Array(readFileSync(file)));
  const out: RlTextItem[][] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    out.push(
      pdfJsItems(
        content.items as { str?: string; transform?: number[]; width?: number; height?: number }[],
      ).map((it) => ({ str: it.str, x: it.x, y: it.y })),
    );
  }
  return out;
}

const files = [
  "tests/golden/fixtures/aquaproof-rl-2026-10-15.pdf",
  "tests/golden/fixtures/casabella-firmfit-rl-2026-03-02.pdf",
  "tests/golden/fixtures/congoleum-triversa-prime-rl-2025-10-15.pdf",
  "tests/golden/fixtures/contract-180-rl-2025-11-01.pdf",
  "tests/golden/fixtures/lifecore-tactical-2026-01-15.pdf",
];

const rows = [];
for (const file of files) {
  const book = parseAllSurfacesRlPriceList(await pages(join(process.cwd(), file)));
  if (!book) throw new Error(`No rows in ${file}`);
  for (const row of book.rows) {
    rows.push({
      name: row.name,
      category: row.category,
      unit: row.unit,
      sku: row.sku,
      material_rate: row.material_rate,
      roll_rate: row.roll_rate ?? null,
      style: row.style ?? null,
      color: row.color ?? null,
      manufacturer: row.manufacturer ?? book.manufacturer,
      notes: row.notes,
    });
  }
}

const body = `-- Floor King — All Surfaces RL price lists.
-- Aquaproof effective October 15, 2026.
-- Casabella Firmfit effective March 2, 2026.
-- Congoleum Triversa Prime effective October 15, 2025. Retail is the cost.
-- Contract 180 effective November 01, 2025.
-- LifeCore Tactical effective January 15, 2026.
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- These are our costs. The printed Price, Price/SF, or Price/SY is the
-- catalog cost. Trim is priced each. Underflor keeps the cut as the cost
-- and the lower full-roll price on roll_rate. A product with the same name
-- from this manufacturer, or with no manufacturer yet, is updated. The same
-- name from another mill is left alone.

do $$
declare
  r record;
  existing_id uuid;
  existing_mfr text;
  use_name text;
begin
  for r in
    select * from jsonb_to_recordset($rl$
${JSON.stringify(rows, null, 2)}
$rl$::jsonb) as x(
      name text,
      category text,
      unit text,
      sku text,
      material_rate numeric,
      roll_rate numeric,
      style text,
      color text,
      manufacturer text,
      notes text
    )
  loop
    use_name := r.name;
    existing_id := null;
    existing_mfr := null;
    select p.id, p.manufacturer into existing_id, existing_mfr
      from public.products p
      where lower(p.name) = lower(use_name)
      order by case
        when p.manufacturer ilike '%' || r.manufacturer || '%' then 0
        when coalesce(p.manufacturer, '') = '' then 1
        else 2
      end
      limit 1;

    if existing_id is not null
       and coalesce(existing_mfr, '') <> ''
       and existing_mfr not ilike '%' || r.manufacturer || '%' then
      use_name := r.name || ' (' || coalesce(r.sku, r.manufacturer) || ')';
      existing_id := null;
      existing_mfr := null;
      select p.id, p.manufacturer into existing_id, existing_mfr
        from public.products p
        where lower(p.name) = lower(use_name)
        limit 1;
    end if;

    if existing_id is not null
       and (coalesce(existing_mfr, '') = '' or existing_mfr ilike '%' || r.manufacturer || '%') then
      update public.products set
        material_rate = r.material_rate,
        roll_rate = r.roll_rate,
        unit = r.unit,
        category = r.category::public.product_category,
        sku = r.sku,
        manufacturer = r.manufacturer,
        supplier = case
          when coalesce(supplier, '') = '' or supplier ilike '%all surfaces%' then 'All Surfaces'
          else supplier
        end,
        style = r.style,
        color = r.color,
        notes = r.notes,
        active = true
      where id = existing_id;
    elsif existing_id is null then
      insert into public.products
        (name, category, unit, material_rate, roll_rate, sku, manufacturer, supplier, style, color, notes, active)
      values (
        use_name,
        r.category::public.product_category,
        r.unit,
        r.material_rate,
        r.roll_rate,
        r.sku,
        r.manufacturer,
        'All Surfaces',
        r.style,
        r.color,
        r.notes,
        true
      );
    end if;
  end loop;
end $$;
`;

writeFileSync("supabase/migrations/0518_all_surfaces_rl_prices.sql", body);
console.log(`Wrote ${rows.length} products`);
