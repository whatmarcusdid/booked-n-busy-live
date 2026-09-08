import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ratch } from "./fonts/ratch";
import "./globals.css";
import "@/lib/material/tokens.css";

export const metadata: Metadata = {
  title: "Booked N Busy Live",
  description: "Live booking product",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={ratch.variable}>
      <body>
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
