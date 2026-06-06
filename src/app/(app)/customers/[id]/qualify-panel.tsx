import { Check } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { QualifyingQuestion } from "@/lib/types";
import { saveQualification, skipQualification } from "./qualify-actions";

export function QualifyPanel({
  customerId,
  questions,
  qualified,
}: {
  customerId: string;
  questions: QualifyingQuestion[];
  qualified: boolean | null;
}) {
  const form = (
    <div className="space-y-3">
      <form action={saveQualification} className="space-y-3">
        <input type="hidden" name="customer_id" value={customerId} />
        {questions.map((q) => (
          <div key={q.id} className="space-y-1">
            <label className="text-sm font-medium">{q.label}</label>
            {q.help ? (
              <p className="text-xs text-muted-foreground">{q.help}</p>
            ) : null}
            <textarea
              name={`q_${q.id}`}
              rows={2}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        ))}
        <Button type="submit" className="w-full">
          Save qualification
        </Button>
      </form>
      <form action={skipQualification}>
        <input type="hidden" name="customer_id" value={customerId} />
        <Button type="submit" variant="ghost" size="sm" className="w-full">
          Skip qualification
        </Button>
      </form>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Qualify lead
          {qualified ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600">
              <Check className="size-3.5" /> Qualified
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {questions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No qualifying questions set up yet.
          </p>
        ) : qualified ? (
          <details>
            <summary className="cursor-pointer text-sm text-muted-foreground">
              Re-run qualification
            </summary>
            <div className="mt-3">{form}</div>
          </details>
        ) : (
          form
        )}
      </CardContent>
    </Card>
  );
}
