import type { Metadata } from "next";
import { getPublicBookingConfig } from "@/lib/data/booking";
import { todayLocalYmd } from "@/lib/booking";
import { COMPANY_NAME } from "@/lib/nav";
import { BookingWidget } from "./booking-widget";

export const metadata: Metadata = {
  title: "Book an appointment — Cleveland Floor King",
};

export default async function BookPage() {
  const { settings, types } = await getPublicBookingConfig();
  const today = todayLocalYmd();

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-10">
      <header className="mb-8 text-center">
        <h1 className="text-2xl font-bold">{COMPANY_NAME}</h1>
        <p className="mt-1 text-muted-foreground">
          Book a showroom appointment — we&apos;ll confirm your time shortly.
        </p>
      </header>

      {!settings.booking_enabled || types.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-muted-foreground">
            Online booking is currently unavailable. Please call us at{" "}
            <a href="tel:+12165550100" className="font-medium text-primary">
              (216) 555-0100
            </a>{" "}
            to schedule.
          </p>
        </div>
      ) : (
        <BookingWidget types={types} today={today} />
      )}
    </div>
  );
}
