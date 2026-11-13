export type Frame = {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
};

export type BrushMode = 'erase' | 'restore';

const MAX_DIMENSION = 2800;
const MAX_PIXELS = 8_000_000;

export async function decodeImage(file: Blob): Promise<Frame> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(
    1,
    MAX_DIMENSION / Math.max(bitmap.width, bitmap.height),
    Math.sqrt(MAX_PIXELS / (bitmap.width * bitmap.height)),
  );
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    throw new Error('Your browser does not support Canvas image processing.');
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const pixels = context.getImageData(0, 0, width, height).data;
  return { width, height, pixels };
}

export function floodRegion(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  tolerance: number,
): Uint8Array {
  const count = width * height;
  const region = new Uint8Array(count);
  if (x < 0 || y < 0 || x >= width || y >= height) return region;
  const start = Math.floor(y) * width + Math.floor(x);
  const offset = start * 4;
  const sr = pixels[offset];
  const sg = pixels[offset + 1];
  const sb = pixels[offset + 2];
  const sa = pixels[offset + 3];
  const limit = Math.pow(5 + (Math.max(0, Math.min(100, tolerance)) / 100) * 215, 2);
  const visited = new Uint8Array(count);
  const queue = new Int32Array(count);
  let head = 0;
  let tail = 1;
  queue[0] = start;
  visited[start] = 1;

  while (head < tail) {
    const index = queue[head++];
    const i = index * 4;
    const dr = pixels[i] - sr;
    const dg = pixels[i + 1] - sg;
    const db = pixels[i + 2] - sb;
    const da = pixels[i + 3] - sa;
    const diff = (0.32 * dr * dr + 0.54 * dg * dg + 0.14 * db * db) + 0.3 * da * da;
    if (diff > limit) continue;
    region[index] = 255;

    const xx = index % width;
    const yy = (index / width) | 0;
    if (xx > 0 && !visited[index - 1]) { visited[index - 1] = 1; queue[tail++] = index - 1; }
    if (xx + 1 < width && !visited[index + 1]) { visited[index + 1] = 1; queue[tail++] = index + 1; }
    if (yy > 0 && !visited[index - width]) { visited[index - width] = 1; queue[tail++] = index - width; }
    if (yy + 1 < height && !visited[index + width]) { visited[index + width] = 1; queue[tail++] = index + width; }
  }
  return region;
}

export function featherMask(input: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const r = Math.max(0, Math.min(12, Math.round(radius)));
  if (r === 0) return input;
  const intermediate = new Float32Array(input.length);
  const output = new Uint8Array(input.length);

  for (let y = 0; y < height; y++) {
    let sum = 0;
    const offset = y * width;
    for (let dx = -r; dx <= r; dx++) sum += input[offset + Math.min(width - 1, Math.max(0, dx))];
    for (let x = 0; x < width; x++) {
      intermediate[offset + x] = sum / (r * 2 + 1);
      sum -= input[offset + Math.max(0, x - r)];
      sum += input[offset + Math.min(width - 1, x + r + 1)];
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let dy = -r; dy <= r; dy++) sum += intermediate[Math.min(height - 1, Math.max(0, dy)) * width + x];
    for (let y = 0; y < height; y++) {
      output[y * width + x] = Math.round(sum / (r * 2 + 1));
      sum -= intermediate[Math.max(0, y - r) * width + x];
      sum += intermediate[Math.min(height - 1, y + r + 1) * width + x];
    }
  }
  return output;
}

export function wandSelect(
  frame: Frame,
  mask: Uint8Array,
  x: number,
  y: number,
  tolerance: number,
  feather: number,
  mode: BrushMode,
): Uint8Array {
  let region = floodRegion(frame.pixels, frame.width, frame.height, x, y, tolerance);
  if (feather > 0) region = featherMask(region, frame.width, frame.height, feather);
  const next = mask.slice();
  for (let i = 0; i < next.length; i++) {
    if (mode === 'erase') next[i] = Math.max(next[i], region[i]);
    else next[i] = Math.min(next[i], 255 - region[i]);
  }
  return next;
}

export function stampBrush(
  mask: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
  softness: number,
  mode: BrushMode,
): void {
  const r = Math.max(1, radius);
  const inner = r * (1 - Math.max(0, Math.min(1, softness)));
  const left = Math.max(0, Math.floor(x - r));
  const right = Math.min(width - 1, Math.ceil(x + r));
  const top = Math.max(0, Math.floor(y - r));
  const bottom = Math.min(height - 1, Math.ceil(y + r));
  for (let py = top; py <= bottom; py++) {
    for (let px = left; px <= right; px++) {
      const distance = Math.hypot(px + 0.5 - x, py + 0.5 - y);
      if (distance > r) continue;
      const strength = distance <= inner ? 1 : Math.max(0, 1 - (distance - inner) / Math.max(0.001, r - inner));
      const value = Math.round(255 * strength);
      const index = py * width + px;
      if (mode === 'erase') mask[index] = Math.max(mask[index], value);
      else mask[index] = Math.min(mask[index], 255 - value);
    }
  }
}

export function composeImage(frame: Frame, mask: Uint8Array, original = false): ImageData {
  const data = new Uint8ClampedArray(frame.pixels);
  if (!original) {
    for (let i = 0; i < mask.length; i++) {
      const alpha = i * 4 + 3;
      data[alpha] = Math.round(data[alpha] * (255 - mask[i]) / 255);
    }
  }
  return new ImageData(data, frame.width, frame.height);
}

export function trimBounds(frame: Frame, mask: Uint8Array): { x: number; y: number; width: number; height: number } {
  let left = frame.width, top = frame.height, right = -1, bottom = -1;
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const index = y * frame.width + x;
      if (frame.pixels[index * 4 + 3] * (255 - mask[index]) <= 255) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right === -1) return { x: 0, y: 0, width: frame.width, height: frame.height };
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export async function pngBlob(frame: Frame, mask: Uint8Array, trim: boolean): Promise<Blob> {
  const source = document.createElement('canvas');
  source.width = frame.width;
  source.height = frame.height;
  const sourceContext = source.getContext('2d');
  if (!sourceContext) throw new Error('Could not export image.');
  sourceContext.putImageData(composeImage(frame, mask), 0, 0);
  const bounds = trim ? trimBounds(frame, mask) : { x: 0, y: 0, width: frame.width, height: frame.height };
  const output = document.createElement('canvas');
  output.width = bounds.width;
  output.height = bounds.height;
  const outputContext = output.getContext('2d');
  if (!outputContext) throw new Error('Could not export image.');
  outputContext.drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
  return new Promise((resolve, reject) => output.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG encoding failed.')), 'image/png'));
}

export async function frameToBlob(frame: Frame): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare image for AI.');
  context.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not encode image.')), 'image/png'));
}

export async function alphaMaskFromBlob(blob: Blob, frame: Frame): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    throw new Error('Could not read AI mask.');
  }
  context.drawImage(bitmap, 0, 0, frame.width, frame.height);
  bitmap.close();
  const rgba = context.getImageData(0, 0, frame.width, frame.height).data;
  const result = new Uint8Array(frame.width * frame.height);
  for (let i = 0; i < result.length; i++) result[i] = 255 - rgba[i * 4 + 3];
  return result;
}
