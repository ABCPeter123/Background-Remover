import { describe, expect, it } from 'vitest';
import { wandSelect, wandSelectWithBounds, type Frame } from './editor';

describe('magic select dirty repaint', () => {
  it('reports only the selected area with feather margins', () => {
    const frame: Frame = { width: 8, height: 7, pixels: new Uint8ClampedArray(8*7*4) };
    for (let i=0;i<frame.width*frame.height;i++) {
      const isBlack = i === (3*8+4);
      frame.pixels.set(isBlack ? [0,0,0,255] : [255,255,255,255], i*4);
    }
    const initial = new Uint8Array(8*7);
    const selected = wandSelectWithBounds(frame, initial, 4, 3, 5, 2, 'erase');
    expect(selected.bounds).toEqual({ left: 2, top: 1, right: 7, bottom: 6 });
    expect(Array.from(selected.mask)).toEqual(Array.from(wandSelect(frame, initial, 4, 3, 5, 2, 'erase')));
  });
});
