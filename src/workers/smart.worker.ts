/// <reference lib="webworker" />
import { AutoProcessor, RawImage, SamModel, Tensor, env } from '@huggingface/transformers';
import type { SmartPoint, SmartWorkerMessage } from '../lib/smart';

const MODEL_ID = 'Xenova/slimsam-77-uniform';
const context: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

// Avoid SharedArrayBuffer requirements on ordinary Vercel hosting.
if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1;

let loadingModel: Promise<void> | null = null;
type CachedSamModel = Awaited<ReturnType<typeof SamModel.from_pretrained>> & {
  get_image_embeddings: (inputs: any) => Promise<any>;
};
type CachedSamProcessor = Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> & {
  post_process_masks: (...args: any[]) => Promise<any>;
};
let model: CachedSamModel | null = null;
let processor: CachedSamProcessor | null = null;
let processedImage: any = null;
let imageEmbeddings: any = null;
let activeId = -1;
let pending: { id: number; requestId: number; points: SmartPoint[] } | null = null;
let decoding = false;

function send(message: SmartWorkerMessage, transfer: Transferable[] = []) {
  context.postMessage(message, transfer);
}

async function loadModel(id: number, mobile: boolean) {
  if (!loadingModel) {
    loadingModel = (async () => {
      const p = AutoProcessor.from_pretrained(MODEL_ID);
      let m: Awaited<ReturnType<typeof SamModel.from_pretrained>> | null = null;
      // The upstream SlimSAM example supports fp16 WebGPU inference.
      // Try GPU acceleration when available, then reliably fall back to CPU.
      if (!mobile && 'gpu' in navigator) {
        try {
          send({ type: 'progress', id, stage: 'Starting GPU acceleration...' });
          m = await SamModel.from_pretrained(MODEL_ID, {
            dtype: 'fp16',
            device: 'webgpu',
          });
        } catch (error) {
          console.info('Smart Select GPU unavailable, using CPU:', error);
        }
      }
      if (!m) {
        send({ type: 'progress', id, stage: 'Starting optimized CPU mode...' });
        m = await SamModel.from_pretrained(MODEL_ID, {
          dtype: 'q8',
          device: 'wasm',
        });
      }
      model = m as CachedSamModel;
      processor = (await p) as CachedSamProcessor;
    })().catch(error => {
      loadingModel = null;
      throw error;
    });
  }
  send({ type: 'progress', id, stage: 'Loading SlimSAM (~14 MB)...' });
  await loadingModel;
}

async function prepare(id: number, image: Blob, mobile: boolean) {
  activeId = id;
  pending = null;
  processedImage = null;
  imageEmbeddings = null;
  try {
    await loadModel(id, mobile);
    if (id !== activeId) return;
    send({ type: 'progress', id, stage: 'Encoding your image...' });
    const raw = await RawImage.read(image);
    if (id !== activeId) return;
    const prepared = await processor!(raw);
    if (id !== activeId) return;
    const embeddings = await model!.get_image_embeddings(prepared);
    if (id !== activeId) return;
    processedImage = prepared;
    imageEmbeddings = embeddings;
    send({ type: 'ready', id });
  } catch (error) {
    if (id === activeId) send({ type: 'error', id, message: error instanceof Error ? error.message : String(error) });
  }
}

async function processPendingSelections() {
  if (decoding) return;
  decoding = true;
  try {
    while (pending) {
      const request = pending;
      pending = null;
      const { id, requestId, points } = request;
      if (id !== activeId || !model || !processor || !processedImage || !imageEmbeddings || points.length === 0) continue;
      const reshaped = processedImage.reshaped_input_sizes[0];
      const coordinates = points.flatMap(point => [point.x * reshaped[1], point.y * reshaped[0]]);
      const labels = points.map(point => BigInt(point.label));
      const input_points = new Tensor('float32', coordinates, [1, 1, points.length, 2]);
      const input_labels = new Tensor('int64', labels, [1, 1, points.length]);
      const { pred_masks, iou_scores } = await model({
        ...imageEmbeddings,
        input_points,
        input_labels,
      });
      if (id !== activeId || pending) continue;
      const masks = await processor.post_process_masks(
        pred_masks,
        processedImage.original_sizes,
        processedImage.reshaped_input_sizes,
      );
      if (id !== activeId || pending) continue;
      const tensor = masks[0][0]; // [mask candidates, height, width]
      const [count, height, width] = tensor.dims;
      const scores = iou_scores.data;
      let best = 0;
      for (let i = 1; i < count; i++) if (Number(scores[i]) > Number(scores[best])) best = i;
      const pixelCount = width * height;
      const selected = new Uint8Array(pixelCount);
      const start = best * pixelCount;
      for (let i = 0; i < pixelCount; i++) selected[i] = tensor.data[start + i] ? 255 : 0;
      send({ type: 'selection', id, requestId, width, height, score: Number(scores[best]), mask: selected }, [selected.buffer]);
    }
  } catch (error) {
    send({ type: 'error', id: activeId, message: error instanceof Error ? error.message : String(error) });
  } finally {
    decoding = false;
    if (pending) void processPendingSelections();
  }
}

context.onmessage = (event: MessageEvent<
  | { type: 'prepare'; id: number; image: Blob; mobile: boolean }
  | { type: 'segment'; id: number; requestId: number; points: SmartPoint[] }
  | { type: 'reset'; id: number }
>) => {
  const message = event.data;
  if (message.type === 'prepare') {
    void prepare(message.id, message.image, message.mobile);
  } else if (message.type === 'reset') {
    activeId = message.id;
    processedImage = null;
    imageEmbeddings = null;
    pending = null;
  } else if (message.type === 'segment') {
    if (message.id !== activeId) return;
    pending = message;
    void processPendingSelections();
  }
};

export {};
