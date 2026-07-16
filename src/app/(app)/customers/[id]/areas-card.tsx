import { ChevronUp, ChevronDown, Trash2, Ruler, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Input } from "@/components/ui/input";
import type { CustomerArea } from "@/lib/types";
import { saveCustomerArea, deleteCustomerArea, moveCustomerArea } from "./area-actions";

const ftPart = (totalIn: number | null) => (totalIn ? String(Math.floor(totalIn / 12)) : "");
const inPart = (totalIn: number | null) => (totalIn ? String(Math.round(totalIn % 12)) : "");
const cell = "h-9 w-14 rounded-md border border-input bg-transparent px-1.5 text-sm";

/**
 * Areas & measurements for a customer — the sq ft calculator's list, editable
 * here (add / edit / delete / reorder). The questionnaire saves to it and
 * prefills from it, so adding/removing a room later is easy.
 */
export function CustomerAreasCard({
  customerId,
  areas,
}: {
  customerId: string;
  areas: CustomerArea[];
}) {
  const total = areas.reduce((s, a) => s + (Number(a.sqft) || 0), 0);

  const rowForm = (a?: CustomerArea) => (
    <form
      action={saveCustomerArea}
      className="flex flex-wrap items-center gap-2 rounded-md border p-2"
    >
      <input type="hidden" name="customer_id" value={customerId} />
      {a ? <input type="hidden" name="id" value={a.id} /> : null}
      <Input name="name" defaultValue={a?.name ?? ""} placeholder="Area name" className="h-9 min-w-[8rem] flex-1" />
      <div className="flex items-center gap-1">
        <input name="len_ft" defaultValue={ftPart(a?.length_in ?? null)} placeholder="ft" inputMode="decimal" className={cell} />
        <input name="len_in" defaultValue={inPart(a?.length_in ?? null)} placeholder="in" inputMode="decimal" className={cell} />
        <span className="text-xs text-muted-foreground">×</span>
        <input name="wid_ft" defaultValue={ftPart(a?.width_in ?? null)} placeholder="ft" inputMode="decimal" className={cell} />
        <input name="wid_in" defaultValue={inPart(a?.width_in ?? null)} placeholder="in" inputMode="decimal" className={cell} />
      </div>
      <input name="sqft" defaultValue={a?.sqft != null ? String(a.sqft) : ""} placeholder="sq ft" inputMode="decimal" className="h-9 w-20 rounded-md border border-input bg-transparent px-2 text-sm" />
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input type="checkbox" name="differs" defaultChecked={a?.differs} className="size-4" /> diff. prep
      </label>
      <Button type="submit" variant={a ? "outline" : "default"} size="sm">
        {a ? "Save" : (<><Plus className="size-3.5" /> Add</>)}
      </Button>
    </form>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Ruler className="size-4 text-primary" /> Areas &amp; measurements
        </CardTitle>
        {total > 0 ? (
          <span className="rounded-md bg-primary/10 px-2.5 py-1 text-sm font-medium">
            {Math.round(total * 100) / 100} sq ft
            <span className="ml-1 text-muted-foreground">· {Math.round((total / 9) * 100) / 100} sq yd</span>
          </span>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2">
        {areas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No saved areas yet. Add rooms here, or they&apos;ll be saved when you build an estimate.
          </p>
        ) : (
          areas.map((a, i) => (
            <div key={a.id} className="flex items-start gap-1">
              <div className="min-w-0 flex-1">{rowForm(a)}</div>
              <div className="flex flex-col">
                <form action={moveCustomerArea}>
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="customer_id" value={customerId} />
                  <input type="hidden" name="dir" value="up" />
                  <Button type="submit" variant="ghost" size="icon-xs" aria-label="Move up" disabled={i === 0}>
                    <ChevronUp className="size-3.5" />
                  </Button>
                </form>
                <form action={moveCustomerArea}>
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="customer_id" value={customerId} />
                  <input type="hidden" name="dir" value="down" />
                  <Button type="submit" variant="ghost" size="icon-xs" aria-label="Move down" disabled={i === areas.length - 1}>
                    <ChevronDown className="size-3.5" />
                  </Button>
                </form>
              </div>
              <form action={deleteCustomerArea}>
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="customer_id" value={customerId} />
                <ConfirmButton
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete"
                  title={`Delete the ${a.name || "area"} measurement?`}
                  description="Removes this saved room measurement. This can't be undone."
                  confirmLabel="Delete area"
                  destructive
                >
                  <Trash2 className="size-4 text-destructive" />
                </ConfirmButton>
              </form>
            </div>
          ))
        )}
        <div className="pt-1">{rowForm()}</div>
      </CardContent>
    </Card>
  );
}
