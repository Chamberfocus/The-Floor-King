import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { APP_NAME, COMPANY_NAME } from "@/lib/nav";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} — ${COMPANY_NAME}`,
    template: `%s · ${APP_NAME}`,
  },
  description: `Business management system for ${COMPANY_NAME}.`,
  applicationName: APP_NAME,
  // Native-app feel when installed to the home screen on iOS.
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Floor King",
  },
  formatDetection: { telephone: false },
};

// Mobile rendering: fill the device width, respect notches (viewport-fit:cover),
// and tint the browser/status bar to match the app.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Warm ivory to match the light app ground (was near-black for dark mode).
  themeColor: "#ece7dd",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
