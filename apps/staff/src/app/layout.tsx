import type { Metadata } from "next";
import { Fraunces, Instrument_Sans } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

// Display: Fraunces — warm old-style serif with character (opsz + soft), carries
// the heritage-craft personality. Body: Instrument Sans — quiet humanist
// grotesque for UI and running text. Both cover Romanian diacritics. Same setup
// as apps/showcase so the admin matches the guest/staff surfaces exactly.
const fraunces = Fraunces({
  subsets: ["latin-ext"],
  axes: ["opsz", "SOFT", "WONK"],
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

const instrument = Instrument_Sans({
  subsets: ["latin-ext"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Desaga — Pass (control montaj)",
  description:
    "Aplicația de personal: control AI al montajului la pass, pentru Restaurantele Desaga.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ro" className={`${fraunces.variable} ${instrument.variable}`}>
      <body>{children}</body>
    </html>
  );
}
