import { describe, expect, it } from "vitest";
import {
  achCompanyFromSettings,
  achPullRow,
  buildNachaDebitFile,
  nextBankingDay,
  routingIsValid,
} from "@/lib/pnc-ach";

const company = {
  destinationRouting: "043000096",
  companyId: "1123456789",
  odfiRouting: "043000096",
  companyName: "Cleveland Floor King",
};

describe("PNC ACH file", () => {
  it("accepts a real routing checksum and a 9-digit company id", () => {
    expect(routingIsValid("043000096")).toBe(true);
    expect(routingIsValid("043000097")).toBe(false);
    expect(achCompanyFromSettings({
      ach_destination_routing: "043000096",
      ach_company_id: "123456789",
      ach_odfi_routing: "043000096",
      company_name: "Cleveland Floor King",
    }).ok).toBe(true);
    expect(achCompanyFromSettings({ company_name: "Cleveland Floor King" }).ok).toBe(false);
  });

  it("builds a 94-character debit file and keeps the account number out of the saved row", () => {
    const createdAt = new Date("2026-11-18T15:00:00Z");
    const built = buildNachaDebitFile({
      company,
      createdAt,
      entries: [
        {
          routing: "043000096",
          account: "123456789",
          accountType: "checking",
          amount: 10.5,
          name: "Ada Lopez",
          idNumber: "INV-1001",
        },
      ],
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const lines = built.file.trimEnd().split("\n");
    expect(lines.every((line) => line.length === 94)).toBe(true);
    expect(lines.length % 10).toBe(0);
    expect(lines[0].slice(0, 3)).toBe("101");
    expect(lines[0].slice(3, 13)).toBe(" 043000096");
    expect(lines[0].slice(13, 23)).toBe("1123456789");
    expect(lines[1].slice(0, 4)).toBe("5225");
    expect(lines[1].slice(50, 53)).toBe("PPD");
    const effective = lines[1].slice(69, 75);
    const expectedDay = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
    }).format(nextBankingDay(createdAt));
    const [month, day, year] = expectedDay.split("/");
    expect(effective).toBe(`${year}${month}${day}`);
    expect(lines[2].slice(1, 3)).toBe("27");
    expect(lines[2].slice(29, 39)).toBe("0000001050");
    expect(lines[2]).toContain("123456789");
    expect(lines[lines.length - 1].startsWith("9")).toBe(true);

    const row = achPullRow({
      invoiceId: "inv",
      customerId: "cust",
      amount: 10.5,
      routing: "043000096",
      account: "123456789",
      accountType: "checking",
      holder: "Ada Lopez",
      createdBy: "user",
    });
    expect(row?.account_last4).toBe("6789");
    expect(JSON.stringify(row)).not.toContain("123456789");
    expect(row?.status).toBe("ready");
  });

  it("uses the savings debit code", () => {
    const built = buildNachaDebitFile({
      company,
      createdAt: new Date("2026-11-18T15:00:00Z"),
      entries: [
        {
          routing: "043000096",
          account: "9999",
          accountType: "savings",
          amount: 1,
          name: "Ada",
          idNumber: "INV-1",
        },
      ],
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.file.split("\n")[2].slice(1, 3)).toBe("37");
  });
});
