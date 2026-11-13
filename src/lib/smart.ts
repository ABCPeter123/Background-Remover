import type { Frame } from './editor';

export interface SmartPoint {
  x: number; // Normalized x position, 0..1
  y: number; // Normalized y position, 0..1
  label: 0 | 1;
}

export type SmartWorkerMessage =
  | { type: 'progress'; id: number; stage: string; percent?: number }
  | { type: 'ready'; id: number }
  | { type: 'selection'; id: number; requestId: number; width: number; height: number; score: number; mask: Uint8Array }
  | { type: 'error'; id: number; message: string };

export function applySmartSelection(
  previous: Uint8Array,
  selected: Uint8Array,
  action: 'keep' | 'remove',
): Uint8Array {
  if (previous.length !== selected.length) throw new Error('Selection size does not match the image.');
  const next = previous.slice();
  for (let i = 0; i < next.length; i++) {
    // The editor stores removal as alpha: 255=removed, 0=visible.
    const removal = action === 'remove' ? selected[i] : 255 - selected[i];
    next[i] = Math.max(next[i], removal);
  }
  return next;
}

export function promptToImageCoordinates(point: SmartPoint, frame: Frame): SmartPoint {
  return {
    x: Math.max(0, Math.min(1, point.x / frame.width)),
    y: Math.max(0, Math.min(1, point.y / frame.height)),
    label: point.label,
  };
}

/**
 * Resize a low-resolution semantic mask to the image being edited.
 * A smoothed canvas upscale keeps silhouette boundaries less jagged.
 */
export function upscaleSmartMask(
  lowRes: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): Uint8Array {
  if (lowRes.length !== sourceWidth * sourceHeight) throw new Error('Invalid AI mask dimensions.');
  if (sourceWidth === targetWidth && sourceHeight === targetHeight) return lowRes.slice();
  const source = document.createElement('canvas');
  source.width = sourceWidth;
  source.height = sourceHeight;
  const sourceCtx = source.getContext('2d');
  if (!sourceCtx) throw new Error('Cannot render the AI selection.');
  const image = sourceCtx.createImageData(sourceWidth, sourceHeight);
  for (let i = 0; i < lowRes.length; i++) {
    const p = i * 4;
    image.data[p] = 255;
    image.data[p + 1] = 255;
    image.data[p + 2] = 255;
    image.data[p + 3] = lowRes[i];
  }
  sourceCtx.putImageData(image, 0, 0);
  const destination = document.createElement('canvas');
  destination.width = targetWidth;
  destination.height = targetHeight;
  const destinationCtx = destination.getContext('2d', { willReadFrequently: true });
  if (!destinationCtx) throw new Error('Cannot upscale the AI selection.');
  destinationCtx.imageSmoothingEnabled = true;
  destinationCtx.imageSmoothingQuality = 'high';
  destinationCtx.drawImage(source, 0, 0, targetWidth, targetHeight);
  const data = destinationCtx.getImageData(0, 0, targetWidth, targetHeight).data;
  const output = new Uint8Array(targetWidth * targetHeight);
  for (let i = 0; i < output.length; i++) output[i] = data[i * 4 + 3];
  return output;
}
