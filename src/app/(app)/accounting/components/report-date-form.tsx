import Link from "next/link";

/** Minimal as-of / date-range form that reloads the current report page. */
export function ReportDateForm(props: {
  mode: "asOf" | "range";
  asOf?: string;
  start?: string;
  end?: string;
  actionPath: string;
}) {
  return (
    <form
      method="get"
      action={props.actionPath}
      className="flex flex-wrap items-end gap-3 text-sm"
    >
      {props.mode === "asOf" ? (
        <label className="block">
          As of
          <input
            type="date"
            name="asOf"
            defaultValue={props.asOf ?? ""}
            className="mt-1 block rounded-md border px-2 py-1"
            required
          />
        </label>
      ) : (
        <>
          <label className="block">
            Start
            <input
              type="date"
              name="start"
              defaultValue={props.start ?? ""}
              className="mt-1 block rounded-md border px-2 py-1"
              required
            />
          </label>
          <label className="block">
            End
            <input
              type="date"
              name="end"
              defaultValue={props.end ?? ""}
              className="mt-1 block rounded-md border px-2 py-1"
              required
            />
          </label>
        </>
      )}
      <button
        type="submit"
        className="rounded-md bg-foreground px-3 py-1.5 text-background"
      >
        Run
      </button>
      <Link href="/accounting" className="underline text-muted-foreground">
        Control Center
      </Link>
    </form>
  );
}
