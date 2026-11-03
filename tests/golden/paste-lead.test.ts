import { describe, expect, it } from "vitest";
import { parsePastedLead } from "@/lib/paste-lead";

const FACEBOOK = `You have a new lead

Campaign: Spring Flooring Sale
Ad set: Cleveland homeowners

Full name: Jane Smith
Email: jane.smith@gmail.com
Phone number: +1 (216) 555-0142
Street address: 1847 Euclid Avenue
City: Cleveland
State: Ohio
Zip code: 44115

Which rooms need new flooring?: Living room and hallway
When do you want this done?: Within 2 weeks
`;

const STACKED = `full_name
Robert Chen
email
rob.chen@yahoo.com
phone_number
4405550199
street_address
90 Lake Road
city
Bay Village
state
OH
zip_code
44140

This lead is from Facebook
`;

const WEBSITE = `New form submission from the website

Name: Maria Alvarez
Email: maria.alvarez@gmail.com
Phone: 216.555.0177
Address: 90 Lake Road, Bay Village, OH 44140
How can we help?: LVP upstairs, about 600 sq ft.
`;

describe("parse a pasted lead", () => {
  it("reads a Facebook campaign email into customer fields", () => {
    const lead = parsePastedLead(FACEBOOK);
    expect(lead.ready).toBe(true);
    expect(lead.fullName).toBe("Jane Smith");
    expect(lead.email).toBe("jane.smith@gmail.com");
    expect(lead.phone).toBe("216-555-0142");
    expect(lead.street).toBe("1847 Euclid Avenue");
    expect(lead.city).toBe("Cleveland");
    expect(lead.state).toBe("OH");
    expect(lead.zip).toBe("44115");
    expect(lead.sourceKey).toBe("facebook");
    expect(lead.sourceDetailLabel).toBe("Paid campaign");
    expect(lead.campaign).toBe("Spring Flooring Sale · Cleveland homeowners");
    expect(lead.notes).toContain("Which rooms need new flooring: Living room and hallway");
    expect(lead.notes).toContain("When do you want this done: Within 2 weeks");
    expect(lead.notes).not.toContain("jane.smith@gmail.com");
  });

  it("reads Facebook lead-center rows with the label above the value", () => {
    const lead = parsePastedLead(STACKED);
    expect(lead.fullName).toBe("Robert Chen");
    expect(lead.email).toBe("rob.chen@yahoo.com");
    expect(lead.phone).toBe("440-555-0199");
    expect(lead.street).toBe("90 Lake Road");
    expect(lead.city).toBe("Bay Village");
    expect(lead.state).toBe("OH");
    expect(lead.zip).toBe("44140");
    expect(lead.sourceKey).toBe("facebook");
    expect(lead.ready).toBe(true);
  });

  it("reads a website form and splits a one-line address", () => {
    const lead = parsePastedLead(WEBSITE);
    expect(lead.fullName).toBe("Maria Alvarez");
    expect(lead.phone).toBe("216-555-0177");
    expect(lead.email).toBe("maria.alvarez@gmail.com");
    expect(lead.street).toBe("90 Lake Road");
    expect(lead.city).toBe("Bay Village");
    expect(lead.state).toBe("OH");
    expect(lead.zip).toBe("44140");
    expect(lead.sourceKey).toBe("website");
    expect(lead.notes).toBe("How can we help: LVP upstairs, about 600 sq ft.");
  });

  it("joins first and last name and keeps a spreadsheet row", () => {
    expect(
      parsePastedLead("First name: Ada\nLast name: Lovelace\nEmail: ada@example.com").fullName,
    ).toBe("Ada Lovelace");
    const row = parsePastedLead(
      "Jane Smith, jane@gmail.com, 216-555-0142, 123 Main St, Cleveland, OH 44115",
    );
    expect(row.fullName).toBe("Jane Smith");
    expect(row.email).toBe("jane@gmail.com");
    expect(row.phone).toBe("216-555-0142");
    expect(row.street).toBe("123 Main St");
    expect(row.city).toBe("Cleveland");
    expect(row.state).toBe("OH");
    expect(row.zip).toBe("44115");
  });

  it("keeps a question that sits on its own line above the answer", () => {
    const lead = parsePastedLead(`Full name: Jane Smith
Email: jane.smith@gmail.com
Phone: 216-555-0142

Which rooms need new flooring?
Living room and hallway

When do you want this done?
Within 2 weeks
`);
    expect(lead.notes).toContain("Which rooms need new flooring: Living room and hallway");
    expect(lead.notes).toContain("When do you want this done: Within 2 weeks");
  });

  it("does not turn the email header into a customer name", () => {
    const lead = parsePastedLead("You have a new lead!\n\nThanks for your interest.");
    expect(lead.fullName).toBe("");
    expect(lead.ready).toBe(false);
    expect(lead.notes).toContain("You have a new lead");
  });
});
