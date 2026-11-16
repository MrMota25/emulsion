// SPDX-License-Identifier: GPL-3.0-or-later
// Exact local-filter tiling. The caller supplies the filter's complete support and runs the
// existing port on each padded tile; only its valid core is copied. No preview approximation.
import { type Gpu, type Target, type Program } from './gpu';
import { tilesFor, type Tile } from './denoisegpu';

export const SPATIAL_TILE_PIXELS = 8_000_000;
export const SPATIAL_TILE_CORE = 1024;

export class SpatialTiles {
  private out: Target | null = null;
  constructor(private g: Gpu, private copy: Program) {}

  release() { if (this.out) this.g.free(this.out); this.out = null; }

  releaseSize(w: number, h: number) {
    if (this.out?.w !== w || this.out.h !== h) return false;
    this.release(); return true;
  }

  *render(w: number, h: number, reach: number, core: number, channels: 'r' | 'rg' | 'rgb' | 'rgba',
    process: (tile: Tile) => Generator<void, Target>): Generator<void, Target> {
    this.release();
    const g = this.g;
    // RGB32F is not a WebGL renderable format. RG32F + R32F keeps all three 32-bit
    // channels, without a multi-gigabyte RGBA32F resource (or reduced float precision).
    const out = g.target(w, h, true, true, channels === 'r' ? true : 'rg');
    this.out = out;
    let group: Target | null = null, complete = false;
    const previousClip = g.clip;
    try {
      if (channels === 'rgb' || channels === 'rgba') out.blue = g.target(w, h, true, true, channels === 'rgba' ? 'rg' : true);
      group = out.blue ? g.group([out, out.blue]) : out;
      for (const tile of tilesFor(w, h, reach, 0, core)) {
        g.clip = null;
        const result = yield* process(tile);
        g.bind(0, result.tex);
        this.copy.set({ uTex: 0, uOffset: [tile.px, tile.py] });
        g.clip = { x: tile.cx, y: tile.cy, w: tile.cw, h: tile.ch, tw: w, th: h };
        g.draw(this.copy, group, w, h);
        yield;
      }
      complete = true;
      return out;
    } finally {
      g.clip = previousClip;
      if (group && group !== out) g.freePair(group);
      if (!complete) this.release();
    }
  }
}
