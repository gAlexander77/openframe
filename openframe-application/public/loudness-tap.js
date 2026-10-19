// The loudness meter's tap (tapLoudness in src/engine/audio.ts): K-weights
// the master bus with the coefficients kWeighting computes for this sample
// rate (BS.1770) and posts each 100 ms step's channel-summed mean square.
// A plain file in public/ because the desktop CSP allows only same-origin
// scripts. The filter loop is LoudnessMeter.push's; change both together.
registerProcessor(
  "loudness-tap",
  class extends AudioWorkletProcessor {
    constructor(o) {
      super();
      this.f = o.processorOptions.filters;
      this.z = [new Float64Array(4), new Float64Array(4)];
      this.hop = Math.round(sampleRate / 10);
      this.acc = 0;
      this.n = 0;
    }
    process(inputs) {
      const input = inputs[0] ?? [];
      const [s, h] = this.f;
      const frames = input[0]?.length ?? 128;
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        // Stereo by the node's explicit channel count: a mono mix arrives on
        // both channels, so it counts twice, as dual mono should.
        for (let ch = 0; ch < 2; ch++) {
          const x = input[ch]?.[i] ?? 0;
          const z = this.z[ch];
          const y1 = s[0] * x + z[0];
          z[0] = s[1] * x - s[3] * y1 + z[1];
          z[1] = s[2] * x - s[4] * y1;
          const y2 = h[0] * y1 + z[2];
          z[2] = h[1] * y1 - h[3] * y2 + z[3];
          z[3] = h[2] * y1 - h[4] * y2;
          sum += y2 * y2;
        }
        this.acc += sum;
        if (++this.n === this.hop) {
          this.port.postMessage(this.acc / this.hop);
          this.acc = this.n = 0;
        }
      }
      return true;
    }
  },
);
