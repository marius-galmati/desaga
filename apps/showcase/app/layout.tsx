import type { Metadata } from "next";
import { Fraunces, Instrument_Sans } from "next/font/google";
import "./globals.css";

// Display: Fraunces — warm old-style serif with character (opsz + soft),
// carries the heritage-craft personality. Body: Instrument Sans — quiet
// humanist grotesque for UI and running text. Both cover Romanian diacritics.
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
  title: "Desaga — Experiența digitală",
  description:
    "Prototip: aplicația de oaspeți, personal, management și controlul AI al montajului pentru Restaurantele Desaga by Euphoria.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ro" className={`${fraunces.variable} ${instrument.variable}`}>
      <body>{children}</body>
    </html>
  );
}
