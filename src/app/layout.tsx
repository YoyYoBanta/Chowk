import type { Metadata } from "next";
import { PRODUCT_NAME } from "@/config/branding";
import "./globals.css";

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description: "Multi-tenant WhatsApp team inbox platform.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
