// Lets `node scripts/*.ts` resolve the app's `@/` path alias, so verification
// scripts import the REAL shipping modules instead of a copy of them.
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./alias-resolver.mjs", pathToFileURL("./scripts/"));
