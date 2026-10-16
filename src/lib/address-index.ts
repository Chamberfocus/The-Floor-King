import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  prepareAddressIndex,
  searchAddressIndex,
  type AddressIndex,
  type AddressSuggestion,
  type PreparedIndex,
} from "@/lib/address-suggest";

let prepared: PreparedIndex | null = null;

/** Census street ranges for Northeast Ohio. Loaded once, matched on this server. */
export function northeastOhioIndex(): PreparedIndex {
  if (prepared) return prepared;
  const file = path.join(process.cwd(), "data", "neohio-address-ranges.json.gz");
  const raw = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as AddressIndex;
  prepared = prepareAddressIndex(raw);
  return prepared;
}

export function localAddressSuggestions(input: string): AddressSuggestion[] {
  return searchAddressIndex(northeastOhioIndex(), input);
}
