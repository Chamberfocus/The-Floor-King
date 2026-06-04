import { COMPANY_NAME } from "@/lib/nav";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 bg-muted/40 p-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground text-xl font-bold">
          FK
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{COMPANY_NAME}</h1>
      </div>
      {children}
    </div>
  );
}
