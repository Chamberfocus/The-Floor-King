"use client";

import { useEffect } from "react";
import { clearSaleFocus, rememberSaleFocus } from "@/lib/sale-focus";

/** Remembers which customer the salesman is selling, so the rest of the app can bring them back. */
export function SaleFocusPin({
  customerId,
  customerName,
  active,
}: {
  customerId: string;
  customerName: string;
  active: boolean;
}) {
  useEffect(() => {
    if (active && customerId) rememberSaleFocus(customerId, customerName);
    else if (customerId) clearSaleFocus(customerId);
    else clearSaleFocus();
  }, [active, customerId, customerName]);
  return null;
}
