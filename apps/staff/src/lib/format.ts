// Money is stored in integer minor units (RON bani). The menu shows whole-lei
// prices ("48 lei"); the editor edits lei with up to two decimals.

/** 4800 -> "48 lei" (drops the ,00; keeps a decimal comma when there are bani). */
export function formatPrice(priceMinor: number): string {
  const lei = priceMinor / 100;
  const text = Number.isInteger(lei) ? String(lei) : lei.toFixed(2).replace(".", ",");
  return `${text} lei`;
}

/** "48" or "48,50" / "48.50" -> 4800 / 4850 (minor units). null when unparseable. */
export function parseLeiToMinor(input: string): number | null {
  const normalized = input.trim().replace(",", ".");
  if (normalized === "") return null;
  const lei = Number(normalized);
  if (!Number.isFinite(lei) || lei < 0) return null;
  return Math.round(lei * 100);
}

/** 4800 -> "48" or "48,50" for editing in a text input. */
export function minorToLeiInput(priceMinor: number): string {
  const lei = priceMinor / 100;
  return Number.isInteger(lei) ? String(lei) : lei.toFixed(2).replace(".", ",");
}
