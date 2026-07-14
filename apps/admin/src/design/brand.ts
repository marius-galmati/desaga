export const BRAND = {
  name: "Desaga",
  full: "Restaurantele Desaga by Euphoria",
  tagline: "Gust Autentic",
  promise: "Peste 100 de preparate tradiționale din bucătăria românească și maghiară",
  locations: ["Cluj-Napoca", "Topa Mică"],
  greeting: "No, zîua bună!",
} as const;

/** Verdict thresholds shared across the AI report and dashboards. */
export function verdict(score: number): {
  key: "conform" | "minor" | "abateri" | "neconform";
  label: string;
  tone: string;
  wash: string;
} {
  if (score >= 4.5)
    return {
      key: "conform",
      label: "Conform cu standardul",
      tone: "var(--pine)",
      wash: "var(--pine-wash)",
    };
  if (score >= 3.5)
    return {
      key: "minor",
      label: "Conform, cu observații minore",
      tone: "var(--pine-soft)",
      wash: "var(--pine-wash)",
    };
  if (score >= 2.5)
    return {
      key: "abateri",
      label: "Abateri vizibile",
      tone: "var(--ochre)",
      wash: "var(--ochre-wash)",
    };
  return {
    key: "neconform",
    label: "Neconform — necesită replatare",
    tone: "var(--vin)",
    wash: "var(--vin-wash)",
  };
}

/** RO decimal comma, one place. */
export function ro1(n: number): string {
  return n.toFixed(1).replace(".", ",");
}
