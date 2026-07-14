import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const SRC = path.resolve(process.cwd(), "src");

export async function resolve(specifier, context, next) {
  // Modules under test import next/headers at the top level but never call it —
  // they take an injected client. Stub it so the graph resolves.
  if (specifier === "next/headers") {
    return next(
      pathToFileURL(path.resolve(process.cwd(), "scripts/next-headers-stub.mjs")).href,
      context,
    );
  }
  if (specifier.startsWith("@/")) {
    const base = path.join(SRC, specifier.slice(2));
    for (const cand of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
      if (existsSync(cand)) {
        return next(pathToFileURL(cand).href, context);
      }
    }
  }
  return next(specifier, context);
}
