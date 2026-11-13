import { describe, expect, it } from 'vitest';
import { colorGuidedMatte, hasCutout, refineMaskEdges, shiftMatte } from './edges';
import type { Frame } from './editor';

function makeFrame(width: number, height: number, colorAt: (x: number, y: number) => number): Frame {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 4;
    const v = colorAt(x, y);
    pixels.set([v, v, v, 255], index);
  }
  return { pixels, width, height };
}
describe('precision matte refinement', () => {
  it('identifies actual alpha cutouts', () => {
    expect(hasCutout(new Uint8Array([0, 0, 0]))).toBe(false);
    expect(hasCutout(new Uint8Array([255, 255]))).toBe(false);
    expect(hasCutout(new Uint8Array([0, 255]))).toBe(true);
  });
  it('trims or expands the foreground without mutating the source', () => {
    const base = new Uint8Array([
      255,255,255,255,255,
      255,  0,  0,  0,255,
      255,  0,  0,  0,255,
      255,  0,  0,  0,255,
      255,255,255,255,255,
    ]);
    const trimmed = shiftMatte(base,5,5,-1);
    const expanded = shiftMatte(base,5,5,1);
    expect(trimmed[2 + 2*5]).toBe(0);
    expect(trimmed[1 + 2*5]).toBe(255);
    expect(expanded[0]).toBe(0);
    expect(Array.from(base)).not.toEqual(Array.from(trimmed));
    expect(base[1 + 2*5]).toBe(0);
  });
  it('keeps fully opaque regions untouched by smoothing', () => {
    const frame = makeFrame(6,6, () => 160);
    const mask = new Uint8Array(36);
    expect(Array.from(colorGuidedMatte(frame, mask, 3, 80))).toEqual(Array(36).fill(0));
  });
  it('respects high-contrast original pixel boundaries', () => {
    const frame = makeFrame(6,3, (x) => x < 3 ? 0 : 255);
    const mask = new Uint8Array(18);
    for (let i=0;i<18;i++) mask[i] = i%6<3 ? 0 : 255;
    const sharp = colorGuidedMatte(frame,mask,2,100);
    const soft = colorGuidedMatte(frame,mask,2,0);
    expect(sharp[2]).toBeLessThan(soft[2]);
    expect(sharp[3]).toBeGreaterThan(soft[3]);
    expect(sharp[2]).toBeLessThan(12);
    expect(sharp[3]).toBeGreaterThan(243);
  });
  it('smoothes same-color jagged edges with intermediate transparency', () => {
    const frame = makeFrame(5,5,() => 150);
    const mask = new Uint8Array(25);
    for (let y=0;y<5;y++) for (let x=0;x<5;x++) mask[y*5+x] = x>2 ? 255 : 0;
    const smooth = refineMaskEdges(frame,mask,{shift:0,smooth:2,protection:70});
    expect(smooth[2+2*5]).toBeGreaterThan(0);
    expect(smooth[2+2*5]).toBeLessThan(255);
    expect(smooth[4+2*5]).toBeGreaterThan(200);
    expect(mask[2+2*5]).toBe(0);
  });
  it('does not change any matte when the controls are zero', () => {
    const frame = makeFrame(3,3,() => 128);
    const mask = new Uint8Array([0,0,255,0,180,255,0,255,255]);
    expect(Array.from(refineMaskEdges(frame,mask,{shift:0,smooth:0,protection:80}))).toEqual(Array.from(mask));
  });
  it('validates dimensions', () => {
    expect(() => shiftMatte(new Uint8Array(2),5,5,1)).toThrow();
  });
});
