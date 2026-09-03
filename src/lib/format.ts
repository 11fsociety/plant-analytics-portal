export function fmt(n: number | null | undefined): string {
  if (n == null) return '-';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export function fmtT(kg: number | null | undefined, digits?: number): string {
  if (kg == null) return '-';
  const t = kg / 1000;
  const d = digits ?? (Math.abs(t) >= 100 ? 1 : 2);
  return t.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }) + ' t';
}

export function toTonnes(kg: number | null | undefined): number | null {
  if (kg == null) return null;
  return kg / 1000;
}
