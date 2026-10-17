# ADR-032: Remove BG runs ormbg on WebGPU, MediaPipe on WASM

- **Date**: 2026-10-16 · **Status**: accepted

## Context

CapCut's Video > Remove BG > Auto removal cuts the person out of a clip.
Here it has to run on the user's machine with no server of ours
([[ADR-003 Desktop first, one build, a platform seam]]), the way captions
run Whisper ([[ADR-007 Auto captions run Whisper on the user's machine]]).
The model is downloaded on first use. Its license must allow distributing
the app under GPL-3.0-only and let users use what they make commercially.
That rules out non-commercial weights. It must also cut out people well,
handle a clear object, and run at a usable speed both with a GPU (WebGPU)
and without one (WASM). transformers.js and onnxruntime-web are already
dependencies, so candidates were limited to ONNX exports they can run.

Licenses were read from each model's own card on 2026-10-16. Speeds are
this machine's (Edge, WebGPU), measured with the app's own worker: the
bg-removal drive's model comparison, a one-off run on four object photos,
and an uncommitted bench from 2026-10-14 (MODNet, BiRefNet, ormbg on WASM).

| Model | Weights license | Download | Result here |
|---|---|---|---|
| **ormbg** (`onnx-community/ormbg-ONNX`, from `schirrmacher/ormbg`), IS-Net/DIS | Apache-2.0 | 88 MB fp16 | 1024²: 74 ms a frame on WebGPU, 13 fps end to end. Every face, jacket, foliage and column point right on the panning portrait, with its raw mattes changing 0.2% frame to frame. Clean cutouts of an apple, a cat and a teapot. Over 5 s a frame on WASM |
| **MediaPipe Selfie Segmentation** (`onnx-community/mediapipe_selfie_segmentation`), Google | Apache-2.0 (Google's model card) | 0.5 MB | 256²: 75 to 94 fps on WASM end to end. Every point right on the portrait, coarser edge. Got the apple and the cat, missed the teapot and the sneakers entirely (it is trained on people) |
| MODNet (`Xenova/modnet`) | Apache-2.0 | 13 MB fp16 | 896×512: 27 to 31 ms on WebGPU. Portrait matting only |
| BiRefNet_lite (`onnx-community/BiRefNet_lite-ONNX`) | MIT | 115 MB fp16 | Failed on this GPU's WebGPU: "Too many storage buffers in shader. Current: 17, Max is 16" |
| BEN2 (`onnx-community/BEN2-ONNX`) | MIT | 219 MB fp16 | Not run: twice ormbg's download for a general-purpose model |
| RMBG-1.4, RMBG-2.0 (BRIA) | CC BY-NC 4.0 | | **Rejected**: non-commercial |
| ISNet (`onnx-community/ISNet-ONNX`) | AGPL-3.0 on that export | 88 MB | Rejected: ormbg has the same architecture under Apache-2.0 |

## Decision

- **ormbg, fp16, on WebGPU** when the adapter has `shader-f16`. It is the
  most accurate model here on people. It also handles a prominent object,
  and it is Apache-2.0.
- **MediaPipe Selfie Segmentation, fp32**, everywhere else: no WebGPU, or
  no fp16 shaders. It runs on WebGPU when there is an adapter, else WASM.
  ormbg on WASM is over 5 s a frame, which is unusable for video.
- **Fallback when ormbg cannot run**: when ormbg fails to start or fails
  on a frame (a driver limit, a corrupt cached file), the light model makes
  the matte on WASM. The toast says it used the light model. A failed
  *download* is not retried with the other model, because that one would
  need the network too. The page tells the two apart by the runtime's
  wording (`isDownloadFailure`, `src/lib/matte.ts`).
- **Download on first use** from huggingface.co. The CSP's `connect-src`
  already lists `huggingface.co`, `*.huggingface.co` and `*.hf.co` for
  Whisper. The browser (or WebView2) caches the weights, so later runs work
  offline. While it downloads, the switch and the AI tools card show
  "Downloading the background model (88 MB)" with progress weighted by
  bytes; cancel stops waiting. A failure says: "Couldn't download the
  background model (88 MB) from Hugging Face. Check the internet connection
  and try again; once downloaded it works offline." The bg-removal drive
  checks that message with Hugging Face blocked.
- **Inference stays in a worker** (`src/engine/matte.worker.ts`), one run at
  a time. After any model failure the page starts a fresh worker:
  transformers.js chains session creation and runs as
  `chain = chain.then(next)`, so one rejection fails every later load in
  that worker with the same error. That is how the first fallback attempt
  failed.

## License notes

- Both models' weights are Apache-2.0, which the FSF lists as compatible
  with GPL-3.0. Users' mattes and exports carry no terms from them. The app
  does not bundle the weights: they are fetched from Hugging Face by the
  user's machine. Should a release bundle them, ship Apache-2.0's text and
  any NOTICE with them ([[Third-party licenses]]).
- ormbg's card lists its training data: the author's synthetic Human
  Segmentation Dataset, P3M-10K, AIM-500, PPM-100 and a BlenderProc
  synthetic set. Those datasets have their own release terms. The weights'
  license comes from the author's Apache-2.0 grant. Whether dataset terms
  reach trained weights is unsettled law, so this is listed for the owner's
  review in [[Release preparation]]. MediaPipe's card says it was trained on
  consented images and excludes surveillance and identity recognition. This
  feature does neither.

## Consequences

- One feature, two looks: without a GPU (or with an old one) the edge is
  coarser and objects other than people are missed. CapCut's own Auto
  removal is described for people, which is the case both models handle.
- A scene with no single subject (a pile of objects) defeats ormbg too.
  Chroma key stays on the same sub-tab for those shots.
- The quality model costs 88 MB once; switching models later is one entry
  in `MATTE_MODELS` (`src/engine/cutout.ts`) plus a rerun of the drive's
  model comparison.
