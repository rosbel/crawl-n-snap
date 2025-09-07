export function parseResolutions(input: string): string[] {
  if (!input) return [];
  return input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.toLowerCase())
    .map((s) => (s.includes('x') ? s : s.replace(/\s+/g, '')));
}

export function clampNumber(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}
