/** Explain a speed chosen without an explicit request. */
export function voiceSpeedReport(requested: number | undefined, speed: number, automatic: boolean, inherited = false) {
  if (requested !== undefined || (!automatic && !inherited)) return {};
  return { speed_chosen: true as const, note: automatic
    ? `The rushed-line rule chose speed ${speed} to give the words more time.`
    : `No speed was supplied; reused the previous take's speed ${speed}.` };
}
