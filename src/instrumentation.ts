import type { Instrumentation } from "next";
import { logCustomersServerFailure } from "@/lib/customers-render-log";

/**
 * Future Customers server failures keep a server-side trail: route, operation,
 * error code, digest, redacted message, and stack. The request path is not
 * logged — a search query can contain a customer name.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  const path = request.path.split("?")[0] ?? "";
  const route = context.routePath || "";
  if (!path.startsWith("/customers") && !route.includes("/customers")) return;
  logCustomersServerFailure(
    `${context.routeType}:${context.renderSource}`,
    error,
    route || "/customers",
  );
};
