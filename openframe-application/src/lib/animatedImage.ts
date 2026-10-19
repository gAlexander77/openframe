/** Half-open frame intervals; exact loop boundaries select frame zero. */
export function animatedFrameAt(durations: readonly number[], seconds: number): number {
  const total = durations.reduce((a, b) => a + b, 0);
  if (!(total > 0) || !Number.isFinite(seconds)) return 0;
  let t = ((seconds % total) + total) % total;
  for (let i = 0; i < durations.length; i++) { if (t < durations[i] - 1e-9) return i; t -= durations[i]; }
  return 0;
}
