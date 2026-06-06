"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import type { OrgSettings } from "@/lib/types";
import { saveBranding } from "./actions";

export function BrandingForm({ org }: { org: OrgSettings }) {
  const router = useRouter();
  const [logoUrl, setLogoUrl] = useState(org.logo_url);
  const [saving, startSaving] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const save = () =>
    startSaving(async () => {
      try {
        let url = logoUrl;
        const f = fileRef.current?.files?.[0];
        if (f) {
          const supabase = createClient();
          const ext = f.name.split(".").pop() || "png";
          const path = `logo-${crypto.randomUUID()}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from("branding")
            .upload(path, f, {
              contentType: f.type || "image/png",
              upsert: true,
            });
          if (upErr) {
            toast.error(`Logo upload failed: ${upErr.message}`);
            return;
          }
          url = supabase.storage.from("branding").getPublicUrl(path).data
            .publicUrl;
          setLogoUrl(url);
        }
        const fd = new FormData(formRef.current!);
        if (url) fd.set("logo_url", url);
        const res = await saveBranding({ error: null }, fd);
        if (res.error) {
          toast.error(res.error);
          return;
        }
        toast.success("Branding saved");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Save failed.");
      }
    });

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="space-y-6"
    >
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
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt="Current logo"
                className="mb-2 h-12 w-auto rounded border bg-white object-contain p-1"
              />
            ) : null}
            <Input id="logo" name="logo" type="file" accept="image/*" />
            <p className="text-xs text-muted-foreground">
              PNG or SVG with a transparent background works best.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="primary_color">Primary color</Label>
            <input
              id="primary_color"
              name="primary_color"
              type="color"
              defaultValue={org.primary_color ?? "#b51a00"}
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
            <Input id="address" name="address" defaultValue={org.address ?? ""} />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save branding"}
        </Button>
      </div>
    </form>
  );
}
