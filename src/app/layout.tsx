import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { PRODUCT_NAME } from "@/config/branding";
import "./globals.css";

// Every component in src/app/(dashboard)/** sets fontFamily: "'Inter', ..."
// but nothing ever actually loaded Inter — the whole app has been silently
// falling back to the system UI font the entire time. next/font/google
// self-hosts the face (no external request at runtime, no layout shift)
// and exposes it as a CSS variable wired into globals.css below.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description: "Multi-tenant WhatsApp team inbox platform.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
