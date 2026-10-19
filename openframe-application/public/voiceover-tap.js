// The voiceover recorder's tap (src/state/voiceover.ts): hands each block of
// microphone samples to the page with the audio-clock time of its first
// sample, which places the recording against the timeline exactly. A plain
// file in public/ because the desktop CSP allows only same-origin scripts.
registerProcessor(
  "voiceover-tap",
  class extends AudioWorkletProcessor {
    process(inputs) {
      const input = inputs[0];
      if (input && input.length) this.port.postMessage({ t: currentTime, data: input.map((c) => c.slice()) });
      return true;
    }
  },
);
