import { describe, expect, it } from 'vitest';
import { floodRegion, featherMask, wandSelect, type Frame } from './editor';

const makeFrame = (width: number, height: number, rgb: number[][]): Frame => ({
  width, height, pixels: new Uint8ClampedArray(rgb.flatMap(color => [...color, 255])),
});

describe('fast region selection', () => {
  it('does not select diagonally adjacent matching pixels', () => {
    const f = makeFrame(3, 3, [
      [0, 0, 0], [255,255,255], [0,0,0],
      [255,255,255], [0,0,0], [255,255,255],
      [0,0,0], [255,255,255], [0,0,0],
    ]);
    expect(Array.from(floodRegion(f.pixels, f.width, f.height, 0, 0, 1))).toEqual([255,0,0,0,0,0,0,0,0]);
  });
  it('floods an L shaped region but skips disconnected pixels', () => {
    const f = makeFrame(4, 3, [
      [0,0,0],[0,0,0],[255,255,255],[255,255,255],
      [255,255,255],[0,0,0],[255,255,255],[0,0,0],
      [255,255,255],[0,0,0],[0,0,0],[0,0,0],
    ]);
    expect(Array.from(floodRegion(f.pixels, 4, 3, 0, 0, 1))).toEqual([
      255,255,0,0,
      0,255,0,255,
      0,255,255,255,
    ]);
  });
  it('matches full-image feathering, including near image boundaries', () => {
    const f = makeFrame(6, 5, Array.from({length:30}, (_, i) => {
      const inShape = (i%6 <= 1 && Math.floor(i/6) <= 1) || (i%6 === 1 && Math.floor(i/6) <= 3);
      return inShape ? [10,10,10] : [245,245,245];
    }));
    const expected = featherMask(floodRegion(f.pixels,6,5,0,0,5),6,5,2);
    const result = wandSelect(f,new Uint8Array(30),0,0,5,2,'erase');
    expect(Array.from(result)).toEqual(Array.from(expected));
  });
  it('restores only the selected pixels', () => {
    const f = makeFrame(3, 2, [
      [0,0,0],[0,0,0],[255,255,255],
      [0,0,0],[255,255,255],[255,255,255],
    ]);
    const out = wandSelect(f,new Uint8Array(6).fill(255),0,0,1,0,'restore');
    expect(Array.from(out)).toEqual([0,0,255,0,255,255]);
  });
});
