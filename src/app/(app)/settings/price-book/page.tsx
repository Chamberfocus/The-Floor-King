import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { listPriceBookAccounts } from "@/lib/data/price-book";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PriceBookAccessForm } from "./access-form";
import { setPriceBookActive, updatePriceBookMargin } from "./actions";

export const metadata: Metadata = { title: "Price book logins" };

export default async function PriceBookSettingsPage() {
  const me = await requireProfile();
  if (me.role !== "admin") redirect("/");
  const accounts = await listPriceBookAccounts();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Price book logins"
        description="Each person gets a login and a gross margin. They see what you would sell them the product for. They do not see your cost, and they do not see the rest of the shop."
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">New login</CardTitle>
        </CardHeader>
        <CardContent>
          <PriceBookAccessForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">People with access</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No price-book logins yet.</p>
          ) : (
            accounts.map((account) => (
              <div key={account.profileId} className="flex flex-wrap items-end gap-3 border-b pb-4 last:border-0">
                <div className="min-w-40 flex-1">
                  <p className="font-medium">{account.name || "Unnamed"}</p>
                  <p className="text-sm text-muted-foreground">
                    {account.email || account.phone || "No email or phone"}
                    {account.active ? "" : " · turned off"}
                  </p>
                </div>
                <form action={updatePriceBookMargin} className="flex items-center gap-2">
                  <input type="hidden" name="profile_id" value={account.profileId} />
                  <Input
                    name="margin_pct"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={99.999}
                    step="0.1"
                    defaultValue={String(account.marginPct)}
                    aria-label={`Margin for ${account.name || "this login"}`}
                    className="w-24"
                  />
                  <Button type="submit" size="sm" variant="outline">
                    Save margin
                  </Button>
                </form>
                <form action={setPriceBookActive}>
                  <input type="hidden" name="profile_id" value={account.profileId} />
                  <input type="hidden" name="active" value={account.active ? "false" : "true"} />
                  <Button type="submit" size="sm" variant="ghost">
                    {account.active ? "Turn off" : "Turn on"}
                  </Button>
                </form>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
