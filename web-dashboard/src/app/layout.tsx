import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Magik Tracker Dashboard",
  description: "Admin dashboard for VA time tracking and monitoring.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
