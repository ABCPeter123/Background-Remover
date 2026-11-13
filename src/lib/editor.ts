export type Frame = {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
};

export type BrushMode = 'erase' | 'restore';

const MAX_DIMENSION = 2800;
const MAX_PIXELS = 8_000_000;

export type ImageLimits = { maxDimension: number; maxPixels: number };

/** Phones should never create a multi-megapixel editing canvas in Safari. */
export function imageLimitsForDevice(coarsePointer: boolean): ImageLimits {
  return coarsePointer
    ? { maxDimension: 1600, maxPixels: 2_000_000 }
    : { maxDimension: MAX_DIMENSION, maxPixels: MAX_PIXELS };
}

export function scaledSize(width: number, height: number, limits: ImageLimits) {
  const scale = Math.min(
    1,
    limits.maxDimension / Math.max(width, height),
    Math.sqrt(limits.maxPixels / (width * height)),
  );
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

export function isMobileDevice(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse) and (max-width: 1024px)').matches;
}

/**
 * Decode with an Image element first on phones. iOS browsers may not support
 * createImageBitmap for all photo formats, including HEIC/HEIF. Drawing the
 * browser-decoded image into a bounded canvas avoids huge editing surfaces.
 */
async function decodeUsingImageElement(blob: Blob, limits: ImageLimits): Promise<Frame> {
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Your browser cannot open this image. Try a JPEG or PNG.'));
      element.src = url;
    });
    const size = scaledSize(image.naturalWidth, image.naturalHeight, limits);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Your browser cannot create an image editing canvas.');
    context.drawImage(image, 0, 0, size.width, size.height);
    return { ...size, pixels: context.getImageData(0, 0, size.width, size.height).data };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function decodeImage(file: Blob): Promise<Frame> {
  const mobile = isMobileDevice();
  const limits = imageLimitsForDevice(mobile);
  // Safari's native Image decoder supports formats that createImageBitmap rejects.
  if (mobile || typeof createImageBitmap !== 'function') {
    return decodeUsingImageElement(file, limits);
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return decodeUsingImageElement(file, limits);
  }
  try {
    const size = scaledSize(bitmap.width, bitmap.height, limits);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Your browser does not support Canvas image processing.');
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    return { ...size, pixels: context.getImageData(0, 0, size.width, size.height).data };
  } finally {
    bitmap.close();
  }
}

type FloodResult = {
  region: Uint8Array;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

// Span-based flood fill needs no full-image Int32 queue. It is considerably
// faster for broad, contiguous regions such as sky or studio backgrounds.
function scanFloodRegion(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  tolerance: number,
): FloodResult {
  const count = width * height;
  const region = new Uint8Array(count);
  const empty: FloodResult = { region, left: 0, top: 0, right: 0, bottom: 0 };
  if (x < 0 || y < 0 || x >= width || y >= height) return empty;
  const seed = Math.floor(y) * width + Math.floor(x);
  const offset = seed * 4;
  const sr = pixels[offset];
  const sg = pixels[offset + 1];
  const sb = pixels[offset + 2];
  const sa = pixels[offset + 3];
  const limit = (5 + (Math.max(0, Math.min(100, tolerance)) / 100) * 215) ** 2;
  const visited = new Uint8Array(count);
  const matches = (index: number): boolean => {
    const p = index * 4;
    const dr = pixels[p] - sr;
    const dg = pixels[p + 1] - sg;
    const db = pixels[p + 2] - sb;
    const da = pixels[p + 3] - sa;
    return 0.32 * dr * dr + 0.54 * dg * dg + 0.14 * db * db + 0.3 * da * da <= limit;
  };
  const stack: number[] = [seed];
  let left = width;
  let top = height;
  let right = 0;
  let bottom = 0;
  while (stack.length > 0) {
    const start = stack.pop()!;
    if (visited[start]) continue;
    const row = Math.floor(start / width);
    const rowStart = row * width;
    let col = start - rowStart;
    if (!matches(start)) {
      visited[start] = 1;
      continue;
    }
    while (col > 0 && !visited[rowStart + col - 1] && matches(rowStart + col - 1)) col--;
    const rowLeft = col;
    let aboveRun = false;
    let belowRun = false;
    for (; col < width; col++) {
      const index = rowStart + col;
      if (visited[index]) break;
      if (!matches(index)) {
        visited[index] = 1;
        break;
      }
      visited[index] = 1;
      region[index] = 255;
      if (row > 0) {
        const above = index - width;
        if (!visited[above] && matches(above)) {
          if (!aboveRun) stack.push(above);
          aboveRun = true;
        } else {
          aboveRun = false;
        }
      }
      if (row + 1 < height) {
        const below = index + width;
        if (!visited[below] && matches(below)) {
          if (!belowRun) stack.push(below);
          belowRun = true;
        } else {
          belowRun = false;
        }
      }
    }
    left = Math.min(left, rowLeft);
    right = Math.max(right, col);
    top = Math.min(top, row);
    bottom = Math.max(bottom, row + 1);
  }
  return { region, left, top, right, bottom };
}

export function floodRegion(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  tolerance: number,
): Uint8Array {
  return scanFloodRegion(pixels, width, height, x, y, tolerance).region;
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

export function wandSelectWithBounds(
  frame: Frame,
  mask: Uint8Array,
  x: number,
  y: number,
  tolerance: number,
  feather: number,
  mode: BrushMode,
): { mask: Uint8Array; bounds: { left: number; top: number; right: number; bottom: number } } {
  const selected = scanFloodRegion(frame.pixels, frame.width, frame.height, x, y, tolerance);
  const next = mask.slice();
  if (selected.right <= selected.left || selected.bottom <= selected.top)
    return { mask: next, bounds: { left: 0, top: 0, right: 0, bottom: 0 } };

  const radius = Math.max(0, Math.min(12, Math.round(feather)));
  const left = Math.max(0, selected.left - radius);
  const top = Math.max(0, selected.top - radius);
  const right = Math.min(frame.width, selected.right + radius);
  const bottom = Math.min(frame.height, selected.bottom + radius);
  const width = right - left;
  const height = bottom - top;

  // Feather only the selection's bounding rectangle instead of the full image.
  let local: Uint8Array | null = null;
  if (radius > 0) {
    const cropped = new Uint8Array(width * height);
    for (let yy = selected.top; yy < selected.bottom; yy++) {
      const src = yy * frame.width + selected.left;
      const dst = (yy - top) * width + (selected.left - left);
      cropped.set(selected.region.subarray(src, src + selected.right - selected.left), dst);
    }
    local = featherMask(cropped, width, height, radius);
  }

  for (let yy = top; yy < bottom; yy++) {
    const rowOffset = yy * frame.width + left;
    const localOffset = (yy - top) * width;
    for (let xx = 0; xx < width; xx++) {
      const index = rowOffset + xx;
      const strength = local ? local[localOffset + xx] : selected.region[index];
      if (!strength) continue;
      if (mode === 'erase') next[index] = Math.max(next[index], strength);
      else next[index] = Math.min(next[index], 255 - strength);
    }
  }
  return { mask: next, bounds: { left, top, right, bottom } };
}

export function wandSelect(
  frame: Frame, mask: Uint8Array, x: number, y: number,
  tolerance: number, feather: number, mode: BrushMode,
): Uint8Array {
  return wandSelectWithBounds(frame, mask, x, y, tolerance, feather, mode).mask;
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

/**
 * Compose only the pixels touched by a brush stroke. Creating a small patch
 * avoids repainting 8 million pixels on every pointer move.
 */
export function composeRegion(
  frame: Frame, mask: Uint8Array,
  left: number, top: number, width: number, height: number,
  original = false,
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) {
    const sourcePixel = (top + row) * frame.width + left;
    const destinationByte = row * width * 4;
    output.set(frame.pixels.subarray(sourcePixel * 4, (sourcePixel + width) * 4), destinationByte);
    if (original) continue;
    for (let col = 0; col < width; col++) {
      const maskIndex = sourcePixel + col;
      const index = destinationByte + col * 4 + 3;
      output[index] = Math.round(output[index] * (255 - mask[maskIndex]) / 255);
    }
  }
  return output;
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
  if (!trim) {
    return new Promise((resolve, reject) =>
      source.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG encoding failed.')), 'image/png'));
  }
  const bounds = trimBounds(frame, mask);
  const output = document.createElement('canvas');
  output.width = bounds.width;
  output.height = bounds.height;
  const outputContext = output.getContext('2d');
  if (!outputContext) throw new Error('Could not export image.');
  outputContext.drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
  return new Promise((resolve, reject) => output.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG encoding failed.')), 'image/png'));
}

export async function frameToBlob(frame: Frame, maxDimension = Infinity): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare image for AI.');
  context.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0);
  const scale = Math.min(1, maxDimension / Math.max(frame.width, frame.height));
  const output = scale < 1 ? document.createElement('canvas') : canvas;
  if (output !== canvas) {
    output.width = Math.max(1, Math.round(frame.width * scale));
    output.height = Math.max(1, Math.round(frame.height * scale));
    const ctx = output.getContext('2d');
    if (!ctx) throw new Error('Could not resize image for AI.');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, output.width, output.height);
  }
  return new Promise((resolve, reject) => output.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not encode image.')), 'image/png'));
}

export async function alphaMaskFromBlob(blob: Blob, frame: Frame): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Could not read AI mask.');
  if (isMobileDevice() || typeof createImageBitmap !== 'function') {
    const url = URL.createObjectURL(blob);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('Could not decode the AI result.'));
        element.src = url;
      });
      context.drawImage(image, 0, 0, frame.width, frame.height);
    } finally {
      URL.revokeObjectURL(url);
    }
  } else {
    const bitmap = await createImageBitmap(blob);
    try {
      context.drawImage(bitmap, 0, 0, frame.width, frame.height);
    } finally {
      bitmap.close();
    }
  }
  const rgba = context.getImageData(0, 0, frame.width, frame.height).data;
  const result = new Uint8Array(frame.width * frame.height);
  for (let i = 0; i < result.length; i++) result[i] = 255 - rgba[i * 4 + 3];
  return result;
}
