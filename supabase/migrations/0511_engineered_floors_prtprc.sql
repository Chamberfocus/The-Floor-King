-- Floor King — Engineered Floors price list effective 11/16/2026 (PRTPRC).
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- These are our costs. Carpet material_rate is the cut price, and roll_rate
-- keeps the full-roll STD price when it is lower. Hard surface material_rate
-- is the carton (STD) price. Trim is priced each, as the sheet prints it.
-- A product with the same name from Engineered Floors, or with no manufacturer
-- yet, is updated. A same name from another mill is left alone.

alter table public.products
  add column if not exists roll_rate numeric;

grant select (roll_rate) on public.products to authenticated;

do $$
declare
  r record;
  existing_id uuid;
  existing_mfr text;
  use_name text;
begin
  for r in
    select * from jsonb_to_recordset($ef$
[
  {
    "name": "Abstract Modular 24x24",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7915T",
    "material_rate": 15.09,
    "roll_rate": null,
    "style": "Abstract Modular",
    "notes": "Style 7915T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $15.09. Cut $15.09."
  },
  {
    "name": "Acclaim 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "1324",
    "material_rate": 7.33,
    "roll_rate": 6.33,
    "style": "Acclaim",
    "notes": "Style 1324. Engineered Floors price list effective 11/16/2026. STD $6.33. Cut $7.33."
  },
  {
    "name": "Advantage 2x94 End Cap",
    "category": "trim",
    "unit": "each",
    "sku": "W020",
    "material_rate": 27,
    "roll_rate": null,
    "style": "Advantage",
    "notes": "Style W020. Engineered Floors price list effective 11/16/2026. Price $27.00."
  },
  {
    "name": "Advantage 7\" x 48\" Floating",
    "category": "lvp",
    "unit": "sqft",
    "sku": "W020",
    "material_rate": 2.79,
    "roll_rate": null,
    "style": "Advantage",
    "notes": "Style W020. Engineered Floors price list effective 11/16/2026. STD $2.79. Cut $2.79."
  },
  {
    "name": "Advantage 4x94 Flush Stair Nose",
    "category": "trim",
    "unit": "each",
    "sku": "W020",
    "material_rate": 38,
    "roll_rate": null,
    "style": "Advantage",
    "notes": "Style W020. Engineered Floors price list effective 11/16/2026. Price $38.00."
  },
  {
    "name": "Advantage 2x94 Overlap Stair Nose",
    "category": "trim",
    "unit": "each",
    "sku": "W020",
    "material_rate": 27,
    "roll_rate": null,
    "style": "Advantage",
    "notes": "Style W020. Engineered Floors price list effective 11/16/2026. Price $27.00."
  },
  {
    "name": "Advantage 1x94 Quarter",
    "category": "trim",
    "unit": "each",
    "sku": "W020",
    "material_rate": 17,
    "roll_rate": null,
    "style": "Advantage",
    "notes": "Style W020. Engineered Floors price list effective 11/16/2026. Price $17.00."
  },
  {
    "name": "Advantage 2x94 Reducer",
    "category": "trim",
    "unit": "each",
    "sku": "W020",
    "material_rate": 27,
    "roll_rate": null,
    "style": "Advantage",
    "notes": "Style W020. Engineered Floors price list effective 11/16/2026. Price $27.00."
  },
  {
    "name": "Advantage 2x94 T Mold",
    "category": "trim",
    "unit": "each",
    "sku": "W020",
    "material_rate": 27,
    "roll_rate": null,
    "style": "Advantage",
    "notes": "Style W020. Engineered Floors price list effective 11/16/2026. Price $27.00."
  },
  {
    "name": "Advantage 12x50 Stair Treads",
    "category": "trim",
    "unit": "each",
    "sku": "W020",
    "material_rate": 108,
    "roll_rate": null,
    "style": "Advantage",
    "notes": "Style W020. Engineered Floors price list effective 11/16/2026. Price $108.00."
  },
  {
    "name": "Affinity I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "6342",
    "material_rate": 13.36,
    "roll_rate": 12.26,
    "style": "Affinity I",
    "notes": "Style 6342. Engineered Floors price list effective 11/16/2026. STD $12.26. Cut $13.36."
  },
  {
    "name": "Affinity II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "6362",
    "material_rate": 16.13,
    "roll_rate": 15.03,
    "style": "Affinity II",
    "notes": "Style 6362. Engineered Floors price list effective 11/16/2026. STD $15.03. Cut $16.13."
  },
  {
    "name": "Affinity III 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "6376",
    "material_rate": 18.68,
    "roll_rate": 17.58,
    "style": "Affinity III",
    "notes": "Style 6376. Engineered Floors price list effective 11/16/2026. STD $17.58. Cut $18.68."
  },
  {
    "name": "Affinity IV 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "6392",
    "material_rate": 21.35,
    "roll_rate": 20.35,
    "style": "Affinity IV",
    "notes": "Style 6392. Engineered Floors price list effective 11/16/2026. STD $20.35. Cut $21.35."
  },
  {
    "name": "Airwaves 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "E100",
    "material_rate": 6.1,
    "roll_rate": null,
    "style": "Airwaves",
    "notes": "Style E100. Engineered Floors price list effective 11/16/2026. Price $6.10."
  },
  {
    "name": "Airwaves Plus 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "E164",
    "material_rate": 6.1,
    "roll_rate": null,
    "style": "Airwaves Plus",
    "notes": "Style E164. Engineered Floors price list effective 11/16/2026. Price $6.10."
  },
  {
    "name": "Amalfi 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4235",
    "material_rate": 12.68,
    "roll_rate": 11.68,
    "style": "Amalfi",
    "notes": "Style 4235. Engineered Floors price list effective 11/16/2026. STD $11.68. Cut $12.68."
  },
  {
    "name": "Amplify Plank 12x48",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7053P",
    "material_rate": 17.19,
    "roll_rate": null,
    "style": "Amplify Plank",
    "notes": "Style 7053P. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $17.19. Cut $17.19."
  },
  {
    "name": "Amplify Tile 24x24",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7053T",
    "material_rate": 16.09,
    "roll_rate": null,
    "style": "Amplify Tile",
    "notes": "Style 7053T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $16.09. Cut $16.09."
  },
  {
    "name": "Animated 24x24 Mod Tile",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7040T",
    "material_rate": 17.19,
    "roll_rate": null,
    "style": "Animated",
    "notes": "Style 7040T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $17.19. Cut $17.19."
  },
  {
    "name": "Art Deco Modular 24x24",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7917T",
    "material_rate": 11.39,
    "roll_rate": null,
    "style": "Art Deco Modular",
    "notes": "Style 7917T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $11.39. Cut $11.39."
  },
  {
    "name": "Astounding I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "2530",
    "material_rate": 10.7,
    "roll_rate": 9.6,
    "style": "Astounding I",
    "notes": "Style 2530. Engineered Floors price list effective 11/16/2026. STD $9.60. Cut $10.70."
  },
  {
    "name": "Astounding II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "2545",
    "material_rate": 13.96,
    "roll_rate": 12.86,
    "style": "Astounding II",
    "notes": "Style 2545. Engineered Floors price list effective 11/16/2026. STD $12.86. Cut $13.96."
  },
  {
    "name": "Astounding III 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "2565",
    "material_rate": 17.33,
    "roll_rate": 16.33,
    "style": "Astounding III",
    "notes": "Style 2565. Engineered Floors price list effective 11/16/2026. STD $16.33. Cut $17.33."
  },
  {
    "name": "Autumn Glow I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "6245",
    "material_rate": 13.66,
    "roll_rate": 12.56,
    "style": "Autumn Glow I",
    "notes": "Style 6245. Engineered Floors price list effective 11/16/2026. STD $12.56. Cut $13.66."
  },
  {
    "name": "Autumn Glow II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "6255",
    "material_rate": 15.14,
    "roll_rate": 14.14,
    "style": "Autumn Glow II",
    "notes": "Style 6255. Engineered Floors price list effective 11/16/2026. STD $14.14. Cut $15.14."
  },
  {
    "name": "Autumn Glow III 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "6265",
    "material_rate": 17.21,
    "roll_rate": 16.21,
    "style": "Autumn Glow III",
    "notes": "Style 6265. Engineered Floors price list effective 11/16/2026. STD $16.21. Cut $17.21."
  },
  {
    "name": "Avenue 7\" x 48\" Dry Back",
    "category": "lvp",
    "unit": "sqft",
    "sku": "P1000",
    "material_rate": 1.45,
    "roll_rate": null,
    "style": "Avenue",
    "notes": "Style P1000. Engineered Floors price list effective 11/16/2026. STD $1.45. Cut $1.77."
  },
  {
    "name": "Avenue 7\" x 48\" Lux Vinyl",
    "category": "lvp",
    "unit": "sqft",
    "sku": "P1000",
    "material_rate": 1.45,
    "roll_rate": null,
    "style": "Avenue",
    "notes": "Style P1000. Engineered Floors price list effective 11/16/2026. STD $1.45. Cut $1.77."
  },
  {
    "name": "Beach Club I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "1325",
    "material_rate": 7.33,
    "roll_rate": 6.33,
    "style": "Beach Club I",
    "notes": "Style 1325. Engineered Floors price list effective 11/16/2026. STD $6.33. Cut $7.33."
  },
  {
    "name": "Beach Club II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "1430",
    "material_rate": 8.8,
    "roll_rate": 7.7,
    "style": "Beach Club II",
    "notes": "Style 1430. Engineered Floors price list effective 11/16/2026. STD $7.70. Cut $8.80."
  },
  {
    "name": "Beach Club III 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "1540",
    "material_rate": 10.38,
    "roll_rate": 9.38,
    "style": "Beach Club III",
    "notes": "Style 1540. Engineered Floors price list effective 11/16/2026. STD $9.38. Cut $10.38."
  },
  {
    "name": "Bespoke Plank 12x48",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7616T",
    "material_rate": 16.09,
    "roll_rate": null,
    "style": "Bespoke Plank",
    "notes": "Style 7616T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $16.09. Cut $16.09."
  },
  {
    "name": "Bespoke Tile 24x24",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7616D",
    "material_rate": 15.09,
    "roll_rate": null,
    "style": "Bespoke Tile",
    "notes": "Style 7616D. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $15.09. Cut $15.09."
  },
  {
    "name": "Best Offer 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "E178",
    "material_rate": 5.32,
    "roll_rate": null,
    "style": "Best Offer",
    "notes": "Style E178. Engineered Floors price list effective 11/16/2026. Price $5.32."
  },
  {
    "name": "Blazer I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "6340",
    "material_rate": 12.28,
    "roll_rate": 11.28,
    "style": "Blazer I",
    "notes": "Style 6340. Engineered Floors price list effective 11/16/2026. STD $11.28. Cut $12.28."
  },
  {
    "name": "Blazer II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "6360",
    "material_rate": 16.33,
    "roll_rate": 15.23,
    "style": "Blazer II",
    "notes": "Style 6360. Engineered Floors price list effective 11/16/2026. STD $15.23. Cut $16.33."
  },
  {
    "name": "Blazer III 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "6375",
    "material_rate": 18.88,
    "roll_rate": 17.78,
    "style": "Blazer III",
    "notes": "Style 6375. Engineered Floors price list effective 11/16/2026. STD $17.78. Cut $18.88."
  },
  {
    "name": "Blockade 24x24 Mod Tile",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7039T",
    "material_rate": 15.59,
    "roll_rate": null,
    "style": "Blockade",
    "notes": "Style 7039T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $15.59. Cut $15.59."
  },
  {
    "name": "Boulevard 7\" x 48\" Dry Back",
    "category": "lvp",
    "unit": "sqft",
    "sku": "P1001",
    "material_rate": 1.71,
    "roll_rate": null,
    "style": "Boulevard",
    "notes": "Style P1001. Engineered Floors price list effective 11/16/2026. STD $1.71. Cut $2.03."
  },
  {
    "name": "Boulevard 7\" x 48\" Lux Vinyl",
    "category": "lvp",
    "unit": "sqft",
    "sku": "P1001",
    "material_rate": 1.71,
    "roll_rate": null,
    "style": "Boulevard",
    "notes": "Style P1001. Engineered Floors price list effective 11/16/2026. STD $1.71. Cut $2.03."
  },
  {
    "name": "Brazen I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "6240",
    "material_rate": 12.28,
    "roll_rate": 11.28,
    "style": "Brazen I",
    "notes": "Style 6240. Engineered Floors price list effective 11/16/2026. STD $11.28. Cut $12.28."
  },
  {
    "name": "Brazen II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "6260",
    "material_rate": 16.33,
    "roll_rate": 15.23,
    "style": "Brazen II",
    "notes": "Style 6260. Engineered Floors price list effective 11/16/2026. STD $15.23. Cut $16.33."
  },
  {
    "name": "Breakview I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4940",
    "material_rate": 10.78,
    "roll_rate": 9.68,
    "style": "Breakview I",
    "notes": "Style 4940. Engineered Floors price list effective 11/16/2026. STD $9.68. Cut $10.78."
  },
  {
    "name": "Breakview II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4950",
    "material_rate": 12.66,
    "roll_rate": 11.66,
    "style": "Breakview II",
    "notes": "Style 4950. Engineered Floors price list effective 11/16/2026. STD $11.66. Cut $12.66."
  },
  {
    "name": "Breakview III 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4960",
    "material_rate": 14.43,
    "roll_rate": 13.43,
    "style": "Breakview III",
    "notes": "Style 4960. Engineered Floors price list effective 11/16/2026. STD $13.43. Cut $14.43."
  },
  {
    "name": "Broadcast 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3025",
    "material_rate": 7.33,
    "roll_rate": 6.33,
    "style": "Broadcast",
    "notes": "Style 3025. Engineered Floors price list effective 11/16/2026. STD $6.33. Cut $7.33."
  },
  {
    "name": "Broadcast Plus 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3125",
    "material_rate": 7.33,
    "roll_rate": 6.33,
    "style": "Broadcast Plus",
    "notes": "Style 3125. Engineered Floors price list effective 11/16/2026. STD $6.33. Cut $7.33."
  },
  {
    "name": "Cabled Plank 12x48",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7082P",
    "material_rate": 12.69,
    "roll_rate": null,
    "style": "Cabled Plank",
    "notes": "Style 7082P. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $12.69. Cut $12.69."
  },
  {
    "name": "Cabled Tile 24x24",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7082T",
    "material_rate": 11.39,
    "roll_rate": null,
    "style": "Cabled Tile",
    "notes": "Style 7082T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $11.39. Cut $11.39."
  },
  {
    "name": "Cant Miss 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4748",
    "material_rate": 13.66,
    "roll_rate": 12.56,
    "style": "Cant Miss",
    "notes": "Style 4748. Engineered Floors price list effective 11/16/2026. STD $12.56. Cut $13.66."
  },
  {
    "name": "Cape Cod 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "2540",
    "material_rate": 12.28,
    "roll_rate": 11.28,
    "style": "Cape Cod",
    "notes": "Style 2540. Engineered Floors price list effective 11/16/2026. STD $11.28. Cut $12.28."
  },
  {
    "name": "Capri 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "1428",
    "material_rate": 10.4,
    "roll_rate": 9.4,
    "style": "Capri",
    "notes": "Style 1428. Engineered Floors price list effective 11/16/2026. STD $9.40. Cut $10.40."
  },
  {
    "name": "Captivating I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "1225",
    "material_rate": 7.71,
    "roll_rate": 6.71,
    "style": "Captivating I",
    "notes": "Style 1225. Engineered Floors price list effective 11/16/2026. STD $6.71. Cut $7.71."
  },
  {
    "name": "Captivating II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "1030",
    "material_rate": 8.6,
    "roll_rate": 7.6,
    "style": "Captivating II",
    "notes": "Style 1030. Engineered Floors price list effective 11/16/2026. STD $7.60. Cut $8.60."
  },
  {
    "name": "Captivating III 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "1335",
    "material_rate": 9.48,
    "roll_rate": 8.38,
    "style": "Captivating III",
    "notes": "Style 1335. Engineered Floors price list effective 11/16/2026. STD $8.38. Cut $9.48."
  },
  {
    "name": "Cascade Plank 7\" x 48\" Dry Back",
    "category": "lvp",
    "unit": "sqft",
    "sku": "L2520",
    "material_rate": 1.29,
    "roll_rate": null,
    "style": "Cascade Plank",
    "notes": "Style L2520. Engineered Floors price list effective 11/16/2026. STD $1.29. Cut $1.49."
  },
  {
    "name": "Cascade Plank 7\" x 48\" Lux Vinyl",
    "category": "lvp",
    "unit": "sqft",
    "sku": "L2520",
    "material_rate": 1.29,
    "roll_rate": null,
    "style": "Cascade Plank",
    "notes": "Style L2520. Engineered Floors price list effective 11/16/2026. STD $1.29. Cut $1.49."
  },
  {
    "name": "Cascade Plus 7\" x 48\" Dry Back",
    "category": "lvp",
    "unit": "sqft",
    "sku": "L020P",
    "material_rate": 1.29,
    "roll_rate": null,
    "style": "Cascade Plus",
    "notes": "Style L020P. Engineered Floors price list effective 11/16/2026. STD $1.29. Cut $1.49."
  },
  {
    "name": "Caspian 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "1528",
    "material_rate": 10.4,
    "roll_rate": 9.4,
    "style": "Caspian",
    "notes": "Style 1528. Engineered Floors price list effective 11/16/2026. STD $9.40. Cut $10.40."
  },
  {
    "name": "Cedar Creek 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "2030",
    "material_rate": 8.8,
    "roll_rate": 7.7,
    "style": "Cedar Creek",
    "notes": "Style 2030. Engineered Floors price list effective 11/16/2026. STD $7.70. Cut $8.80."
  },
  {
    "name": "Chivalry 24x24",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7233T",
    "material_rate": 18.49,
    "roll_rate": null,
    "style": "Chivalry",
    "notes": "Style 7233T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $18.49. Cut $18.49."
  },
  {
    "name": "Chivalry 20 Bl",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3033B",
    "material_rate": 9.94,
    "roll_rate": 8.94,
    "style": "Chivalry 20 Bl",
    "notes": "Style 3033B. Engineered Floors price list effective 11/16/2026. STD $8.94. Cut $9.94."
  },
  {
    "name": "Chivalry 26 Bl 12' 26oz",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3034B",
    "material_rate": 11.71,
    "roll_rate": 10.71,
    "style": "Chivalry 26 Bl",
    "notes": "Style 3034B. Engineered Floors price list effective 11/16/2026. STD $10.71. Cut $11.71."
  },
  {
    "name": "Classic Elements 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "2935",
    "material_rate": 12.68,
    "roll_rate": 11.68,
    "style": "Classic Elements",
    "notes": "Style 2935. Engineered Floors price list effective 11/16/2026. STD $11.68. Cut $12.68."
  },
  {
    "name": "Clear Skies I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "5245",
    "material_rate": 13.66,
    "roll_rate": 12.56,
    "style": "Clear Skies I",
    "notes": "Style 5245. Engineered Floors price list effective 11/16/2026. STD $12.56. Cut $13.66."
  },
  {
    "name": "Clear Skies II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "5264",
    "material_rate": 16.33,
    "roll_rate": 15.23,
    "style": "Clear Skies II",
    "notes": "Style 5264. Engineered Floors price list effective 11/16/2026. STD $15.23. Cut $16.33."
  },
  {
    "name": "Clear Skies III 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "5276",
    "material_rate": 19.38,
    "roll_rate": 18.38,
    "style": "Clear Skies III",
    "notes": "Style 5276. Engineered Floors price list effective 11/16/2026. STD $18.38. Cut $19.38."
  },
  {
    "name": "Clearwater I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "1345",
    "material_rate": 12.06,
    "roll_rate": 11.06,
    "style": "Clearwater I",
    "notes": "Style 1345. Engineered Floors price list effective 11/16/2026. STD $11.06. Cut $12.06."
  },
  {
    "name": "Clearwater II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "1360",
    "material_rate": 14.43,
    "roll_rate": 13.43,
    "style": "Clearwater II",
    "notes": "Style 1360. Engineered Floors price list effective 11/16/2026. STD $13.43. Cut $14.43."
  },
  {
    "name": "Clearwater III 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "1370",
    "material_rate": 15.61,
    "roll_rate": 14.51,
    "style": "Clearwater III",
    "notes": "Style 1370. Engineered Floors price list effective 11/16/2026. STD $14.51. Cut $15.61."
  },
  {
    "name": "Cliff Hanger Modular 12x48",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7090T",
    "material_rate": 16.09,
    "roll_rate": null,
    "style": "Cliff Hanger Modular",
    "notes": "Style 7090T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $16.09. Cut $16.09."
  },
  {
    "name": "Color Solutions 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "E125",
    "material_rate": 8.36,
    "roll_rate": null,
    "style": "Color Solutions",
    "notes": "Style E125. Engineered Floors price list effective 11/16/2026. Price $8.36."
  },
  {
    "name": "Colorburst Plank 12x48",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7049P",
    "material_rate": 17.19,
    "roll_rate": null,
    "style": "Colorburst Plank",
    "notes": "Style 7049P. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $17.19. Cut $17.19."
  },
  {
    "name": "Colorburst Tile 24x24",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7049T",
    "material_rate": 16.09,
    "roll_rate": null,
    "style": "Colorburst Tile",
    "notes": "Style 7049T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $16.09. Cut $16.09."
  },
  {
    "name": "Colorpoint Plank 12x48",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7094P",
    "material_rate": 16.11,
    "roll_rate": null,
    "style": "Colorpoint Plank",
    "notes": "Style 7094P. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $16.11. Cut $16.11."
  },
  {
    "name": "Colorpoint Tile 24x24",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7094T",
    "material_rate": 15.09,
    "roll_rate": null,
    "style": "Colorpoint Tile",
    "notes": "Style 7094T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $15.09. Cut $15.09."
  },
  {
    "name": "Comm 557 Quarts",
    "category": "other",
    "unit": "each",
    "sku": "A557",
    "material_rate": 20.47,
    "roll_rate": null,
    "style": "Comm 557 Quarts",
    "notes": "Style A557. Engineered Floors price list effective 11/16/2026. Price $20.47."
  },
  {
    "name": "Commercial Adhesive 4 Gal",
    "category": "other",
    "unit": "each",
    "sku": "A601",
    "material_rate": 50.09,
    "roll_rate": null,
    "style": "Commercial Adhesive 4 Gal",
    "notes": "Style A601. Engineered Floors price list effective 11/16/2026. Price $50.09."
  },
  {
    "name": "Common Ground 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "2845",
    "material_rate": 10.4,
    "roll_rate": 9.4,
    "style": "Common Ground",
    "notes": "Style 2845. Engineered Floors price list effective 11/16/2026. STD $9.40. Cut $10.40."
  },
  {
    "name": "Confetti I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3138",
    "material_rate": 12.38,
    "roll_rate": 11.38,
    "style": "Confetti I",
    "notes": "Style 3138. Engineered Floors price list effective 11/16/2026. STD $11.38. Cut $12.38."
  },
  {
    "name": "Confetti II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3148",
    "material_rate": 14.66,
    "roll_rate": 13.66,
    "style": "Confetti II",
    "notes": "Style 3148. Engineered Floors price list effective 11/16/2026. STD $13.66. Cut $14.66."
  },
  {
    "name": "Confetti III 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3160",
    "material_rate": 17.63,
    "roll_rate": 16.53,
    "style": "Confetti III",
    "notes": "Style 3160. Engineered Floors price list effective 11/16/2026. STD $16.53. Cut $17.63."
  },
  {
    "name": "Cosmopolitan II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "8550",
    "material_rate": 15.14,
    "roll_rate": 14.14,
    "style": "Cosmopolitan II",
    "notes": "Style 8550. Engineered Floors price list effective 11/16/2026. STD $14.14. Cut $15.14."
  },
  {
    "name": "Crete 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "1342",
    "material_rate": 12.68,
    "roll_rate": 11.68,
    "style": "Crete",
    "notes": "Style 1342. Engineered Floors price list effective 11/16/2026. STD $11.68. Cut $12.68."
  },
  {
    "name": "Daredevil 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "E231",
    "material_rate": 5.9,
    "roll_rate": null,
    "style": "Daredevil",
    "notes": "Style E231. Engineered Floors price list effective 11/16/2026. Price $5.90."
  },
  {
    "name": "Dazzling 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4775",
    "material_rate": 18.88,
    "roll_rate": 17.78,
    "style": "Dazzling",
    "notes": "Style 4775. Engineered Floors price list effective 11/16/2026. STD $17.78. Cut $18.88."
  },
  {
    "name": "Diversified 24x24 Mod Tile",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7037T",
    "material_rate": 17.19,
    "roll_rate": null,
    "style": "Diversified",
    "notes": "Style 7037T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $17.19. Cut $17.19."
  },
  {
    "name": "Diversified 20 12' 20oz",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3036B",
    "material_rate": 9.94,
    "roll_rate": 8.94,
    "style": "Diversified 20",
    "notes": "Style 3036B. Engineered Floors price list effective 11/16/2026. STD $8.94. Cut $9.94."
  },
  {
    "name": "Diversified 26 12' 26oz",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3037B",
    "material_rate": 11.71,
    "roll_rate": 10.71,
    "style": "Diversified 26",
    "notes": "Style 3037B. Engineered Floors price list effective 11/16/2026. STD $10.71. Cut $11.71."
  },
  {
    "name": "Domain 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3051B",
    "material_rate": 10.41,
    "roll_rate": 9.41,
    "style": "Domain",
    "notes": "Style 3051B. Engineered Floors price list effective 11/16/2026. STD $9.41. Cut $10.41."
  },
  {
    "name": "East Hampton 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "2550",
    "material_rate": 13.96,
    "roll_rate": 12.86,
    "style": "East Hampton",
    "notes": "Style 2550. Engineered Floors price list effective 11/16/2026. STD $12.86. Cut $13.96."
  },
  {
    "name": "Echo Plank 12x48",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7055P",
    "material_rate": 17.19,
    "roll_rate": null,
    "style": "Echo Plank",
    "notes": "Style 7055P. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $17.19. Cut $17.19."
  },
  {
    "name": "Echo Tile 24x24",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7055T",
    "material_rate": 16.09,
    "roll_rate": null,
    "style": "Echo Tile",
    "notes": "Style 7055T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $16.09. Cut $16.09."
  },
  {
    "name": "Element Plank 12x48",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7087P",
    "material_rate": 17.19,
    "roll_rate": null,
    "style": "Element Plank",
    "notes": "Style 7087P. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $17.19. Cut $17.19."
  },
  {
    "name": "Element Tile 24x24",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7087T",
    "material_rate": 16.09,
    "roll_rate": null,
    "style": "Element Tile",
    "notes": "Style 7087T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $16.09. Cut $16.09."
  },
  {
    "name": "Elevate 2x94 End Cap",
    "category": "trim",
    "unit": "each",
    "sku": "W021",
    "material_rate": 27,
    "roll_rate": null,
    "style": "Elevate",
    "notes": "Style W021. Engineered Floors price list effective 11/16/2026. Price $27.00."
  },
  {
    "name": "Elevate 9x60 Floating",
    "category": "lvp",
    "unit": "sqft",
    "sku": "W021",
    "material_rate": 2.99,
    "roll_rate": null,
    "style": "Elevate",
    "notes": "Style W021. Engineered Floors price list effective 11/16/2026. STD $2.99. Cut $2.99."
  },
  {
    "name": "Elevate 4x94 Flush Stair Nose",
    "category": "trim",
    "unit": "each",
    "sku": "W021",
    "material_rate": 38,
    "roll_rate": null,
    "style": "Elevate",
    "notes": "Style W021. Engineered Floors price list effective 11/16/2026. Price $38.00."
  },
  {
    "name": "Elevate 2x94 Overlap Stair Nose",
    "category": "trim",
    "unit": "each",
    "sku": "W021",
    "material_rate": 27,
    "roll_rate": null,
    "style": "Elevate",
    "notes": "Style W021. Engineered Floors price list effective 11/16/2026. Price $27.00."
  },
  {
    "name": "Elevate 1x94 Quarter",
    "category": "trim",
    "unit": "each",
    "sku": "W021",
    "material_rate": 17,
    "roll_rate": null,
    "style": "Elevate",
    "notes": "Style W021. Engineered Floors price list effective 11/16/2026. Price $17.00."
  },
  {
    "name": "Elevate 2x94 Reducer",
    "category": "trim",
    "unit": "each",
    "sku": "W021",
    "material_rate": 27,
    "roll_rate": null,
    "style": "Elevate",
    "notes": "Style W021. Engineered Floors price list effective 11/16/2026. Price $27.00."
  },
  {
    "name": "Elevate 2x94 T Mold",
    "category": "trim",
    "unit": "each",
    "sku": "W021",
    "material_rate": 27,
    "roll_rate": null,
    "style": "Elevate",
    "notes": "Style W021. Engineered Floors price list effective 11/16/2026. Price $27.00."
  },
  {
    "name": "Elevate 12x50 Stair Treads",
    "category": "trim",
    "unit": "each",
    "sku": "W021",
    "material_rate": 108,
    "roll_rate": null,
    "style": "Elevate",
    "notes": "Style W021. Engineered Floors price list effective 11/16/2026. Price $108.00."
  },
  {
    "name": "Empower 2x94 End Cap",
    "category": "trim",
    "unit": "each",
    "sku": "L055",
    "material_rate": 27,
    "roll_rate": null,
    "style": "Empower",
    "notes": "Style L055. Engineered Floors price list effective 11/16/2026. Price $27.00."
  },
  {
    "name": "Empower 7\" x 48\" Floating",
    "category": "laminate",
    "unit": "sqft",
    "sku": "L055",
    "material_rate": 2.59,
    "roll_rate": null,
    "style": "Empower",
    "notes": "Style L055. Engineered Floors price list effective 11/16/2026. STD $2.59. Cut $2.79."
  },
  {
    "name": "Empower 4x94 Flush Stair Nose",
    "category": "trim",
    "unit": "each",
    "sku": "L055",
    "material_rate": 37.8,
    "roll_rate": null,
    "style": "Empower",
    "notes": "Style L055. Engineered Floors price list effective 11/16/2026. Price $37.80."
  },
  {
    "name": "Empower 2x94 Overlap Stair Nose",
    "category": "trim",
    "unit": "each",
    "sku": "L055",
    "material_rate": 27,
    "roll_rate": null,
    "style": "Empower",
    "notes": "Style L055. Engineered Floors price list effective 11/16/2026. Price $27.00."
  },
  {
    "name": "Empower 1x94 Quarter",
    "category": "trim",
    "unit": "each",
    "sku": "L055",
    "material_rate": 17.28,
    "roll_rate": null,
    "style": "Empower",
    "notes": "Style L055. Engineered Floors price list effective 11/16/2026. Price $17.28."
  },
  {
    "name": "Empower 2x94 Reducer",
    "category": "trim",
    "unit": "each",
    "sku": "L055",
    "material_rate": 27,
    "roll_rate": null,
    "style": "Empower",
    "notes": "Style L055. Engineered Floors price list effective 11/16/2026. Price $27.00."
  },
  {
    "name": "Empower 2x94 T Mold",
    "category": "trim",
    "unit": "each",
    "sku": "L055",
    "material_rate": 27,
    "roll_rate": null,
    "style": "Empower",
    "notes": "Style L055. Engineered Floors price list effective 11/16/2026. Price $27.00."
  },
  {
    "name": "Empower 12x50 Stair Treads",
    "category": "trim",
    "unit": "each",
    "sku": "L055",
    "material_rate": 108,
    "roll_rate": null,
    "style": "Empower",
    "notes": "Style L055. Engineered Floors price list effective 11/16/2026. Price $108.00."
  },
  {
    "name": "Exceptional II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7404",
    "material_rate": 10.38,
    "roll_rate": 9.38,
    "style": "Exceptional II",
    "notes": "Style 7404. Engineered Floors price list effective 11/16/2026. STD $9.38. Cut $10.38."
  },
  {
    "name": "Fanfare Modular 24x24 Mod Tile",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7079T",
    "material_rate": 15.17,
    "roll_rate": null,
    "style": "Fanfare Modular",
    "notes": "Style 7079T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $15.17. Cut $15.17."
  },
  {
    "name": "Fast Break 24x24 Mod Tile",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7060T",
    "material_rate": 12.59,
    "roll_rate": null,
    "style": "Fast Break",
    "notes": "Style 7060T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $12.59. Cut $12.59."
  },
  {
    "name": "Finishing Touch 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "2835",
    "material_rate": 12.68,
    "roll_rate": 11.68,
    "style": "Finishing Touch",
    "notes": "Style 2835. Engineered Floors price list effective 11/16/2026. STD $11.68. Cut $12.68."
  },
  {
    "name": "First Step 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4160",
    "material_rate": 5.04,
    "roll_rate": null,
    "style": "First Step",
    "notes": "Style 4160. Engineered Floors price list effective 11/16/2026. Price $5.04."
  },
  {
    "name": "Formation 24x24 Mod Tile",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7033T",
    "material_rate": 15.59,
    "roll_rate": null,
    "style": "Formation",
    "notes": "Style 7033T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $15.59. Cut $15.59."
  },
  {
    "name": "Galactic 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3230",
    "material_rate": 8.01,
    "roll_rate": 7.01,
    "style": "Galactic",
    "notes": "Style 3230. Engineered Floors price list effective 11/16/2026. STD $7.01. Cut $8.01."
  },
  {
    "name": "Gallatin Plank 7\" x 48\" Dry Back",
    "category": "lvp",
    "unit": "sqft",
    "sku": "L2008",
    "material_rate": 1.22,
    "roll_rate": null,
    "style": "Gallatin Plank",
    "notes": "Style L2008. Engineered Floors price list effective 11/16/2026. STD $1.22. Cut $1.55."
  },
  {
    "name": "Gallatin Plank 7\" x 48\" Lux Vinyl",
    "category": "lvp",
    "unit": "sqft",
    "sku": "L2008",
    "material_rate": 0.89,
    "roll_rate": null,
    "style": "Gallatin Plank",
    "notes": "Style L2008. Engineered Floors price list effective 11/16/2026. STD $0.89. Cut $1.09."
  },
  {
    "name": "Gallatin Plus 7\" x 48\" Dry Back",
    "category": "lvp",
    "unit": "sqft",
    "sku": "L008P",
    "material_rate": 1.22,
    "roll_rate": null,
    "style": "Gallatin Plus",
    "notes": "Style L008P. Engineered Floors price list effective 11/16/2026. STD $1.22. Cut $1.55."
  },
  {
    "name": "Gallatin Plus 7\" x 48\" Lux Vinyl",
    "category": "lvp",
    "unit": "sqft",
    "sku": "L008P",
    "material_rate": 0.89,
    "roll_rate": null,
    "style": "Gallatin Plus",
    "notes": "Style L008P. Engineered Floors price list effective 11/16/2026. STD $0.89. Cut $1.09."
  },
  {
    "name": "Gold Standard I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4046",
    "material_rate": 12.68,
    "roll_rate": 11.68,
    "style": "Gold Standard I",
    "notes": "Style 4046. Engineered Floors price list effective 11/16/2026. STD $11.68. Cut $12.68."
  },
  {
    "name": "Gold Standard II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4056",
    "material_rate": 14.46,
    "roll_rate": 13.46,
    "style": "Gold Standard II",
    "notes": "Style 4056. Engineered Floors price list effective 11/16/2026. STD $13.46. Cut $14.46."
  },
  {
    "name": "Gold Standard III 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4066",
    "material_rate": 16.33,
    "roll_rate": 15.23,
    "style": "Gold Standard III",
    "notes": "Style 4066. Engineered Floors price list effective 11/16/2026. STD $15.23. Cut $16.33."
  },
  {
    "name": "Grand Isle 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3428",
    "material_rate": 10.4,
    "roll_rate": 9.4,
    "style": "Grand Isle",
    "notes": "Style 3428. Engineered Floors price list effective 11/16/2026. STD $9.40. Cut $10.40."
  },
  {
    "name": "Hollywood 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "8232",
    "material_rate": 10.3,
    "roll_rate": 9.3,
    "style": "Hollywood",
    "notes": "Style 8232. Engineered Floors price list effective 11/16/2026. STD $9.30. Cut $10.30."
  },
  {
    "name": "Hot Pursuit 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "1424",
    "material_rate": 6.73,
    "roll_rate": 5.73,
    "style": "Hot Pursuit",
    "notes": "Style 1424. Engineered Floors price list effective 11/16/2026. STD $5.73. Cut $6.73."
  },
  {
    "name": "Hypnotic Modular 24x24",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7910T",
    "material_rate": 14.49,
    "roll_rate": null,
    "style": "Hypnotic Modular",
    "notes": "Style 7910T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $14.49. Cut $14.49."
  },
  {
    "name": "In A Snap 18x18 Tl Direct 5 Smart Squares",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "SQ108",
    "material_rate": 14.19,
    "roll_rate": null,
    "style": "In A Snap",
    "notes": "Style SQ108. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $14.19. Cut $14.19."
  },
  {
    "name": "Influencer Modular 24x24",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7095T",
    "material_rate": 14.49,
    "roll_rate": null,
    "style": "Influencer Modular",
    "notes": "Style 7095T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $14.49. Cut $14.49."
  },
  {
    "name": "Interstellar 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3236",
    "material_rate": 8.01,
    "roll_rate": 7.01,
    "style": "Interstellar",
    "notes": "Style 3236. Engineered Floors price list effective 11/16/2026. STD $7.01. Cut $8.01."
  },
  {
    "name": "Lavish II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4265",
    "material_rate": 16.56,
    "roll_rate": 15.3,
    "style": "Lavish II",
    "notes": "Style 4265. Engineered Floors price list effective 11/16/2026. STD $15.30. Cut $16.56."
  },
  {
    "name": "Linea 24x24",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7568T",
    "material_rate": 10.89,
    "roll_rate": null,
    "style": "Linea",
    "notes": "Style 7568T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $10.89. Cut $10.89."
  },
  {
    "name": "Lucky Penny I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4047",
    "material_rate": 13.66,
    "roll_rate": 12.56,
    "style": "Lucky Penny I",
    "notes": "Style 4047. Engineered Floors price list effective 11/16/2026. STD $12.56. Cut $13.66."
  },
  {
    "name": "Lucky Penny II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4055",
    "material_rate": 15.14,
    "roll_rate": 14.14,
    "style": "Lucky Penny II",
    "notes": "Style 4055. Engineered Floors price list effective 11/16/2026. STD $14.14. Cut $15.14."
  },
  {
    "name": "Lucky Penny III 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4067",
    "material_rate": 17.21,
    "roll_rate": 16.21,
    "style": "Lucky Penny III",
    "notes": "Style 4067. Engineered Floors price list effective 11/16/2026. STD $16.21. Cut $17.21."
  },
  {
    "name": "Luxor I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7740",
    "material_rate": 9.98,
    "roll_rate": 8.98,
    "style": "Luxor I",
    "notes": "Style 7740. Engineered Floors price list effective 11/16/2026. STD $8.98. Cut $9.98."
  },
  {
    "name": "Luxor II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7750",
    "material_rate": 11.66,
    "roll_rate": 10.56,
    "style": "Luxor II",
    "notes": "Style 7750. Engineered Floors price list effective 11/16/2026. STD $10.56. Cut $11.66."
  },
  {
    "name": "Luxor III 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7760",
    "material_rate": 14.03,
    "roll_rate": 12.93,
    "style": "Luxor III",
    "notes": "Style 7760. Engineered Floors price list effective 11/16/2026. STD $12.93. Cut $14.03."
  },
  {
    "name": "Lvt Adh 1 Gal 1 Gallon",
    "category": "other",
    "unit": "each",
    "sku": "E168",
    "material_rate": 38.39,
    "roll_rate": null,
    "style": "Lvt Adh 1 Gal 1 Gallon",
    "notes": "Style E168. Engineered Floors price list effective 11/16/2026. Price $38.39."
  },
  {
    "name": "Lvt Adh 4 Gal 4 Gallon",
    "category": "other",
    "unit": "each",
    "sku": "E167",
    "material_rate": 105.09,
    "roll_rate": null,
    "style": "Lvt Adh 4 Gal 4 Gallon",
    "notes": "Style E167. Engineered Floors price list effective 11/16/2026. Price $105.09."
  },
  {
    "name": "Magnify Plank 12x48",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7054P",
    "material_rate": 17.19,
    "roll_rate": null,
    "style": "Magnify Plank",
    "notes": "Style 7054P. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $17.19. Cut $17.19."
  },
  {
    "name": "Magnify Tile 24x24",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7054T",
    "material_rate": 16.09,
    "roll_rate": null,
    "style": "Magnify Tile",
    "notes": "Style 7054T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $16.09. Cut $16.09."
  },
  {
    "name": "Malibu I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3740",
    "material_rate": 12.28,
    "roll_rate": 11.28,
    "style": "Malibu I",
    "notes": "Style 3740. Engineered Floors price list effective 11/16/2026. STD $11.28. Cut $12.28."
  },
  {
    "name": "Malibu II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3750",
    "material_rate": 13.96,
    "roll_rate": 12.86,
    "style": "Malibu II",
    "notes": "Style 3750. Engineered Floors price list effective 11/16/2026. STD $12.86. Cut $13.96."
  },
  {
    "name": "Malibu III 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3760",
    "material_rate": 16.33,
    "roll_rate": 15.23,
    "style": "Malibu III",
    "notes": "Style 3760. Engineered Floors price list effective 11/16/2026. STD $15.23. Cut $16.33."
  },
  {
    "name": "Marvel 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "E227",
    "material_rate": 5.9,
    "roll_rate": null,
    "style": "Marvel",
    "notes": "Style E227. Engineered Floors price list effective 11/16/2026. Price $5.90."
  },
  {
    "name": "Metropolis I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "6437",
    "material_rate": 11.88,
    "roll_rate": 10.88,
    "style": "Metropolis I",
    "notes": "Style 6437. Engineered Floors price list effective 11/16/2026. STD $10.88. Cut $11.88."
  },
  {
    "name": "Metropolis II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "6446",
    "material_rate": 13.46,
    "roll_rate": 12.36,
    "style": "Metropolis II",
    "notes": "Style 6446. Engineered Floors price list effective 11/16/2026. STD $12.36. Cut $13.46."
  },
  {
    "name": "Metropolis III 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "6454",
    "material_rate": 14.96,
    "roll_rate": 13.96,
    "style": "Metropolis III",
    "notes": "Style 6454. Engineered Floors price list effective 11/16/2026. STD $13.96. Cut $14.96."
  },
  {
    "name": "Metropolitan II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "8400",
    "material_rate": 12.28,
    "roll_rate": 11.28,
    "style": "Metropolitan II",
    "notes": "Style 8400. Engineered Floors price list effective 11/16/2026. STD $11.28. Cut $12.28."
  },
  {
    "name": "Mill Creek I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4730",
    "material_rate": 8.8,
    "roll_rate": 7.7,
    "style": "Mill Creek I",
    "notes": "Style 4730. Engineered Floors price list effective 11/16/2026. STD $7.70. Cut $8.80."
  },
  {
    "name": "Mill Creek II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4740",
    "material_rate": 10.38,
    "roll_rate": 9.38,
    "style": "Mill Creek II",
    "notes": "Style 4740. Engineered Floors price list effective 11/16/2026. STD $9.38. Cut $10.38."
  },
  {
    "name": "Modern Edge 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "2825",
    "material_rate": 10.4,
    "roll_rate": 9.4,
    "style": "Modern Edge",
    "notes": "Style 2825. Engineered Floors price list effective 11/16/2026. STD $9.40. Cut $10.40."
  },
  {
    "name": "Modular Tile Adh 1 Gal",
    "category": "other",
    "unit": "each",
    "sku": "A1331",
    "material_rate": 47.2,
    "roll_rate": null,
    "style": "Modular Tile Adh 1 Gal",
    "notes": "Style A1331. Engineered Floors price list effective 11/16/2026. Price $47.20."
  },
  {
    "name": "Modular Tile Adh 4gl 4 Gal",
    "category": "other",
    "unit": "each",
    "sku": "A1334",
    "material_rate": 127,
    "roll_rate": null,
    "style": "Modular Tile Adh 4gl 4 Gal",
    "notes": "Style A1334. Engineered Floors price list effective 11/16/2026. Price $127.00."
  },
  {
    "name": "Montauk 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "2560",
    "material_rate": 16.33,
    "roll_rate": 15.23,
    "style": "Montauk",
    "notes": "Style 2560. Engineered Floors price list effective 11/16/2026. STD $15.23. Cut $16.33."
  },
  {
    "name": "Monte Carlo I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "6200",
    "material_rate": 16.33,
    "roll_rate": 15.23,
    "style": "Monte Carlo I",
    "notes": "Style 6200. Engineered Floors price list effective 11/16/2026. STD $15.23. Cut $16.33."
  },
  {
    "name": "Monte Carlo II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7200",
    "material_rate": 18.61,
    "roll_rate": 17.51,
    "style": "Monte Carlo II",
    "notes": "Style 7200. Engineered Floors price list effective 11/16/2026. STD $17.51. Cut $18.61."
  },
  {
    "name": "Monte Carlo III 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "8200",
    "material_rate": 20.58,
    "roll_rate": 19.48,
    "style": "Monte Carlo III",
    "notes": "Style 8200. Engineered Floors price list effective 11/16/2026. STD $19.48. Cut $20.58."
  },
  {
    "name": "Moon Bay 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "1228",
    "material_rate": 10.4,
    "roll_rate": 9.4,
    "style": "Moon Bay",
    "notes": "Style 1228. Engineered Floors price list effective 11/16/2026. STD $9.40. Cut $10.40."
  },
  {
    "name": "Mykonos 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "5835",
    "material_rate": 12.68,
    "roll_rate": 11.68,
    "style": "Mykonos",
    "notes": "Style 5835. Engineered Floors price list effective 11/16/2026. STD $11.68. Cut $12.68."
  },
  {
    "name": "Mystique 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3575",
    "material_rate": 12.68,
    "roll_rate": 11.68,
    "style": "Mystique",
    "notes": "Style 3575. Engineered Floors price list effective 11/16/2026. STD $11.68. Cut $12.68."
  },
  {
    "name": "Natural Attraction 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3590",
    "material_rate": 12.68,
    "roll_rate": 11.68,
    "style": "Natural Attraction",
    "notes": "Style 3590. Engineered Floors price list effective 11/16/2026. STD $11.68. Cut $12.68."
  },
  {
    "name": "New Standard II 6x48",
    "category": "lvp",
    "unit": "sqft",
    "sku": "R004",
    "material_rate": 1.89,
    "roll_rate": null,
    "style": "New Standard II",
    "notes": "Style R004. Engineered Floors price list effective 11/16/2026. STD $1.89. Cut $2.09."
  },
  {
    "name": "New Standard II 2x94 End Cap",
    "category": "trim",
    "unit": "each",
    "sku": "R004",
    "material_rate": 27,
    "roll_rate": null,
    "style": "New Standard II",
    "notes": "Style R004. Engineered Floors price list effective 11/16/2026. Price $27.00."
  },
  {
    "name": "New Standard II 6x48 Floating",
    "category": "lvp",
    "unit": "sqft",
    "sku": "R004",
    "material_rate": 1.89,
    "roll_rate": null,
    "style": "New Standard II",
    "notes": "Style R004. Engineered Floors price list effective 11/16/2026. STD $1.89. Cut $2.09."
  },
  {
    "name": "New Standard II 3x94 Flush Stair",
    "category": "trim",
    "unit": "each",
    "sku": "R004",
    "material_rate": 37.8,
    "roll_rate": null,
    "style": "New Standard II",
    "notes": "Style R004. Engineered Floors price list effective 11/16/2026. Price $37.80."
  },
  {
    "name": "New Standard II 1x94 Quarter",
    "category": "trim",
    "unit": "each",
    "sku": "R004",
    "material_rate": 17,
    "roll_rate": null,
    "style": "New Standard II",
    "notes": "Style R004. Engineered Floors price list effective 11/16/2026. Price $17.00."
  },
  {
    "name": "New Standard II 2x94 Reducer",
    "category": "trim",
    "unit": "each",
    "sku": "R004",
    "material_rate": 27,
    "roll_rate": null,
    "style": "New Standard II",
    "notes": "Style R004. Engineered Floors price list effective 11/16/2026. Price $27.00."
  },
  {
    "name": "New Standard II 1x94 T Molding",
    "category": "trim",
    "unit": "each",
    "sku": "R004",
    "material_rate": 27,
    "roll_rate": null,
    "style": "New Standard II",
    "notes": "Style R004. Engineered Floors price list effective 11/16/2026. Price $27.00."
  },
  {
    "name": "New Standard Plus 7\" x 48\" Floating",
    "category": "lvp",
    "unit": "sqft",
    "sku": "R014",
    "material_rate": 1.89,
    "roll_rate": null,
    "style": "New Standard Plus",
    "notes": "Style R014. Engineered Floors price list effective 11/16/2026. STD $1.89. Cut $2.09."
  },
  {
    "name": "New Standard Plus 3x94 Flush Stair",
    "category": "trim",
    "unit": "each",
    "sku": "R014",
    "material_rate": 38,
    "roll_rate": null,
    "style": "New Standard Plus",
    "notes": "Style R014. Engineered Floors price list effective 11/16/2026. Price $38.00."
  },
  {
    "name": "New Standard Plus 1x94 T Molding",
    "category": "trim",
    "unit": "each",
    "sku": "R014",
    "material_rate": 27,
    "roll_rate": null,
    "style": "New Standard Plus",
    "notes": "Style R014. Engineered Floors price list effective 11/16/2026. Price $27.00."
  },
  {
    "name": "No Limits I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "9337",
    "material_rate": 11.18,
    "roll_rate": 10.08,
    "style": "No Limits I",
    "notes": "Style 9337. Engineered Floors price list effective 11/16/2026. STD $10.08. Cut $11.18."
  },
  {
    "name": "No Limits II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "9346",
    "material_rate": 12.16,
    "roll_rate": 11.16,
    "style": "No Limits II",
    "notes": "Style 9346. Engineered Floors price list effective 11/16/2026. STD $11.16. Cut $12.16."
  },
  {
    "name": "No Limits III 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "9354",
    "material_rate": 13.56,
    "roll_rate": 12.46,
    "style": "No Limits III",
    "notes": "Style 9354. Engineered Floors price list effective 11/16/2026. STD $12.46. Cut $13.56."
  },
  {
    "name": "Oasis Bl 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3477B",
    "material_rate": 9.44,
    "roll_rate": 8.44,
    "style": "Oasis Bl",
    "notes": "Style 3477B. Engineered Floors price list effective 11/16/2026. STD $8.44. Cut $9.44."
  },
  {
    "name": "Oasis Modular 24x24",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7477T",
    "material_rate": 14.49,
    "roll_rate": null,
    "style": "Oasis Modular",
    "notes": "Style 7477T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $14.49. Cut $14.49."
  },
  {
    "name": "Omnia Broadloom 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "6911B",
    "material_rate": 9.44,
    "roll_rate": 8.44,
    "style": "Omnia Broadloom",
    "notes": "Style 6911B. Engineered Floors price list effective 11/16/2026. STD $8.44. Cut $9.44."
  },
  {
    "name": "Out Of This World I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4048",
    "material_rate": 13.96,
    "roll_rate": 12.86,
    "style": "Out Of This World I",
    "notes": "Style 4048. Engineered Floors price list effective 11/16/2026. STD $12.86. Cut $13.96."
  },
  {
    "name": "Out Of This World II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4058",
    "material_rate": 17.03,
    "roll_rate": 16.03,
    "style": "Out Of This World II",
    "notes": "Style 4058. Engineered Floors price list effective 11/16/2026. STD $16.03. Cut $17.03."
  },
  {
    "name": "Out Of This World III 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4068",
    "material_rate": 19.88,
    "roll_rate": 18.88,
    "style": "Out Of This World III",
    "notes": "Style 4068. Engineered Floors price list effective 11/16/2026. STD $18.88. Cut $19.88."
  },
  {
    "name": "Outlaw 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3053B",
    "material_rate": 9.44,
    "roll_rate": 8.44,
    "style": "Outlaw",
    "notes": "Style 3053B. Engineered Floors price list effective 11/16/2026. STD $8.44. Cut $9.44."
  },
  {
    "name": "Ozark II 7\" x 48\" Dry Back",
    "category": "lvp",
    "unit": "sqft",
    "sku": "L2012",
    "material_rate": 1.3,
    "roll_rate": null,
    "style": "Ozark II",
    "notes": "Style L2012. Engineered Floors price list effective 11/16/2026. STD $1.30. Cut $1.62."
  },
  {
    "name": "Ozark II 7\" x 48\" Lux Vinyl",
    "category": "lvp",
    "unit": "sqft",
    "sku": "L2012",
    "material_rate": 0.99,
    "roll_rate": null,
    "style": "Ozark II",
    "notes": "Style L2012. Engineered Floors price list effective 11/16/2026. STD $0.99. Cut $1.19."
  },
  {
    "name": "Ozark Plus 7\" x 48\" Dry Back",
    "category": "lvp",
    "unit": "sqft",
    "sku": "L012P",
    "material_rate": 0.99,
    "roll_rate": null,
    "style": "Ozark Plus",
    "notes": "Style L012P. Engineered Floors price list effective 11/16/2026. STD $0.99. Cut $1.19."
  },
  {
    "name": "Ozark Plus 7\" x 48\" Lux Vinyl",
    "category": "lvp",
    "unit": "sqft",
    "sku": "L012P",
    "material_rate": 0.99,
    "roll_rate": null,
    "style": "Ozark Plus",
    "notes": "Style L012P. Engineered Floors price list effective 11/16/2026. STD $0.99. Cut $1.19."
  },
  {
    "name": "Palazzo 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "1232",
    "material_rate": 12.68,
    "roll_rate": 11.68,
    "style": "Palazzo",
    "notes": "Style 1232. Engineered Floors price list effective 11/16/2026. STD $11.68. Cut $12.68."
  },
  {
    "name": "Palma 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "1135",
    "material_rate": 12.68,
    "roll_rate": 11.68,
    "style": "Palma",
    "notes": "Style 1135. Engineered Floors price list effective 11/16/2026. STD $11.68. Cut $12.68."
  },
  {
    "name": "Palmetto I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "2732",
    "material_rate": 9.2,
    "roll_rate": 8.1,
    "style": "Palmetto I",
    "notes": "Style 2732. Engineered Floors price list effective 11/16/2026. STD $8.10. Cut $9.20."
  },
  {
    "name": "Palmetto II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "2740",
    "material_rate": 10.88,
    "roll_rate": 9.78,
    "style": "Palmetto II",
    "notes": "Style 2740. Engineered Floors price list effective 11/16/2026. STD $9.78. Cut $10.88."
  },
  {
    "name": "Palmetto III 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "2750",
    "material_rate": 13.06,
    "roll_rate": 11.96,
    "style": "Palmetto III",
    "notes": "Style 2750. Engineered Floors price list effective 11/16/2026. STD $11.96. Cut $13.06."
  },
  {
    "name": "Parkway 7\" x 48\" Lux Vinyl",
    "category": "lvp",
    "unit": "sqft",
    "sku": "P1002",
    "material_rate": 3.95,
    "roll_rate": null,
    "style": "Parkway",
    "notes": "Style P1002. Engineered Floors price list effective 11/16/2026. STD $3.95. Cut $4.31."
  },
  {
    "name": "Perfect Balance 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3585",
    "material_rate": 12.68,
    "roll_rate": 11.68,
    "style": "Perfect Balance",
    "notes": "Style 3585. Engineered Floors price list effective 11/16/2026. STD $11.68. Cut $12.68."
  },
  {
    "name": "Pietra 1x94 End Cap",
    "category": "trim",
    "unit": "each",
    "sku": "T0823",
    "material_rate": 27,
    "roll_rate": null,
    "style": "Pietra",
    "notes": "Style T0823. Engineered Floors price list effective 11/16/2026. Price $27.00."
  },
  {
    "name": "Pietra 12x24 Floating",
    "category": "lvp",
    "unit": "sqft",
    "sku": "T0823",
    "material_rate": 3.01,
    "roll_rate": null,
    "style": "Pietra",
    "notes": "Style T0823. Engineered Floors price list effective 11/16/2026. STD $3.01. Cut $3.23."
  },
  {
    "name": "Pietra 3x94 Flush Stair",
    "category": "trim",
    "unit": "each",
    "sku": "T0823",
    "material_rate": 38,
    "roll_rate": null,
    "style": "Pietra",
    "notes": "Style T0823. Engineered Floors price list effective 11/16/2026. Price $38.00."
  },
  {
    "name": "Pietra 1x94 Quarter",
    "category": "trim",
    "unit": "each",
    "sku": "T0823",
    "material_rate": 17,
    "roll_rate": null,
    "style": "Pietra",
    "notes": "Style T0823. Engineered Floors price list effective 11/16/2026. Price $17.00."
  },
  {
    "name": "Pietra 2x94 Reducer",
    "category": "trim",
    "unit": "each",
    "sku": "T0823",
    "material_rate": 27,
    "roll_rate": null,
    "style": "Pietra",
    "notes": "Style T0823. Engineered Floors price list effective 11/16/2026. Price $27.00."
  },
  {
    "name": "Pietra 1x94 T Molding",
    "category": "trim",
    "unit": "each",
    "sku": "T0823",
    "material_rate": 27,
    "roll_rate": null,
    "style": "Pietra",
    "notes": "Style T0823. Engineered Floors price list effective 11/16/2026. Price $27.00."
  },
  {
    "name": "Pinpoint 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "2870",
    "material_rate": 10.4,
    "roll_rate": 9.4,
    "style": "Pinpoint",
    "notes": "Style 2870. Engineered Floors price list effective 11/16/2026. STD $9.40. Cut $10.40."
  },
  {
    "name": "Preseason 12' (EF315)",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "EF315",
    "material_rate": 4.72,
    "roll_rate": null,
    "style": "Preseason",
    "notes": "Style EF315. Engineered Floors price list effective 11/16/2026. Price $4.72."
  },
  {
    "name": "Preseason 12' (E315)",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "E315",
    "material_rate": 4.72,
    "roll_rate": null,
    "style": "Preseason",
    "notes": "Style E315. Engineered Floors price list effective 11/16/2026. Price $4.72."
  },
  {
    "name": "Pretty Penny I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "8245",
    "material_rate": 13.66,
    "roll_rate": 12.56,
    "style": "Pretty Penny I",
    "notes": "Style 8245. Engineered Floors price list effective 11/16/2026. STD $12.56. Cut $13.66."
  },
  {
    "name": "Pretty Penny II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "8260",
    "material_rate": 16.33,
    "roll_rate": 15.23,
    "style": "Pretty Penny II",
    "notes": "Style 8260. Engineered Floors price list effective 11/16/2026. STD $15.23. Cut $16.33."
  },
  {
    "name": "Pretty Penny III 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "8275",
    "material_rate": 19.38,
    "roll_rate": 18.38,
    "style": "Pretty Penny III",
    "notes": "Style 8275. Engineered Floors price list effective 11/16/2026. STD $18.38. Cut $19.38."
  },
  {
    "name": "Prime 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "2125",
    "material_rate": 9.5,
    "roll_rate": 8.5,
    "style": "Prime",
    "notes": "Style 2125. Engineered Floors price list effective 11/16/2026. STD $8.50. Cut $9.50."
  },
  {
    "name": "Prismatic I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "5645",
    "material_rate": 15.46,
    "roll_rate": 14.36,
    "style": "Prismatic I",
    "notes": "Style 5645. Engineered Floors price list effective 11/16/2026. STD $14.36. Cut $15.46."
  },
  {
    "name": "Prismatic II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "5655",
    "material_rate": 17.74,
    "roll_rate": 16.64,
    "style": "Prismatic II",
    "notes": "Style 5655. Engineered Floors price list effective 11/16/2026. STD $16.64. Cut $17.74."
  },
  {
    "name": "Prismatic III 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "5665",
    "material_rate": 20.11,
    "roll_rate": 19.01,
    "style": "Prismatic III",
    "notes": "Style 5665. Engineered Floors price list effective 11/16/2026. STD $19.01. Cut $20.11."
  },
  {
    "name": "Quicksilver 20 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3040B",
    "material_rate": 5.74,
    "roll_rate": 4.74,
    "style": "Quicksilver 20",
    "notes": "Style 3040B. Engineered Floors price list effective 11/16/2026. STD $4.74. Cut $5.74."
  },
  {
    "name": "Quicksilver 26 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3041B",
    "material_rate": 6.71,
    "roll_rate": 5.71,
    "style": "Quicksilver 26",
    "notes": "Style 3041B. Engineered Floors price list effective 11/16/2026. STD $5.71. Cut $6.71."
  },
  {
    "name": "Reflections I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "5348",
    "material_rate": 13.66,
    "roll_rate": 12.56,
    "style": "Reflections I",
    "notes": "Style 5348. Engineered Floors price list effective 11/16/2026. STD $12.56. Cut $13.66."
  },
  {
    "name": "Reflections II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "5365",
    "material_rate": 17.31,
    "roll_rate": 16.31,
    "style": "Reflections II",
    "notes": "Style 5365. Engineered Floors price list effective 11/16/2026. STD $16.31. Cut $17.31."
  },
  {
    "name": "Reflections III 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "5375",
    "material_rate": 18.88,
    "roll_rate": 17.78,
    "style": "Reflections III",
    "notes": "Style 5375. Engineered Floors price list effective 11/16/2026. STD $17.78. Cut $18.88."
  },
  {
    "name": "Restore 2x94 End Cap",
    "category": "trim",
    "unit": "each",
    "sku": "L066",
    "material_rate": 27,
    "roll_rate": null,
    "style": "Restore",
    "notes": "Style L066. Engineered Floors price list effective 11/16/2026. Price $27.00."
  },
  {
    "name": "Restore 9x60 Floating",
    "category": "laminate",
    "unit": "sqft",
    "sku": "L066",
    "material_rate": 2.79,
    "roll_rate": null,
    "style": "Restore",
    "notes": "Style L066. Engineered Floors price list effective 11/16/2026. STD $2.79. Cut $2.99."
  },
  {
    "name": "Restore 4x94 Flush Stair Nose",
    "category": "trim",
    "unit": "each",
    "sku": "L066",
    "material_rate": 37.8,
    "roll_rate": null,
    "style": "Restore",
    "notes": "Style L066. Engineered Floors price list effective 11/16/2026. Price $37.80."
  },
  {
    "name": "Restore 2x94 Overlap Stair Nose",
    "category": "trim",
    "unit": "each",
    "sku": "L066",
    "material_rate": 27,
    "roll_rate": null,
    "style": "Restore",
    "notes": "Style L066. Engineered Floors price list effective 11/16/2026. Price $27.00."
  },
  {
    "name": "Restore 1x94 Quarter",
    "category": "trim",
    "unit": "each",
    "sku": "L066",
    "material_rate": 17.28,
    "roll_rate": null,
    "style": "Restore",
    "notes": "Style L066. Engineered Floors price list effective 11/16/2026. Price $17.28."
  },
  {
    "name": "Restore 2x94 Reducer",
    "category": "trim",
    "unit": "each",
    "sku": "L066",
    "material_rate": 27,
    "roll_rate": null,
    "style": "Restore",
    "notes": "Style L066. Engineered Floors price list effective 11/16/2026. Price $27.00."
  },
  {
    "name": "Restore 2x94 T Mold",
    "category": "trim",
    "unit": "each",
    "sku": "L066",
    "material_rate": 27,
    "roll_rate": null,
    "style": "Restore",
    "notes": "Style L066. Engineered Floors price list effective 11/16/2026. Price $27.00."
  },
  {
    "name": "Restore 12x50 Stair Treads",
    "category": "trim",
    "unit": "each",
    "sku": "L066",
    "material_rate": 108,
    "roll_rate": null,
    "style": "Restore",
    "notes": "Style L066. Engineered Floors price list effective 11/16/2026. Price $108.00."
  },
  {
    "name": "Reverb Plank 12x48",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7056P",
    "material_rate": 17.19,
    "roll_rate": null,
    "style": "Reverb Plank",
    "notes": "Style 7056P. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $17.19. Cut $17.19."
  },
  {
    "name": "Reverb Tile 24x24",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7056T",
    "material_rate": 16.09,
    "roll_rate": null,
    "style": "Reverb Tile",
    "notes": "Style 7056T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $16.09. Cut $16.09."
  },
  {
    "name": "Revival 24x24 Mod Tile",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7043T",
    "material_rate": 10.89,
    "roll_rate": null,
    "style": "Revival",
    "notes": "Style 7043T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $10.89. Cut $10.89."
  },
  {
    "name": "Revolution 24x24 Mod Tile",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7044T",
    "material_rate": 13.99,
    "roll_rate": null,
    "style": "Revolution",
    "notes": "Style 7044T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $13.99. Cut $13.99."
  },
  {
    "name": "Rock Solid I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4345",
    "material_rate": 13.16,
    "roll_rate": 12.06,
    "style": "Rock Solid I",
    "notes": "Style 4345. Engineered Floors price list effective 11/16/2026. STD $12.06. Cut $13.16."
  },
  {
    "name": "Rock Solid II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4355",
    "material_rate": 15.74,
    "roll_rate": 14.64,
    "style": "Rock Solid II",
    "notes": "Style 4355. Engineered Floors price list effective 11/16/2026. STD $14.64. Cut $15.74."
  },
  {
    "name": "Rock Solid III 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4365",
    "material_rate": 17.31,
    "roll_rate": 16.31,
    "style": "Rock Solid III",
    "notes": "Style 4365. Engineered Floors price list effective 11/16/2026. STD $16.31. Cut $17.31."
  },
  {
    "name": "Rogue 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3052B",
    "material_rate": 9.44,
    "roll_rate": 8.44,
    "style": "Rogue",
    "notes": "Style 3052B. Engineered Floors price list effective 11/16/2026. STD $8.44. Cut $9.44."
  },
  {
    "name": "Royale I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "5137",
    "material_rate": 11.88,
    "roll_rate": 10.88,
    "style": "Royale I",
    "notes": "Style 5137. Engineered Floors price list effective 11/16/2026. STD $10.88. Cut $11.88."
  },
  {
    "name": "Royale II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "5146",
    "material_rate": 13.16,
    "roll_rate": 12.06,
    "style": "Royale II",
    "notes": "Style 5146. Engineered Floors price list effective 11/16/2026. STD $12.06. Cut $13.16."
  },
  {
    "name": "Royale III 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "5154",
    "material_rate": 13.96,
    "roll_rate": 12.86,
    "style": "Royale III",
    "notes": "Style 5154. Engineered Floors price list effective 11/16/2026. STD $12.86. Cut $13.96."
  },
  {
    "name": "Rustic Retreat I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4440",
    "material_rate": 12.98,
    "roll_rate": 11.88,
    "style": "Rustic Retreat I",
    "notes": "Style 4440. Engineered Floors price list effective 11/16/2026. STD $11.88. Cut $12.98."
  },
  {
    "name": "Rustic Retreat II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4455",
    "material_rate": 16.24,
    "roll_rate": 15.14,
    "style": "Rustic Retreat II",
    "notes": "Style 4455. Engineered Floors price list effective 11/16/2026. STD $15.14. Cut $16.24."
  },
  {
    "name": "Seascape 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "1328",
    "material_rate": 11.3,
    "roll_rate": 10.25,
    "style": "Seascape",
    "notes": "Style 1328. Engineered Floors price list effective 11/16/2026. STD $10.25. Cut $11.30."
  },
  {
    "name": "Serene I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7140",
    "material_rate": 13.38,
    "roll_rate": 12.28,
    "style": "Serene I",
    "notes": "Style 7140. Engineered Floors price list effective 11/16/2026. STD $12.28. Cut $13.38."
  },
  {
    "name": "Serene II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7150",
    "material_rate": 15.56,
    "roll_rate": 14.46,
    "style": "Serene II",
    "notes": "Style 7150. Engineered Floors price list effective 11/16/2026. STD $14.46. Cut $15.56."
  },
  {
    "name": "Serene III 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7165",
    "material_rate": 19.11,
    "roll_rate": 18.11,
    "style": "Serene III",
    "notes": "Style 7165. Engineered Floors price list effective 11/16/2026. STD $18.11. Cut $19.11."
  },
  {
    "name": "Show Time 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3130",
    "material_rate": 8.99,
    "roll_rate": 7.94,
    "style": "Show Time",
    "notes": "Style 3130. Engineered Floors price list effective 11/16/2026. STD $7.94. Cut $8.99."
  },
  {
    "name": "Side Winder Modular 24x24",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7617T",
    "material_rate": 15.09,
    "roll_rate": null,
    "style": "Side Winder Modular",
    "notes": "Style 7617T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $15.09. Cut $15.09."
  },
  {
    "name": "Sidewinder Bl 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3617B",
    "material_rate": 9.44,
    "roll_rate": 8.44,
    "style": "Sidewinder Bl",
    "notes": "Style 3617B. Engineered Floors price list effective 11/16/2026. STD $8.44. Cut $9.44."
  },
  {
    "name": "Silver Lining II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4533",
    "material_rate": 13.66,
    "roll_rate": 12.56,
    "style": "Silver Lining II",
    "notes": "Style 4533. Engineered Floors price list effective 11/16/2026. STD $12.56. Cut $13.66."
  },
  {
    "name": "Silver Lining III 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "6033",
    "material_rate": 16.33,
    "roll_rate": 15.23,
    "style": "Silver Lining III",
    "notes": "Style 6033. Engineered Floors price list effective 11/16/2026. STD $15.23. Cut $16.33."
  },
  {
    "name": "Silver Lining IV 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7533",
    "material_rate": 19.38,
    "roll_rate": 18.38,
    "style": "Silver Lining IV",
    "notes": "Style 7533. Engineered Floors price list effective 11/16/2026. STD $18.38. Cut $19.38."
  },
  {
    "name": "Smooth Sailing 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "2875",
    "material_rate": 10.4,
    "roll_rate": 9.4,
    "style": "Smooth Sailing",
    "notes": "Style 2875. Engineered Floors price list effective 11/16/2026. STD $9.40. Cut $10.40."
  },
  {
    "name": "Sophisticated 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "5755",
    "material_rate": 19.29,
    "roll_rate": 17.72,
    "style": "Sophisticated",
    "notes": "Style 5755. Engineered Floors price list effective 11/16/2026. STD $17.72. Cut $19.29."
  },
  {
    "name": "Sp250 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "SP250",
    "material_rate": 6.73,
    "roll_rate": 5.73,
    "style": "Sp250",
    "notes": "Style SP250. Engineered Floors price list effective 11/16/2026. STD $5.73. Cut $6.73."
  },
  {
    "name": "Sp251 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "SP251",
    "material_rate": 6.73,
    "roll_rate": 5.73,
    "style": "Sp251",
    "notes": "Style SP251. Engineered Floors price list effective 11/16/2026. STD $5.73. Cut $6.73."
  },
  {
    "name": "Star Struck 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4032",
    "material_rate": 10.3,
    "roll_rate": 9.3,
    "style": "Star Struck",
    "notes": "Style 4032. Engineered Floors price list effective 11/16/2026. STD $9.30. Cut $10.30."
  },
  {
    "name": "Stenciled Modular 24x24",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7912T",
    "material_rate": 15.09,
    "roll_rate": null,
    "style": "Stenciled Modular",
    "notes": "Style 7912T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $15.09. Cut $15.09."
  },
  {
    "name": "Step Up 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "1420",
    "material_rate": 5.04,
    "roll_rate": null,
    "style": "Step Up",
    "notes": "Style 1420. Engineered Floors price list effective 11/16/2026. Price $5.04."
  },
  {
    "name": "Streaming Tile 24x24",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7237T",
    "material_rate": 13.99,
    "roll_rate": null,
    "style": "Streaming Tile",
    "notes": "Style 7237T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $13.99. Cut $13.99."
  },
  {
    "name": "Streaming 20 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3048B",
    "material_rate": 9.44,
    "roll_rate": 8.44,
    "style": "Streaming 20",
    "notes": "Style 3048B. Engineered Floors price list effective 11/16/2026. STD $8.44. Cut $9.44."
  },
  {
    "name": "Streaming 26 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3049B",
    "material_rate": 10.41,
    "roll_rate": 9.41,
    "style": "Streaming 26",
    "notes": "Style 3049B. Engineered Floors price list effective 11/16/2026. STD $9.41. Cut $10.41."
  },
  {
    "name": "Stunning 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4765",
    "material_rate": 17.31,
    "roll_rate": 16.31,
    "style": "Stunning",
    "notes": "Style 4765. Engineered Floors price list effective 11/16/2026. STD $16.31. Cut $17.31."
  },
  {
    "name": "Surfside 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3228",
    "material_rate": 10.4,
    "roll_rate": 9.4,
    "style": "Surfside",
    "notes": "Style 3228. Engineered Floors price list effective 11/16/2026. STD $9.40. Cut $10.40."
  },
  {
    "name": "Sweepstakes 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "2200",
    "material_rate": 5.14,
    "roll_rate": null,
    "style": "Sweepstakes",
    "notes": "Style 2200. Engineered Floors price list effective 11/16/2026. Price $5.14."
  },
  {
    "name": "Techtonic 24x24 Mod Tile",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7042T",
    "material_rate": 15.59,
    "roll_rate": null,
    "style": "Techtonic",
    "notes": "Style 7042T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $15.59. Cut $15.59."
  },
  {
    "name": "Tile Tab For Nexus 1 Roll",
    "category": "other",
    "unit": "each",
    "sku": "NTAB",
    "material_rate": 107.99,
    "roll_rate": null,
    "style": "Tile Tab For Nexus 1 Roll",
    "notes": "Style NTAB. Engineered Floors price list effective 11/16/2026. Price $107.99."
  },
  {
    "name": "Timberline I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "6345",
    "material_rate": 14.66,
    "roll_rate": 13.66,
    "style": "Timberline I",
    "notes": "Style 6345. Engineered Floors price list effective 11/16/2026. STD $13.66. Cut $14.66."
  },
  {
    "name": "Timberline II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "6355",
    "material_rate": 16.94,
    "roll_rate": 15.94,
    "style": "Timberline II",
    "notes": "Style 6355. Engineered Floors price list effective 11/16/2026. STD $15.94. Cut $16.94."
  },
  {
    "name": "Timberline III 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "6365",
    "material_rate": 19.31,
    "roll_rate": 18.31,
    "style": "Timberline III",
    "notes": "Style 6365. Engineered Floors price list effective 11/16/2026. STD $18.31. Cut $19.31."
  },
  {
    "name": "Timeless Beauty 2x94 End Cap",
    "category": "trim",
    "unit": "each",
    "sku": "R013",
    "material_rate": 27,
    "roll_rate": null,
    "style": "Timeless Beauty",
    "notes": "Style R013. Engineered Floors price list effective 11/16/2026. Price $27.00."
  },
  {
    "name": "Timeless Beauty 3x94 Flush Stair",
    "category": "trim",
    "unit": "each",
    "sku": "R013",
    "material_rate": 38,
    "roll_rate": null,
    "style": "Timeless Beauty",
    "notes": "Style R013. Engineered Floors price list effective 11/16/2026. Price $38.00."
  },
  {
    "name": "Timeless Beauty 1x94 Quarter",
    "category": "trim",
    "unit": "each",
    "sku": "R013",
    "material_rate": 17,
    "roll_rate": null,
    "style": "Timeless Beauty",
    "notes": "Style R013. Engineered Floors price list effective 11/16/2026. Price $17.00."
  },
  {
    "name": "Timeless Beauty 2x94 Reducer",
    "category": "trim",
    "unit": "each",
    "sku": "R013",
    "material_rate": 27,
    "roll_rate": null,
    "style": "Timeless Beauty",
    "notes": "Style R013. Engineered Floors price list effective 11/16/2026. Price $27.00."
  },
  {
    "name": "Timeless Beauty 1x94 T Molding",
    "category": "trim",
    "unit": "each",
    "sku": "R013",
    "material_rate": 27,
    "roll_rate": null,
    "style": "Timeless Beauty",
    "notes": "Style R013. Engineered Floors price list effective 11/16/2026. Price $27.00."
  },
  {
    "name": "Timeless Charm Lvt Floating",
    "category": "lvp",
    "unit": "sqft",
    "sku": "Y007",
    "material_rate": 2.04,
    "roll_rate": null,
    "style": "Timeless Charm Lvt Floating",
    "notes": "Style Y007. Engineered Floors price list effective 11/16/2026. STD $2.04. Cut $2.15."
  },
  {
    "name": "Titan I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4640",
    "material_rate": 12.28,
    "roll_rate": 11.28,
    "style": "Titan I",
    "notes": "Style 4640. Engineered Floors price list effective 11/16/2026. STD $11.28. Cut $12.28."
  },
  {
    "name": "Titan II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4755",
    "material_rate": 15.14,
    "roll_rate": 14.14,
    "style": "Titan II",
    "notes": "Style 4755. Engineered Floors price list effective 11/16/2026. STD $14.14. Cut $15.14."
  },
  {
    "name": "Titan III 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4965",
    "material_rate": 17.31,
    "roll_rate": 16.31,
    "style": "Titan III",
    "notes": "Style 4965. Engineered Floors price list effective 11/16/2026. STD $16.31. Cut $17.31."
  },
  {
    "name": "Toast Of The Town 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "5315",
    "material_rate": 9.2,
    "roll_rate": 8.1,
    "style": "Toast Of The Town",
    "notes": "Style 5315. Engineered Floors price list effective 11/16/2026. STD $8.10. Cut $9.20."
  },
  {
    "name": "Top Star 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "E124",
    "material_rate": 8.25,
    "roll_rate": null,
    "style": "Top Star",
    "notes": "Style E124. Engineered Floors price list effective 11/16/2026. Price $8.25."
  },
  {
    "name": "Tracker 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "1524",
    "material_rate": 6.73,
    "roll_rate": 5.73,
    "style": "Tracker",
    "notes": "Style 1524. Engineered Floors price list effective 11/16/2026. STD $5.73. Cut $6.73."
  },
  {
    "name": "Trendsetter I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3640",
    "material_rate": 12.28,
    "roll_rate": 11.28,
    "style": "Trendsetter I",
    "notes": "Style 3640. Engineered Floors price list effective 11/16/2026. STD $11.28. Cut $12.28."
  },
  {
    "name": "Trendsetter II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3655",
    "material_rate": 15.14,
    "roll_rate": 14.14,
    "style": "Trendsetter II",
    "notes": "Style 3655. Engineered Floors price list effective 11/16/2026. STD $14.14. Cut $15.14."
  },
  {
    "name": "Universe Plank 12x48",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7086P",
    "material_rate": 17.19,
    "roll_rate": null,
    "style": "Universe Plank",
    "notes": "Style 7086P. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $17.19. Cut $17.19."
  },
  {
    "name": "Universe Tile 24x24",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7086T",
    "material_rate": 16.11,
    "roll_rate": null,
    "style": "Universe Tile",
    "notes": "Style 7086T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $16.11. Cut $16.11."
  },
  {
    "name": "Uplink Groove Mod 24x24",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7289T",
    "material_rate": 10.89,
    "roll_rate": null,
    "style": "Uplink Groove Mod",
    "notes": "Style 7289T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $10.89. Cut $10.89."
  },
  {
    "name": "Uplink Modular 24x24",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7050T",
    "material_rate": 10.89,
    "roll_rate": null,
    "style": "Uplink Modular",
    "notes": "Style 7050T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $10.89. Cut $10.89."
  },
  {
    "name": "Uplink 20 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3058B",
    "material_rate": 5.54,
    "roll_rate": 4.54,
    "style": "Uplink 20",
    "notes": "Style 3058B. Engineered Floors price list effective 11/16/2026. STD $4.54. Cut $5.54."
  },
  {
    "name": "Uplink 26 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3059B",
    "material_rate": 6.51,
    "roll_rate": 5.51,
    "style": "Uplink 26",
    "notes": "Style 3059B. Engineered Floors price list effective 11/16/2026. STD $5.51. Cut $6.51."
  },
  {
    "name": "Valencia 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "1235",
    "material_rate": 12.68,
    "roll_rate": 11.68,
    "style": "Valencia",
    "notes": "Style 1235. Engineered Floors price list effective 11/16/2026. STD $11.68. Cut $12.68."
  },
  {
    "name": "Venetian 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "3335",
    "material_rate": 12.68,
    "roll_rate": 11.68,
    "style": "Venetian",
    "notes": "Style 3335. Engineered Floors price list effective 11/16/2026. STD $11.68. Cut $12.68."
  },
  {
    "name": "Veritas Modular 24x24",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "7911T",
    "material_rate": 16.09,
    "roll_rate": null,
    "style": "Veritas Modular",
    "notes": "Style 7911T. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $16.09. Cut $16.09."
  },
  {
    "name": "Walk In The Park 18x18 Tl Direct 5 Smart Squares",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "SQ107",
    "material_rate": 16.69,
    "roll_rate": null,
    "style": "Walk In The Park",
    "notes": "Style SQ107. Engineered Floors price list effective 11/16/2026. Carpet tile. STD $16.69. Cut $16.69."
  },
  {
    "name": "West Brow 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "6035",
    "material_rate": 9.98,
    "roll_rate": 8.98,
    "style": "West Brow",
    "notes": "Style 6035. Engineered Floors price list effective 11/16/2026. STD $8.98. Cut $9.98."
  },
  {
    "name": "Windy City I 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4929",
    "material_rate": 9.9,
    "roll_rate": 8.9,
    "style": "Windy City I",
    "notes": "Style 4929. Engineered Floors price list effective 11/16/2026. STD $8.90. Cut $9.90."
  },
  {
    "name": "Windy City II 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4935",
    "material_rate": 11.28,
    "roll_rate": 10.18,
    "style": "Windy City II",
    "notes": "Style 4935. Engineered Floors price list effective 11/16/2026. STD $10.18. Cut $11.28."
  },
  {
    "name": "Windy City III 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4948",
    "material_rate": 13.66,
    "roll_rate": 12.56,
    "style": "Windy City III",
    "notes": "Style 4948. Engineered Floors price list effective 11/16/2026. STD $12.56. Cut $13.66."
  },
  {
    "name": "Wolverine 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "E232",
    "material_rate": 5.9,
    "roll_rate": null,
    "style": "Wolverine",
    "notes": "Style E232. Engineered Floors price list effective 11/16/2026. Price $5.90."
  },
  {
    "name": "Wood Tech 8x54 Floating",
    "category": "laminate",
    "unit": "sqft",
    "sku": "D030",
    "material_rate": 1.79,
    "roll_rate": null,
    "style": "Wood Tech",
    "notes": "Style D030. Engineered Floors price list effective 11/16/2026. STD $1.79. Cut $1.99."
  },
  {
    "name": "Yellowstone 12' (1220)",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "1220",
    "material_rate": 8.89,
    "roll_rate": 7.99,
    "style": "Yellowstone",
    "notes": "Style 1220. Engineered Floors price list effective 11/16/2026. STD $7.99. Cut $8.89."
  },
  {
    "name": "Yellowstone 12' (4330)",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "4330",
    "material_rate": 8.9,
    "roll_rate": 7.8,
    "style": "Yellowstone",
    "notes": "Style 4330. Engineered Floors price list effective 11/16/2026. STD $7.80. Cut $8.90."
  },
  {
    "name": "Yellowstone Fleck 12'",
    "category": "carpet",
    "unit": "sqyd",
    "sku": "5240",
    "material_rate": 8.89,
    "roll_rate": 7.99,
    "style": "Yellowstone Fleck",
    "notes": "Style 5240. Engineered Floors price list effective 11/16/2026. STD $7.99. Cut $8.89."
  }
]
$ef$::jsonb) as x(
      name text,
      category text,
      unit text,
      sku text,
      material_rate numeric,
      roll_rate numeric,
      style text,
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
        when p.manufacturer ilike '%engineered floors%' then 0
        when coalesce(p.manufacturer, '') = '' then 1
        else 2
      end
      limit 1;

    if existing_id is not null
       and coalesce(existing_mfr, '') <> ''
       and existing_mfr not ilike '%engineered floors%' then
      use_name := r.name || ' (' || r.sku || ')';
      existing_id := null;
      existing_mfr := null;
      select p.id, p.manufacturer into existing_id, existing_mfr
        from public.products p
        where lower(p.name) = lower(use_name)
        limit 1;
    end if;

    if existing_id is not null
       and (coalesce(existing_mfr, '') = '' or existing_mfr ilike '%engineered floors%') then
      update public.products set
        material_rate = r.material_rate,
        roll_rate = r.roll_rate,
        unit = r.unit,
        category = r.category::public.product_category,
        sku = r.sku,
        manufacturer = 'Engineered Floors',
        supplier = case
          when coalesce(supplier, '') = '' or supplier ilike '%engineered floors%' then 'Engineered Floors'
          else supplier
        end,
        style = r.style,
        notes = r.notes,
        active = true
      where id = existing_id;
    elsif existing_id is null then
      insert into public.products
        (name, category, unit, material_rate, roll_rate, sku, manufacturer, supplier, style, notes, active)
      values (
        use_name,
        r.category::public.product_category,
        r.unit,
        r.material_rate,
        r.roll_rate,
        r.sku,
        'Engineered Floors',
        'Engineered Floors',
        r.style,
        r.notes,
        true
      );
    end if;
  end loop;
end $$;
