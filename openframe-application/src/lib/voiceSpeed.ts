/** Explain a speed chosen without an explicit request: landed on the
 * line's words a second by measuring its reads (ADR-096), or reused from
 * the take before. */
export function voiceSpeedReport(requested: number | undefined, speed: number, automatic: boolean, inherited = false, landed?: { wps: number; band: [number, number]; reads: number }) {
  if (requested !== undefined || (!automatic && !inherited)) return {};
  if (!automatic) return { speed_chosen: true as const, note: `No speed was supplied; reused the previous take's speed ${speed}.` };
  const on = landed && landed.wps >= landed.band[0] && landed.wps <= landed.band[1];
  return {
    speed_chosen: true as const,
    note: landed
      ? `Speed ${speed} was chosen to land the line on ${landed.band[0]}-${landed.band[1]} words a second: ${landed.wps} over the speech after ${landed.reads} ${landed.reads === 1 ? "read" : "reads"}${on ? "" : ", the nearest the voice came within its natural speeds (0.6-1.3)"}.`
      : `Speed ${speed} was chosen to land the line on its words a second.`,
  };
}
