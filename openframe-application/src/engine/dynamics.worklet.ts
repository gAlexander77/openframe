import { DeesserProcessor, GateEnvelope, LookaheadLimiter } from "../lib/dynamics";
import type { Insert } from "../lib/project/types";
declare const sampleRate: number;
declare class AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, processor: new (options: { processorOptions: Insert }) => AudioWorkletProcessor): void;
registerProcessor("openframe-dynamics", class extends AudioWorkletProcessor {
  private gate?: GateEnvelope;
  private deesser?: DeesserProcessor;
  private limiter?: LookaheadLimiter;
  constructor(options: { processorOptions: Insert }) {
    super();
    const i = options.processorOptions;
    if (i.type === "gate") this.gate = new GateEnvelope(i.params, sampleRate);
    if (i.type === "deesser") this.deesser = new DeesserProcessor(i.params, sampleRate);
    if (i.type === "limiter") this.limiter = new LookaheadLimiter(i.params, sampleRate);
  }
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0] ?? [], output = outputs[0];
    if (this.deesser) this.deesser.process(input, output);
    else if (this.limiter) this.limiter.process(input, output);
    else for (let n = 0; n < output[0].length; n++) {
      let peak = 0;
      for (const ch of input) peak = Math.max(peak, Math.abs(ch[n]));
      const gain = this.gate!.step(peak);
      for (let ch = 0; ch < output.length; ch++) output[ch][n] = (input[ch]?.[n] ?? 0) * gain;
    }
    return true;
  }
});
