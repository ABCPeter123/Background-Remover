import { describe, expect, it } from 'vitest';
import { applySmartSelection, promptToImageCoordinates } from './smart';
import type { Frame } from './editor';

describe('object-aware selection integration', () => {
  it('removes only the predicted object', () => {
    expect(Array.from(applySmartSelection(
      new Uint8Array([0, 0, 0, 0]),
      new Uint8Array([0, 255, 255, 0]),
      'remove',
    ))).toEqual([0, 255, 255, 0]);
  });
  it('keeps the predicted object and removes everything outside', () => {
    expect(Array.from(applySmartSelection(
      new Uint8Array([0, 0, 0, 0]),
      new Uint8Array([0, 255, 255, 0]),
      'keep',
    ))).toEqual([255, 0, 0, 255]);
  });
  it('does not restore pixels already erased by an earlier edit', () => {
    expect(Array.from(applySmartSelection(
      new Uint8Array([255, 0, 0, 0]),
      new Uint8Array([0, 255, 0, 0]),
      'remove',
    ))).toEqual([255, 255, 0, 0]);
  });
  it('normalizes clicks to the image and clamps edge positions', () => {
    const frame = { width: 400, height: 200 } as Frame;
    expect(promptToImageCoordinates({ x: 100, y: 50, label: 1 }, frame)).toEqual({ x: 0.25, y: 0.25, label: 1 });
    expect(promptToImageCoordinates({ x: -5, y: 500, label: 0 }, frame)).toEqual({ x: 0, y: 1, label: 0 });
  });
  it('rejects mismatched masks', () => {
    expect(() => applySmartSelection(new Uint8Array(2), new Uint8Array(3), 'keep')).toThrow();
  });
});
