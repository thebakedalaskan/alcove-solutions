/*
 * The matte's model, in a worker of its own (segmenter.ts starts it): MediaPipe's multiclass selfie segmenter, on this
 * device, on a WebGL2 canvas that belongs to the worker. Compiling the model's shaders takes seconds the first time on a
 * phone, and reading each mask back waits on the GPU; here neither holds up the page. Where the browser reads camera frames
 * off a playing element (WebKit, so every browser on an iPhone), the whole background ran on the page's own thread, and
 * choosing one froze the screen while the shaders compiled.
 *
 * The page sends a 256×256 picture of a frame at a time, already the right way up, and gets back how sure the model is that
 * each pixel is the person. Nothing leaves the device.
 */
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

/**
 * From the page: start with these files (all from this origin), saying whether the page's document has touch events, or
 * segment one frame.
 */
export type SegmenterAsk =
  | { kind: 'start'; wasm: string; model: string; touch: boolean }
  | { kind: 'frame'; image: ImageBitmap; at: number; seq: number };
/** To the page: ready to segment (shaders compiled), one frame's mask, or why it stopped. */
export type SegmenterAnswer =
  | { kind: 'ready' }
  | { kind: 'mask'; mask: Float32Array; seq: number }
  | { kind: 'failed'; message: string };

/** The model's own input size, and the mask's. */
const SIZE = 256;

let segmenter: ImageSegmenter | null = null;
let stopped = false;

const answer = (a: SegmenterAnswer, transfer: Transferable[] = []) => { self.postMessage(a, { transfer }); };
const said = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : 'The background model failed.').slice(0, 300);
const fail = (e: unknown) => { stopped = true; answer({ kind: 'failed', message: said(e) }); };

/**
 * MediaPipe's WebAssembly loader is a classic script that sets a global factory, and it's loaded with importScripts, which a
 * module worker doesn't have. Imported as a module instead, its last lines hand the factory to an AMD `define`, which is
 * caught here and set where MediaPipe looks for it. A module runs in strict mode, where the loader's own debug printer (a
 * function declared inside an `if`) isn't there when it's called: given a `dbg`, the loader uses that instead, and the
 * model's debug lines go nowhere.
 */
async function loadFactory(loader: string): Promise<void> {
  let factory: unknown = null;
  const define = (_deps: unknown, make: unknown) => { if (typeof make === 'function') factory = make(); };
  Reflect.set(define, 'amd', true);
  Reflect.set(self, 'define', define);
  Reflect.set(self, 'dbg', () => undefined);
  try {
    await import(/* @vite-ignore */ loader);
  } finally {
    Reflect.deleteProperty(self, 'define');
  }
  if (typeof factory !== 'function') throw new Error('The background model’s loader didn’t load.');
  Reflect.set(self, 'ModuleFactory', factory);
}

/** How sure the model is that each pixel of `image` is the person: everything but the background, hair included. */
function personIn(s: ImageSegmenter, image: ImageBitmap, at: number): Float32Array {
  const got: { mask: Float32Array | null } = { mask: null };
  // Background, hair, body skin, face skin, clothes, other. The masks only live inside this callback, so it's copied out
  // (by the `map`).
  s.segmentForVideo(image, at, (result) => { got.mask = result.confidenceMasks?.[0]?.getAsFloat32Array().map((v) => 1 - v) ?? null; });
  if (!got.mask) throw new Error('The segmenter gave no mask.');
  return got.mask;
}

async function start(wasm: string, model: string, touch: boolean): Promise<void> {
  // Reading a mask back, MediaPipe tells an iPad from a Mac by `"ontouchend" in self.document`, which throws in a worker,
  // where there's no document: it's given one that answers as the page's does. Nothing else of MediaPipe's that runs here
  // looks at it.
  Reflect.set(self, 'document', touch ? { ontouchend: null } : {});
  const simd = await FilesetResolver.isSimdSupported();
  const name = simd ? 'vision_wasm_internal' : 'vision_wasm_nosimd_internal';
  await loadFactory(`${wasm}/${name}.js`);
  // No loader path: the factory is already where MediaPipe looks, so it doesn't try importScripts.
  const s = await ImageSegmenter.createFromOptions({ wasmLoaderPath: '', wasmBinaryPath: `${wasm}/${name}.wasm` }, {
    baseOptions: { modelAssetPath: model, delegate: 'GPU' },
    canvas: new OffscreenCanvas(1, 1),
    runningMode: 'VIDEO',
    outputConfidenceMasks: true,
    outputCategoryMask: false
  });
  // The first frame compiles the shaders. A blank one does it now, so the page's first frame is answered at once. Its time
  // is before any frame's from the page (the page's clock), as the model needs them in order.
  const blank = new OffscreenCanvas(SIZE, SIZE);
  blank.getContext('2d')?.fillRect(0, 0, SIZE, SIZE);
  const image = blank.transferToImageBitmap();
  try { personIn(s, image, 0); } finally { image.close(); }
  segmenter = s;
  answer({ kind: 'ready' });
}

function isAsk(v: unknown): v is SegmenterAsk {
  if (typeof v !== 'object' || v === null || !('kind' in v)) return false;
  if (v.kind === 'frame') return 'image' in v && v.image instanceof ImageBitmap && 'at' in v && typeof v.at === 'number' && 'seq' in v && typeof v.seq === 'number';
  return v.kind === 'start' && 'wasm' in v && typeof v.wasm === 'string' && 'model' in v && typeof v.model === 'string' && 'touch' in v && typeof v.touch === 'boolean';
}

self.onmessage = (e: MessageEvent<unknown>) => {
  const ask = e.data;
  if (!isAsk(ask) || stopped) {
    if (isAsk(ask) && ask.kind === 'frame') ask.image.close();
    return;
  }
  if (ask.kind === 'start') { start(ask.wasm, ask.model, ask.touch).catch(fail); return; }
  const s = segmenter;
  try {
    if (!s) throw new Error('The segmenter isn’t ready.');
    const mask = personIn(s, ask.image, ask.at);
    answer({ kind: 'mask', mask, seq: ask.seq }, [mask.buffer]);
  } catch (err) {
    fail(err);
  } finally {
    ask.image.close();
  }
};
