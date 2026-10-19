/** Post-fader dBFS levels of one sampled audio block. */
export function meterLevels(samples: Float32Array): { peak: number; rms: number } {
  let peak = 0, sum = 0;
  for (const x of samples) { peak = Math.max(peak, Math.abs(x)); sum += x * x; }
  return { peak: peak ? 20 * Math.log10(peak) : -Infinity, rms: sum ? 10 * Math.log10(sum / samples.length) : -Infinity };
}
