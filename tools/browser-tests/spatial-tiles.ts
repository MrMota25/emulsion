// SPDX-License-Identifier: GPL-3.0-or-later
// node tools/browser-tests/realtime.mjs spatial-tiles 60
// Compare real full-frame rendering with small scratch tiles, across seams and image borders.
import { Engine, InputMode } from '../../src/engine/engine';
import { defaultRecipe } from '../../src/film/recipe';
import { Gpu } from '../../src/engine/gpu';
import { FULL } from '../../src/film/crop';

async function main() {
  const w = 317, h = 241;
  const data = new Uint16Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = 4 * (y * w + x);
    data.set([0x3000 + (x * 19 + y * 13) % 3000, 0x3000 + (x * 3 + y * 31) % 3000, 0x3000 + (x * 23 + y * 7) % 3000, 0x3c00], k);
  }
  const engine = new Engine(document.createElement('canvas'));
  const src = engine.sourceFromHalf({ width: w, height: h, fullWidth: w, fullHeight: h, mode: InputMode.SceneLinear, white: null, data });
  const recipe = { ...defaultRecipe(), captureSharpening: 0, profiledDenoise: null, sharpen: 45, sharpenRadius: 1.2 };
  // Reject the oversized *scratch* allocations that used to fail on 102 MP files. RG32F/R32F
  // output maps keep every source pixel; their storage is intentionally separate from scratch.
  const target = Gpu.prototype.target, reserve = Gpu.prototype.reserve;
  const draw = Gpu.prototype.draw;
  Gpu.prototype.draw = function (...args) {
    const result = draw.apply(this, args), error = this.gl.getError();
    if (error) throw Error(`GPU draw error 0x${error.toString(16)}\n${new Error().stack}`);
    return result;
  };
  let bounded = false;
  const check = (a: Parameters<Gpu['target']>) => {
    if (bounded && a[2] && a[3] && !a[4] && a[0] * a[1] > 40_000) throw Error(`Unbounded float scratch: ${a[0]}x${a[1]}`);
  };
  Gpu.prototype.target = function (...a) { check(a); return target.apply(this, a); };
  Gpu.prototype.reserve = function (...a) { check(a); return reserve.apply(this, a); };
  try {
    const results = [];
    for (const r of [recipe, { ...recipe, color: { hue: [50, -30, 10, 0, 0, 35, 0, -20], sat: [30, 20, -10, 0, 0, 40, 0, 0], bright: [-20, 0, 10, 0, 0, 30, 0, 0] } },
      { ...recipe, clarity: 30, exposure: .7, crop: { ...FULL, x: .1, y: .15, w: .7, h: .6, angle: 9 } }]) {
      bounded = false; engine.spatialTilePixels = Infinity; engine.dropBuffers(w, h);
      const reference = engine.readPixels(src, r, w, h, 7);
      engine.dropBuffers(w, h); bounded = true; engine.spatialTilePixels = 4096;
      // At this tiny fixture size, the coarse wavelets' full halo can cover most of the image.
      const tiled = engine.readPixels(src, r, w, h, 7);
      let diff = 0;
      for (let i = 0; i < reference.length; i++) diff = Math.max(diff, Math.abs(reference[i] - tiled[i]));
      const cached = engine.readPixels(src, r, w, h, 7);
      let cacheDiff = 0;
      for (let i = 0; i < tiled.length; i++) cacheDiff = Math.max(cacheDiff, Math.abs(tiled[i] - cached[i]));
      results.push({ diff, cacheDiff });
    }
    document.body.dataset.result = `${results.every(r => r.diff <= 1 && r.cacheDiff === 0) ? 'PASS' : 'FAIL'}: ${JSON.stringify(results)}`;
  } finally { Gpu.prototype.target = target; Gpu.prototype.reserve = reserve; Gpu.prototype.draw = draw; engine.dispose(); }
}
main().catch(error => { document.body.dataset.result = `FAIL: ${String(error)}`; });
