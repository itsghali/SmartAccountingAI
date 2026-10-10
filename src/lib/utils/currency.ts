import Decimal from "decimal.js";

export function formatMAD(value: number | string | Decimal): string {
  const num = typeof value === "object" ? value.toNumber() : Number(value);
  return new Intl.NumberFormat("fr-MA", {
    style: "decimal",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export function formatMADWithCurrency(value: number | string | Decimal): string {
  return `${formatMAD(value)} MAD`;
}

export function parseMADInput(input: string): Decimal {
  // Remove spaces and replace comma with dot
  const cleaned = input.replace(/\s/g, "").replace(",", ".");
  return new Decimal(cleaned || "0");
}
