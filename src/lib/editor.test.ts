import { describe, expect, it } from 'vitest';
import { floodRegion, stampBrush, wandSelect, trimBounds, type Frame } from './editor';

describe('mask editing', () => {
  const frame: Frame = {
    width: 3,
    height: 2,
    pixels: new Uint8ClampedArray([
      255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255,
      255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255,
    ]),
  };

  it('selects only the connected similar-color area', () => {
    expect(Array.from(floodRegion(frame.pixels, 3, 2, 0, 0, 10))).toEqual([255, 255, 0, 255, 255, 0]);
  });

  it('erases and restores the clicked area', () => {
    const blank = new Uint8Array(6);
    const erased = wandSelect(frame, blank, 0, 0, 10, 0, 'erase');
    expect(Array.from(erased)).toEqual([255, 255, 0, 255, 255, 0]);
    const restored = wandSelect(frame, erased, 0, 0, 10, 0, 'restore');
    expect(Array.from(restored)).toEqual(Array(6).fill(0));
  });

  it('makes brush edits reversible', () => {
    const mask = new Uint8Array(25);
    stampBrush(mask, 5, 5, 2.5, 2.5, 1.5, 0, 'erase');
    expect(mask[12]).toBe(255);
    stampBrush(mask, 5, 5, 2.5, 2.5, 1.5, 0, 'restore');
    expect(mask[12]).toBe(0);
  });

  it('trims to visible pixels', () => {
    const blank = new Uint8Array([255, 255, 0, 255, 255, 0]);
    expect(trimBounds(frame, blank)).toEqual({ x: 2, y: 0, width: 1, height: 2 });
  });
});
