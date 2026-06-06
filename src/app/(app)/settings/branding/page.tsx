import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { getOrgSettings } from "@/lib/data/org";
import { saveBranding } from "./actions";

export const metadata: Metadata = { title: "Branding" };

export default async function BrandingSettingsPage() {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/");
  const org = await getOrgSettings();

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Branding"
        description="Your logo, color, and contact details — shown across the app, the customer portal, and documents."
      />
      <form action={saveBranding} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Identity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="company_name">Company name</Label>
              <Input
                id="company_name"
                name="company_name"
                defaultValue={org.company_name}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="logo">Logo</Label>
              {org.logo_url ? (
                <Image
                  src={org.logo_url}
                  alt="Current logo"
                  width={120}
                  height={48}
                  className="mb-2 h-12 w-auto rounded border bg-white object-contain p-1"
                  unoptimized
                />
              ) : null}
              <Input id="logo" name="logo" type="file" accept="image/*" />
              <p className="text-xs text-muted-foreground">
                PNG or SVG with transparent background works best (max 5 MB).
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="primary_color">Primary color</Label>
              <input
                id="primary_color"
                name="primary_color"
                type="color"
                defaultValue={org.primary_color ?? "#0ea5e9"}
                className="h-9 w-16 rounded border border-input bg-transparent"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contact details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" defaultValue={org.phone ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" defaultValue={org.email ?? ""} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="address">Address</Label>
              <Input
                id="address"
                name="address"
                defaultValue={org.address ?? ""}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit">Save branding</Button>
        </div>
      </form>
    </div>
  );
}
