import { carpetCutList, type CutSource } from "@/lib/job-scope";

/**
 * The shared CARPET CUT LIST block, printed on the staging sheet, work order, and
 * purchase order so all three show the exact same cuts. Each piece is listed
 * under its area with its W×L; fill pieces are flagged; a per-roll summary totals
 * the yardage so the roll ordered accounts for every cut (seams/fill included).
 *
 * `items` is any line source (estimate lines or PO items) — see `CutSource`.
 * Renders nothing when the job has no measured carpet cuts.
 */
export function CarpetCutList({
  items,
  title = "Carpet cut list",
  note,
}: {
  items: CutSource[];
  title?: string;
  note?: string;
}) {
  const { cuts, rolls, totalSqyd, hasFill } = carpetCutList(items);
  if (!cuts.length) return null;

  // Group cuts by area, preserving first-seen order.
  const order: string[] = [];
  const byRoom = new Map<string, typeof cuts>();
  for (const c of cuts) {
    if (!byRoom.has(c.room)) {
      byRoom.set(c.room, []);
      order.push(c.room);
    }
    byRoom.get(c.room)!.push(c);
  }

  return (
    <div className="mt-4 break-inside-avoid text-sm text-black">
      <div className="mb-1 flex items-baseline justify-between border-b border-gray-400 pb-0.5">
        <span className="text-sm font-semibold">✂ {title}</span>
        <span className="text-xs text-gray-600">
          {cuts.length} piece{cuts.length === 1 ? "" : "s"} · {totalSqyd} sq yd
        </span>
      </div>

      {/* Cuts grouped under their area */}
      <table className="w-full border-collapse text-sm">
        <tbody>
          {order.map((room) => (
            <RoomCuts key={room} room={room} cuts={byRoom.get(room)!} />
          ))}
        </tbody>
      </table>

      {/* Per-roll summary — what to order / cut off each roll */}
      {rolls.length ? (
        <div className="mt-2 border-t border-gray-300 pt-1 text-xs text-gray-700">
          <span className="font-semibold">Off the roll: </span>
          {rolls.map((r, i) => (
            <span key={`${r.name}-${i}`}>
              {i > 0 ? " · " : ""}
              {r.name}
              {r.width ? ` @ ${r.width} ft` : ""} — {r.count} cut
              {r.count === 1 ? "" : "s"}, {r.totalSqyd} sq yd
              {r.linft != null ? ` (~${r.linft} lin ft)` : ""}
            </span>
          ))}
        </div>
      ) : null}

      {hasFill ? (
        <div className="mt-1 text-[11px] text-gray-600">
          <span className="font-semibold">FILL</span> = fill / seam piece for that
          area — cut from the same roll.
        </div>
      ) : null}
      {note ? <div className="mt-1 text-[11px] text-gray-600">{note}</div> : null}
    </div>
  );
}

function RoomCuts({
  room,
  cuts,
}: {
  room: string;
  cuts: { name: string; size: string; isFill: boolean; sqyd: number }[];
}) {
  return (
    <>
      <tr>
        <td colSpan={3} className="pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          {room}
        </td>
      </tr>
      {cuts.map((c, i) => (
        <tr key={i} className="border-b border-gray-200 align-top">
          <td className="py-0.5 pr-2">
            {c.name}
            {c.isFill ? (
              <span className="ml-1 rounded-sm border border-gray-500 px-1 text-[9px] font-bold uppercase">
                Fill
              </span>
            ) : null}
          </td>
          <td className="whitespace-nowrap py-0.5 px-2 text-right font-semibold tabular-nums">
            {c.size}
          </td>
          <td className="whitespace-nowrap py-0.5 pl-2 text-right tabular-nums text-gray-600">
            {c.sqyd} sq yd
          </td>
        </tr>
      ))}
    </>
  );
}
