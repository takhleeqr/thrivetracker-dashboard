import type { Metadata } from "next";
import { BrandProvider } from "@/components/brand-provider";
import "./globals.css";

const rawCompanyName = process.env.APP_COMPANY_NAME || "ThriveTracker";
const companyName = rawCompanyName === "Magik" ? "Magik Tracker" : rawCompanyName;

export const metadata: Metadata = {
  title: `${companyName} Dashboard`,
  description: "Admin dashboard for VA time tracking and monitoring.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <BrandProvider companyName={rawCompanyName}>{children}</BrandProvider>
      </body>
    </html>
  );
}
