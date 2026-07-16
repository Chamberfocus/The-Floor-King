import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { getShowroomSettings, listAppointmentTypes } from "@/lib/data/booking";
import { siteUrl } from "@/lib/notify";
import { ShowroomHoursForm } from "./showroom-hours-form";
import { AppointmentTypesManager } from "./appointment-types-manager";

export const metadata: Metadata = { title: "Showroom & calendar" };

export default async function ShowroomSettingsPage() {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/");

  const [settings, types] = await Promise.all([
    getShowroomSettings(),
    listAppointmentTypes(),
  ]);

  const bookUrl = `${siteUrl()}/book`;

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/settings"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to settings
      </Link>
      <PageHeader
        title="Showroom & calendar"
        description="By-appointment showroom: set your hours and capacity, and the appointment types customers can book."
      />

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base">Public booking link</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-2 text-sm text-muted-foreground">
            Share this link so clients can request an appointment. Requests land
            on your calendar as pending until you confirm them.
          </p>
          <a
            href="/book"
            target="_blank"
            className="inline-flex items-center gap-1 break-all text-sm font-medium text-primary hover:underline"
          >
            {bookUrl} <ExternalLink className="size-3.5" />
          </a>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base">Showroom hours & capacity</CardTitle>
        </CardHeader>
        <CardContent>
          <ShowroomHoursForm settings={settings} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Appointment types</CardTitle>
        </CardHeader>
        <CardContent>
          <AppointmentTypesManager types={types} />
        </CardContent>
      </Card>
    </div>
  );
}
