import { describe, expect, it } from 'vitest';
import { composeRegion, type Frame } from './editor';

const frame: Frame = {
  width: 4,
  height: 3,
  pixels: new Uint8ClampedArray(Array.from({ length: 12 }, (_, index) =>
    [index * 10, index * 7, index * 5, 200]).flat()),
};
describe('dirty-region brush rendering', () => {
  it('copies the correct rectangle without touching other pixels', () => {
    const mask = new Uint8Array(12);
    mask[5] = 255;
    mask[6] = 128;
    const data = composeRegion(frame, mask, 1, 1, 2, 1);
    expect(Array.from(data)).toEqual([50, 35, 25, 0, 60, 42, 30, 100]);
  });
  it('can reproduce the original pixel values', () => {
    const mask = new Uint8Array(12).fill(255);
    expect(Array.from(composeRegion(frame, mask, 0, 0, 1, 1, true))).toEqual([0, 0, 0, 200]);
  });
});
