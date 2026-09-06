import { formatMoney } from "@/lib/format";

export function MoneyTable(props: {
  columns: { key: string; label: string; align?: "left" | "right"; money?: boolean }[];
  rows: Record<string, string | number | null | undefined>[];
  emptyMessage?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-left">
            {props.columns.map((c) => (
              <th
                key={c.key}
                className={`p-2 ${c.align === "right" ? "text-right" : ""}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.length === 0 ? (
            <tr>
              <td
                className="p-3 text-muted-foreground"
                colSpan={props.columns.length}
              >
                {props.emptyMessage ?? "No rows."}
              </td>
            </tr>
          ) : (
            props.rows.map((row, i) => (
              <tr key={i} className="border-b">
                {props.columns.map((c) => {
                  const raw = row[c.key];
                  const display =
                    c.money && raw != null && raw !== ""
                      ? formatMoney(Number(raw) || 0)
                      : raw == null || raw === ""
                        ? ""
                        : String(raw);
                  return (
                    <td
                      key={c.key}
                      className={`p-2 ${c.align === "right" ? "text-right" : ""} ${
                        c.key === "code" ? "font-mono text-xs" : ""
                      }`}
                    >
                      {display}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
