"use client";

import { useRef, useState, useTransition } from "react";
import { GripVertical } from "lucide-react";
import { StageRow } from "./stage-row";
import { reorderStages } from "./actions";
import type { WorkflowStage } from "@/lib/types";
import type { HandoffMember } from "@/lib/data/workflow";

export function StageList({
  stages,
  members,
}: {
  stages: WorkflowStage[];
  members: HandoffMember[];
}) {
  const [order, setOrder] = useState(stages);
  const [, startTransition] = useTransition();
  const dragIndex = useRef<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const onDrop = (i: number) => {
    const from = dragIndex.current;
    dragIndex.current = null;
    setOverIndex(null);
    if (from === null || from === i) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(i, 0, moved);
    setOrder(next);
    startTransition(() => reorderStages(next.map((s) => s.id)));
  };

  return (
    <div className="space-y-2">
      <p className="px-1 text-xs text-muted-foreground">
        Drag the ⠿ handle to reorder stages.
      </p>
      {order.map((s, i) => (
        <div
          key={s.id}
          draggable
          onDragStart={() => {
            dragIndex.current = i;
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setOverIndex(i);
          }}
          onDragEnd={() => setOverIndex(null)}
          onDrop={() => onDrop(i)}
          className={
            overIndex === i ? "rounded-md ring-2 ring-primary" : undefined
          }
        >
          <div className="flex items-start gap-1">
            <span
              className="mt-3 cursor-grab text-muted-foreground active:cursor-grabbing"
              title="Drag to reorder"
            >
              <GripVertical className="size-4" />
            </span>
            <div className="flex-1">
              <StageRow
                stage={s}
                members={members}
                isFirst={i === 0}
                isLast={i === order.length - 1}
                hideMove
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
