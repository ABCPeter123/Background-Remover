import type { Frame } from './editor';

export interface EdgeRefinement {
  /** Negative trims the foreground, positive restores the foreground. */
  shift: number;
  /** Radius for local color-guided edge smoothing. */
  smooth: number;
  /** 0 blends across similar areas, 100 preserves subtle color boundaries. */
  protection: number;
}

/** True if the edited removal mask contains a mix of visible/hidden pixels. */
export function hasCutout(mask: Uint8Array): boolean {
  let removed = false;
  let visible = false;
  for (let i = 0; i < mask.length; i++) {
    removed ||= mask[i] >= 96;
    visible ||= mask[i] < 160;
    if (removed && visible) return true;
  }
  return false;
}

/**
 * Morphological shifting of the matte border. Operates on continuous alpha,
 * not a thresholded silhouette, so fine wisps and partial transparency stay.
 * 8-neighbourhood avoids the cross-shaped artifacts of 4-neighbour erosion.
 */
export function shiftMatte(mask: Uint8Array, width: number, height: number, shift: number): Uint8Array {
  if (mask.length !== width * height) throw new Error('Mask dimensions do not match image.');
  const steps = Math.min(6, Math.abs(Math.round(shift)));
  if (steps === 0) return mask.slice();
  const trim = shift < 0;
  let source = mask.slice();
  let target = new Uint8Array(mask.length);
  for (let step = 0; step < steps; step++) {
    for (let y = 0; y < height; y++) {
      const top = Math.max(0, y - 1);
      const bottom = Math.min(height - 1, y + 1);
      for (let x = 0; x < width; x++) {
        let value = source[y * width + x];
        for (let yy = top; yy <= bottom; yy++) {
          const left = Math.max(0, x - 1);
          const right = Math.min(width - 1, x + 1);
          for (let xx = left; xx <= right; xx++) {
            const next = source[yy * width + xx];
            value = trim ? Math.max(value, next) : Math.min(value, next);
          }
        }
        target[y * width + x] = value;
      }
    }
    const swap = source;
    source = target;
    target = swap;
  }
  return source;
}

/**
 * Smooth the uncertain edge of a mask while giving pixels of similar color
 * more influence. This protects real object contours from generic blur.
 * Uses input RGB only for edge guidance; does not modify the source photo.
 */
export function colorGuidedMatte(
  frame: Frame,
  mask: Uint8Array,
  radius: number,
  protection: number,
): Uint8Array {
  const { width, height, pixels } = frame;
  if (mask.length !== width * height) throw new Error('Mask dimensions do not match image.');
  const r = Math.max(0, Math.min(4, Math.round(radius)));
  if (!r) return mask.slice();
  const sigma = 115 - Math.max(0, Math.min(100, protection));
  const similarity = new Float32Array(256);
  for (let v = 0; v < 256; v++) similarity[v] = Math.exp(-v * v / (2 * sigma * sigma));
  const spatial: number[] = [];
  const spread = Math.max(0.85, r / 1.3);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    spatial.push(Math.exp(-(dx * dx + dy * dy) / (2 * spread * spread)));
  }
  const result = mask.slice();
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const index = row + x;
      // If no matte change lies within the window, skip it entirely.
      const centerMask = mask[index];
      const left = Math.max(0, x - r);
      const right = Math.min(width - 1, x + r);
      const top = Math.max(0, y - r);
      const bottom = Math.min(height - 1, y + r);
      let boundary = false;
      for (let yy = top; yy <= bottom && !boundary; yy++) {
        for (let xx = left; xx <= right; xx++) {
          if (Math.abs(mask[yy * width + xx] - centerMask) > 8) {
            boundary = true;
            break;
          }
        }
      }
      if (!boundary) continue;
      const colorOffset = index * 4;
      const cr = pixels[colorOffset];
      const cg = pixels[colorOffset + 1];
      const cb = pixels[colorOffset + 2];
      let weighted = 0;
      let total = 0;
      for (let yy = top; yy <= bottom; yy++) {
        for (let xx = left; xx <= right; xx++) {
          const j = yy * width + xx;
          const p = j * 4;
          const colorDiff = Math.min(255, Math.round(Math.sqrt(
            (pixels[p] - cr) ** 2 * .3 +
            (pixels[p + 1] - cg) ** 2 * .59 +
            (pixels[p + 2] - cb) ** 2 * .11,
          )));
          const weight = similarity[colorDiff] * spatial[(yy - y + r) * (r * 2 + 1) + (xx - x + r)];
          weighted += mask[j] * weight;
          total += weight;
        }
      }
      result[index] = Math.round(weighted / total);
    }
  }
  return result;
}

export function refineMaskEdges(frame: Frame, mask: Uint8Array, options: EdgeRefinement): Uint8Array {
  if (mask.length !== frame.width * frame.height) throw new Error('Mask dimensions do not match image.');
  const shifted = shiftMatte(mask, frame.width, frame.height, options.shift);
  return colorGuidedMatte(frame, shifted, options.smooth, options.protection);
}
