import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import styles from "./layout.module.css";

export const metadata: Metadata = {
  title: "Boca — Control montaj",
  description: "Evaluare AI a conformității montajului pe farfurie",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ro">
      <body>
        <header className={styles.header}>
          <div className={styles.headerInner}>
            <span className={styles.wordmark}>BOCA</span>
            <span className={styles.headerRule} aria-hidden />
            <span className={styles.headerSub}>Control calitate montaj</span>
          </div>
        </header>
        <main className={styles.main}>{children}</main>
      </body>
    </html>
  );
}
