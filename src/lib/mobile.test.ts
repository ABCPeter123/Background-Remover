import { describe, expect, it } from 'vitest';
import { imageLimitsForDevice, scaledSize } from './editor';

describe('mobile image memory constraints', () => {
  it('limits large phone photos to 2 megapixels', () => {
    const limits = imageLimitsForDevice(true);
    const scaled = scaledSize(4032, 3024, limits);
    expect(scaled.width * scaled.height).toBeLessThanOrEqual(2_000_000);
    expect(Math.max(scaled.width, scaled.height)).toBeLessThanOrEqual(1600);
    expect(Math.abs(scaled.width / scaled.height - 4 / 3)).toBeLessThan(0.002);
  });
  it('does not shrink small images', () => {
    expect(scaledSize(600, 400, imageLimitsForDevice(true))).toEqual({width: 600, height: 400});
  });
  it('preserves desktop limits', () => {
    const limits = imageLimitsForDevice(false);
    const scaled = scaledSize(4032, 3024, limits);
    expect(scaled.width * scaled.height).toBeLessThanOrEqual(8_000_000);
    expect(Math.max(scaled.width, scaled.height)).toBeLessThanOrEqual(2800);
  });
});
