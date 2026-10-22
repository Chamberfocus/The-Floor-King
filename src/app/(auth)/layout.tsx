import { COMPANY_NAME } from "@/lib/nav";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 bg-background p-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex size-11 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
          FK
        </div>
        <h1 className="text-lg font-semibold tracking-tight">{COMPANY_NAME}</h1>
        <p className="text-sm text-muted-foreground">Customers, estimates, and installs in one file.</p>
      </div>
      {children}
    </div>
  );
}
