import { describe, expect, it } from 'vitest';
import { floodRegion } from './editor';

function referenceFlood(pixels: Uint8ClampedArray, width: number, height: number, x: number, y: number, tolerance: number): Uint8Array {
  const count = width * height;
  const region = new Uint8Array(count);
  const start = Math.floor(y) * width + Math.floor(x);
  const offset = start * 4;
  const sr = pixels[offset], sg = pixels[offset + 1], sb = pixels[offset + 2], sa = pixels[offset + 3];
  const limit = (5 + Math.max(0, Math.min(100, tolerance)) / 100 * 215) ** 2;
  const visited = new Uint8Array(count);
  const q: number[] = [start];
  visited[start] = 1;
  for (let i = 0; i < q.length; i++) {
    const index = q[i];
    const p = index * 4;
    const dr = pixels[p] - sr, dg = pixels[p+1] - sg, db = pixels[p+2] - sb, da = pixels[p+3] - sa;
    if (.32*dr*dr + .54*dg*dg + .14*db*db + .3*da*da > limit) continue;
    region[index] = 255;
    const col = index % width;
    const row = Math.floor(index / width);
    for (const candidate of [
      col > 0 ? index-1 : -1,
      col < width-1 ? index+1 : -1,
      row > 0 ? index-width : -1,
      row < height-1 ? index+width : -1,
    ]) {
      if (candidate >= 0 && !visited[candidate]) {
        visited[candidate] = 1;
        q.push(candidate);
      }
    }
  }
  return region;
}

describe('magic select randomized reference comparison', () => {
  it('matches a standard 4-connected flood fill across 200 cases', () => {
    let random = 1571;
    const next = () => {
      random = (random * 1664525 + 1013904223) >>> 0;
      return random / 4294967296;
    };
    for (let testCase = 0; testCase < 200; testCase++) {
      const width = 4 + Math.floor(next() * 20);
      const height = 4 + Math.floor(next() * 20);
      const pixels = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        const base = Math.floor(next() * 5) * 50;
        const p = i * 4;
        pixels[p] = base;
        pixels[p+1] = (base + Math.floor(next() * 20)) % 256;
        pixels[p+2] = (base + Math.floor(next() * 15)) % 256;
        pixels[p+3] = next() < .05 ? 0 : 255;
      }
      const x = Math.floor(next() * width);
      const y = Math.floor(next() * height);
      const tolerance = [0, 10, 25, 45, 75, 100][Math.floor(next() * 6)];
      const actual = floodRegion(pixels,width,height,x,y,tolerance);
      const expected = referenceFlood(pixels,width,height,x,y,tolerance);
      expect(Array.from(actual), 'case ' + testCase + ' at ('+x+','+y+') tolerance '+tolerance).toEqual(Array.from(expected));
    }
  });
});
