import { describe, expect, it } from 'vitest';
import { enhanceSegmentationPixels, measureContrast } from './contrast';

function opaqueGray(values: number[]): Uint8ClampedArray {
  return new Uint8ClampedArray(values.flatMap(v => [v, v, v, 255]));
}

describe('AI contrast assist preprocessing', () => {
  it('detects high-key photos with near-white subjects', () => {
    const img = opaqueGray([248, 246, 246, 250, 235, 227, 233, 240, 253, 245, 225, 234]);
    expect(measureContrast(img, 4, 3).highKey).toBe(true);
    const result = enhanceSegmentationPixels(img, 4, 3, 'auto');
    expect(result.applied).toBe(true);
    expect(img[0]).toBe(248);
    // The faintly darker subject should be more distinguishable from white.
    expect(result.pixels[0] - result.pixels[5 * 4]).toBeGreaterThan(img[0] - img[5 * 4]);
  });

  it('does not adjust a normally contrasted photo in Auto mode', () => {
    const img = opaqueGray([12, 45, 80, 120, 155, 190, 225, 250]);
    const result = enhanceSegmentationPixels(img, 4, 2, 'auto');
    expect(result.applied).toBe(false);
    expect(result.pixels).toBe(img);
  });

  it('honors Off even on washed out photos', () => {
    const img = opaqueGray([230, 235, 245, 250]);
    const result = enhanceSegmentationPixels(img, 2, 2, 'off');
    expect(result.applied).toBe(false);
    expect(Array.from(result.pixels)).toEqual(Array.from(img));
  });

  it('supports manual Strong mode and preserves transparency', () => {
    const img = new Uint8ClampedArray([
      100, 90, 80, 255, 105, 95, 85, 255,
      245, 250, 250, 0, 112, 110, 104, 255,
    ]);
    const original = Array.from(img);
    const result = enhanceSegmentationPixels(img, 2, 2, 'strong');
    expect(result.applied).toBe(true);
    expect(result.pixels[3]).toBe(255);
    expect(result.pixels[11]).toBe(0);
    expect(Array.from(img)).toEqual(original);
    expect(Array.from(result.pixels.slice(8, 12))).toEqual(original.slice(8, 12));
  });

  it('uses a stronger stretch when requested', () => {
    const img = opaqueGray([220, 229, 239, 245, 250, 248, 235, 225]);
    const auto = enhanceSegmentationPixels(img, 4, 2, 'auto');
    const strong = enhanceSegmentationPixels(img, 4, 2, 'strong');
    expect(strong.pixels[0]).toBeLessThan(auto.pixels[0]);
    expect(strong.pixels[0]).toBeLessThan(img[0]);
  });

  it('validates buffer shape', () => {
    expect(() => measureContrast(new Uint8ClampedArray(3), 2, 2)).toThrow('Invalid image buffer');
  });
});
