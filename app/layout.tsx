import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { canonicalOrigin, PRODUCT_NAME } from "@/lib/identity";
import { ratch } from "./fonts/ratch";
import "./globals.css";
import "@/lib/material/tokens.css";

export const metadata: Metadata = {
  metadataBase: new URL(canonicalOrigin()),
  title: PRODUCT_NAME,
  description:
    "Find out whether your website is helping or hurting your business. Free speed, security, and SEO diagnostic for home-service businesses.",
  applicationName: PRODUCT_NAME,
  alternates: { canonical: "/" },
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
