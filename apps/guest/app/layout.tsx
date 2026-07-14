import type { Metadata } from "next";
import { Fraunces, Instrument_Sans } from "next/font/google";
import "./globals.css";

// Same pairing as the rest of the Desaga surfaces: Fraunces (display) +
// Instrument Sans (body), both latin-ext for Romanian diacritics.
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
  title: "Desaga — Meniu",
  description: "Meniul Restaurantelor Desaga by Euphoria.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ro" className={`${fraunces.variable} ${instrument.variable}`}>
      <body>{children}</body>
    </html>
  );
}
