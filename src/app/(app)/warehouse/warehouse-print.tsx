"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Prints ONE job's staging sheet from the warehouse list. All sheets are
 * pre-rendered (hidden); clicking a card's button flags that job, hides the rest
 * of the page for print, and opens the print dialog — so you get a clean
 * single-job sheet instead of the whole board.
 */
const PrintCtx = createContext<(id: string) => void>(() => {});

export function WarehousePrintProvider({
  sheets,
  children,
}: {
  sheets: { id: string; node: React.ReactNode }[];
  children: React.ReactNode;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const done = () => setActiveId(null);
    window.addEventListener("afterprint", done);
    return () => window.removeEventListener("afterprint", done);
  }, []);

  const print = (id: string) => {
    setActiveId(id);
    // Two frames so the chosen sheet is painted before the print dialog opens.
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  };

  return (
    <PrintCtx.Provider value={print}>
      {/* On screen always visible; hidden from print only while printing a sheet. */}
      <div className={cn(activeId && "print:hidden")}>{children}</div>
      {sheets.map((s) => (
        <div
          key={s.id}
          className={activeId === s.id ? "hidden print:block" : "hidden"}
        >
          {s.node}
        </div>
      ))}
    </PrintCtx.Provider>
  );
}

export function PrintStagingButton({ id }: { id: string }) {
  const print = useContext(PrintCtx);
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => print(id)}>
      <Printer className="size-4" /> Print staging sheet
    </Button>
  );
}
