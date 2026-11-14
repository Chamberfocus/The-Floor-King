import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  matchVersatrimListings,
  parseVersatrimSearchHtml,
  versatrimTitleHasColor,
  versatrimTrimProfile,
} from "@/lib/versatrim";

const root = process.cwd();

function article(title: string, brand: string, href: string): string {
  return `<article><h4 class="card-title"><a href="${href}">${title}</a></h4><p class="card-text brand-name">${brand}</p></article>`;
}

const graceland = [
  "16 results for Graceland",
  article("SN-100342, Stair Nose, Graceland", "Versatrim", "https://versatrim.com/SN-100342/?search_query=Graceland"),
  article("EC-100342, Graceland, End Cap", "Versatrim", "https://versatrim.com/EC-100342/"),
  article("TM-100342, Graceland, T-Molding", "Versatrim", "https://versatrim.com/TM-100342/"),
  article("RD-100342, Graceland, Reducer", "Versatrim", "https://versatrim.com/RD-100342/"),
  article("QR-100342, Graceland, Quarter Round", "Versatrim", "https://versatrim.com/QR-100342/"),
].join("\n");

describe("Versatrim transition lookup", () => {
  it("reads stair nose, end cap, T-mold, and reducer for the flooring color", () => {
    const parsed = parseVersatrimSearchHtml(graceland);
    expect(parsed.resultCount).toBe(16);
    expect(parsed.listings.map((item) => item.profile)).toEqual([
      "stair_nose",
      "end_cap",
      "t_mold",
      "reducer",
      "other",
    ]);
    const match = matchVersatrimListings(parsed.listings, {
      manufacturer: "Coretec",
      color: "Graceland",
    });
    expect(match.message).toBeNull();
    expect(match.profiles.stair_nose).toMatchObject({ sku: "SN-100342", brand: "Versatrim", via: "listed" });
    expect(match.profiles.end_cap?.sku).toBe("EC-100342");
    expect(match.profiles.t_mold?.sku).toBe("TM-100342");
    expect(match.profiles.reducer?.sku).toBe("RD-100342");
    expect(match.profiles.stair_nose?.url).toBe("https://versatrim.com/SN-100342/");
    const withEdge = parseVersatrimSearchHtml(
      [
        graceland,
        article("VE-100342, Graceland, Versaedge", "Versatrim", "https://versatrim.com/VE-100342/"),
      ].join("\n"),
    ).listings;
    expect(matchVersatrimListings(withEdge, { color: "Graceland" }).profiles.stair_nose?.sku).toBe(
      "SN-100342",
    );
    const edgeOnly = parseVersatrimSearchHtml(
      article("VE-100342, Graceland, Versaedge", "Versatrim", "https://versatrim.com/VE-100342/"),
    ).listings;
    expect(matchVersatrimListings(edgeOnly, { color: "Graceland" }).profiles.stair_nose).toMatchObject({
      sku: "VE-100342",
      via: "versaedge",
    });
  });

  it("does not treat a longer color name as the floor that was chosen", () => {
    expect(versatrimTitleHasColor("Reducer, Calypso Manila Oak, 9028", "Calypso Oak")).toBe(false);
    expect(versatrimTitleHasColor("Reducer, Calypso Oak, VV0012", "Calypso Oak")).toBe(true);
    const listings = parseVersatrimSearchHtml(
      [
        "2 results",
        article("RD-127118, Reducer, Calypso Manila Oak, 9028", "Rigid Max", "https://versatrim.com/RD-127118/"),
        article("RD-111943, Calypso Oak, Reducer", "US Floors", "https://versatrim.com/RD-111943/"),
      ].join("\n"),
    ).listings;
    const match = matchVersatrimListings(listings, { color: "Calypso Oak", manufacturer: "Coretec" });
    expect(match.profiles.reducer?.sku).toBe("RD-111943");
    expect(match.profiles.stair_nose).toBeNull();
  });

  it("refuses a one-word species and uses SlimTrim only for the three transitions", () => {
    expect(matchVersatrimListings([], { color: "Oak" }).message).toMatch(/full color name/);
    const listings = parseVersatrimSearchHtml(
      article("SLT-100342, Graceland, Slim Trim", "Versatrim", "https://versatrim.com/SLT-100342/"),
    ).listings;
    const match = matchVersatrimListings(listings, { color: "Graceland" });
    expect(match.profiles.stair_nose).toBeNull();
    expect(match.profiles.end_cap).toMatchObject({ sku: "SLT-100342", via: "slim_trim" });
    expect(match.profiles.t_mold?.via).toBe("slim_trim");
    expect(match.profiles.reducer?.via).toBe("slim_trim");
  });

  it("asks for a color before searching and maps the trim types the questionnaire sells", () => {
    expect(matchVersatrimListings([], { manufacturer: "Shaw" }).message).toMatch(/Add the flooring color/);
    expect(versatrimTrimProfile("Stair nose")).toBe("stair_nose");
    expect(versatrimTrimProfile("End cap")).toBe("end_cap");
    expect(versatrimTrimProfile("T-mold")).toBe("t_mold");
    expect(versatrimTrimProfile("Reducer")).toBe("reducer");
    expect(versatrimTrimProfile("J-channel")).toBeNull();
    const q = readFileSync(join(root, "src/app/(app)/estimates/questionnaire.tsx"), "utf8");
    expect(q).toMatch(/VersatrimMatchCard/);
    expect(q).toMatch(/versatrimFloors/);
  });
});
