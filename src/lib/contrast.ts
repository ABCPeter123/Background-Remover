/**
 * A preprocessing-only tone adjustment for foreground segmentation.
 *
 * Light-on-light photos are often poorly separated by the foreground model.
 * We stretch luminance around the upper brightness percentile and sharpen
 * small local differences before inference. The original image is NEVER
 * modified; the model's resulting alpha mask is applied to original pixels.
 *
 * This is deliberately not a generic color filter or a replacement for a
 * stronger segmentation model. Strong mode exists for difficult photos.
 */
export type ContrastAssistMode = 'auto' | 'strong' | 'off';

export interface ContrastMetrics {
  p10: number;
  p50: number;
  p90: number;
  brightFraction: number;
  lowContrast: boolean;
  highKey: boolean;
}

export interface EnhancedInput {
  pixels: Uint8ClampedArray;
  applied: boolean;
  metrics: ContrastMetrics;
}

function luminance(r: number, g: number, b: number): number {
  return (54 * r + 183 * g + 19 * b + 128) >> 8;
}

function percentile(hist: Uint32Array, count: number, fraction: number): number {
  const target = Math.max(1, Math.ceil(count * fraction));
  let cumulative = 0;
  for (let value = 0; value < 256; value++) {
    cumulative += hist[value];
    if (cumulative >= target) return value;
  }
  return 255;
}

export function measureContrast(pixels: Uint8ClampedArray, width: number, height: number): ContrastMetrics {
  if (pixels.length !== width * height * 4) throw new Error('Invalid image buffer dimensions.');
  const hist = new Uint32Array(256);
  let count = 0;
  let bright = 0;
  // Avoid excessive preprocessing overhead on large images.
  const stride = Math.max(1, Math.floor(width * height / 260_000));
  for (let index = 0; index < width * height; index += stride) {
    const offset = index * 4;
    if (pixels[offset + 3] < 32) continue;
    const value = luminance(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
    hist[value]++;
    count++;
    if (value >= 210) bright++;
  }
  if (count === 0) return {
    p10: 0, p50: 0, p90: 0, brightFraction: 0, lowContrast: false, highKey: false,
  };
  const p10 = percentile(hist, count, .1);
  const p50 = percentile(hist, count, .5);
  const p90 = percentile(hist, count, .9);
  const brightFraction = bright / count;
  const lowContrast = p90 - p10 < 80;
  // High-key and pale product photos are the target. Leave naturally
  // contrasted scenes alone in Auto mode.
  const highKey = (p50 >= 188 && brightFraction >= .43) ||
    (p50 >= 168 && p90 >= 195 && lowContrast);
  return { p10, p50, p90, brightFraction, lowContrast, highKey };
}

function clamp(value: number): number {
  return value <= 0 ? 0 : value >= 255 ? 255 : Math.round(value);
}

/**
 * Boost brightness separation and local edges in a low-contrast input.
 * Returns the original input untouched in Off mode and in Auto when the
 * photo has sufficient contrast. Alpha values are copied unchanged.
 */
export function enhanceSegmentationPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  mode: ContrastAssistMode,
): EnhancedInput {
  const metrics = measureContrast(pixels, width, height);
  if (mode === 'off' || (mode === 'auto' && !metrics.highKey)) {
    return { pixels, applied: false, metrics };
  }
  const spread = Math.max(28, metrics.p90 - metrics.p10);
  const gain = mode === 'strong'
    ? Math.min(3.4, Math.max(2.15, 235 / spread))
    : Math.min(2.7, Math.max(1.55, 198 / spread));
  const pivot = Math.max(205, metrics.p90);
  const detail = mode === 'strong' ? .75 : .45;
  const saturation = mode === 'strong' ? 1.23 : 1.12;

  const count = width * height;
  const luma = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const offset = i * 4;
    luma[i] = luminance(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
  }
  const next = new Uint8ClampedArray(pixels);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const upper = Math.max(0, y - 1) * width;
    const lower = Math.min(height - 1, y + 1) * width;
    for (let x = 0; x < width; x++) {
      const index = row + x;
      const offset = index * 4;
      if (pixels[offset + 3] < 32) continue;
      const value = luma[index];
      const neighborAverage = (
        4 * value +
        luma[row + Math.max(0, x - 1)] +
        luma[row + Math.min(width - 1, x + 1)] +
        luma[upper + x] +
        luma[lower + x]
      ) / 8;
      const target = Math.max(0, Math.min(255,
        pivot + (value - pivot) * gain + (value - neighborAverage) * detail,
      ));
      next[offset] = clamp(target + (pixels[offset] - value) * saturation);
      next[offset + 1] = clamp(target + (pixels[offset + 1] - value) * saturation);
      next[offset + 2] = clamp(target + (pixels[offset + 2] - value) * saturation);
    }
  }
  return { pixels: next, applied: true, metrics };
}
