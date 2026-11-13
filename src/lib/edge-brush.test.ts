import { describe, expect, it } from 'vitest';
import { refineEdgeBrushStamp } from './edges';
import type { Frame } from './editor';

const frame: Frame = {
  width: 9, height: 9,
  pixels: new Uint8ClampedArray(Array.from({ length: 9*9 }, () => [180,180,180,255]).flat()),
};
describe('localized refine brush', () => {
  it('smooths only painted boundary pixels and leaves distant regions unchanged', () => {
    const mask = new Uint8Array(81);
    for (let y=0;y<9;y++) for (let x=5;x<9;x++) mask[y*9+x] = 255;
    const bounds = refineEdgeBrushStamp(frame,mask,4.5,4.5,2.8,82,1);
    expect(bounds.left).toBeGreaterThan(0);
    expect(mask[4*9+4]).toBeGreaterThan(0);
    expect(mask[4*9+4]).toBeLessThan(255);
    expect(mask[0]).toBe(0);
    expect(mask[8*9+8]).toBe(255);
  });
  it('does not alter flat interior regions', () => {
    const mask = new Uint8Array(81).fill(255);
    refineEdgeBrushStamp(frame,mask,4,4,2,80,1);
    expect(Array.from(mask)).toEqual(Array(81).fill(255));
  });
});
