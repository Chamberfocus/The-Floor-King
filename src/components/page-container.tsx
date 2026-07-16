import { cn } from "@/lib/utils";

/**
 * One place that decides page width, so the app stops "jumping width" as you
 * navigate. `narrow` = focused forms/settings, `detail` = record pages,
 * `wide` = dense hubs, `full` = data lists that want the whole width.
 */
const WIDTHS = {
  narrow: "max-w-2xl",
  detail: "max-w-4xl",
  wide: "max-w-5xl",
  full: "",
} as const;

export function PageContainer({
  size = "detail",
  className,
  children,
}: {
  size?: keyof typeof WIDTHS;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full", WIDTHS[size], className)}>{children}</div>
  );
}
