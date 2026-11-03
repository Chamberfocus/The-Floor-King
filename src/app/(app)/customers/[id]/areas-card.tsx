import { ChevronUp, ChevronDown, Trash2, Ruler, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Input } from "@/components/ui/input";
import type { CustomerArea } from "@/lib/types";
import { CustomerAreaMeasureFields, MeasureAreaReadout, MeasureAreaUnitToggle } from "@/components/measure-area-unit";
import { saveCustomerArea, deleteCustomerArea, moveCustomerArea } from "./area-actions";
import { DrawingTakeoff } from "./drawing-review";

/**
 * Areas & measurements for a customer — the sq ft calculator's list, editable
 * here (add / edit / delete / reorder). The questionnaire saves to it and
 * prefills from it, so adding/removing a room later is easy.
 */
export function CustomerAreasCard({
  customerId,
  areas,
  canTakeoff = false,
}: {
  customerId: string;
  areas: CustomerArea[];
  canTakeoff?: boolean;
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
      <CustomerAreaMeasureFields
        lengthIn={a?.length_in ?? null}
        widthIn={a?.width_in ?? null}
        sqft={a?.sqft ?? null}
      />
      <Input name="note" defaultValue={a?.note ?? ""} placeholder="Note" className="h-9 min-w-[10rem] flex-1" />
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
        <div className="flex flex-wrap items-center gap-2">
          <MeasureAreaUnitToggle />
          {total > 0 ? (
            <span className="rounded-md bg-primary/10 px-2.5 py-1 text-sm font-medium">
              <MeasureAreaReadout sqft={total} />
            </span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {canTakeoff ? <DrawingTakeoff customerId={customerId} /> : null}
        {areas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {canTakeoff
              ? "No saved areas yet. Read the drawing above, or add a room here."
              : "No saved areas yet. Add rooms here, or they'll be saved when you build an estimate."}
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
