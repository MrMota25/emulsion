// SPDX-License-Identifier: GPL-3.0-or-later
// Issue #27 investigation. Native decode payloads live in .scratch/issue-27.
// node tools/browser-tests/realtime.mjs export-large 60 [preview|lean|deep]
// Exercises the actual export/stills path; only filesystem IPC is substituted.
import { mockIPC } from '@tauri-apps/api/mocks';
import { exportPhotos } from '../../src/library/export';
import { defaultRecipe } from '../../src/film/recipe';
import { Gpu } from '../../src/engine/gpu';
import { trackTextures } from '../../src/dev/gpumemory';
import type { Photo } from '../../src/library/store';
import type { Recipe } from '../../src/film/recipe';
import { FULL } from '../../src/film/crop';
import { newEllipse, newMask } from '../../src/film/masks';

const query = new URLSearchParams(location.search);
if (!query.has('worker')) localStorage.setItem('emulsion.engine', 'main');
const memory = trackTextures();
const allocations: object[] = [];
const glErrors: object[] = [];
const texImage = WebGL2RenderingContext.prototype.texImage2D;
WebGL2RenderingContext.prototype.texImage2D = function (...args: any[]) {
  (texImage as Function).apply(this, args);
  const error = this.getError();
  if (error) glErrors.push({ args: args.slice(0, 8), error });
};
const target = Gpu.prototype.target;
Gpu.prototype.target = function (...args) {
  try { return target.apply(this, args); }
  catch (error) {
    allocations.push({ args, glError: this.gl.getError(), lost: this.gl.isContextLost(), stack: String((error as Error).stack), memory: memory() });
    throw error;
  }
};
let outputBytes = 0;
let output: Uint8Array | null = null;
const decodes: object[] = [];
mockIPC(async (command, args) => {
  if (command === 'load_image') {
    const edge = (args as { maxEdge: number }).maxEdge;
    const file = query.has('noise') ? 'noise-full' : edge <= 2560 ? 'preview' : edge <= 7775 ? 'export-small' : 'full';
    decodes.push({ edge, file });
    const response = await fetch(`/.scratch/issue-27/${file}.bin`);
    if (!response.ok) throw Error(`Missing native decode: ${response.status}`);
    return response.arrayBuffer();
  }
  if (command === 'check_export_dir') return null;
  if (command === 'capture_info') {
    const response = await fetch('/.scratch/issue-27/capture.bin');
    if (!response.ok) throw Error(`Missing native capture payload: ${response.status}`);
    return response.arrayBuffer();
  }
  if (command === 'write_export') {
    outputBytes = (args as unknown as Uint8Array).byteLength;
    if (query.has('compare')) output = new Uint8Array(args as unknown as Uint8Array);
    return { path: '/exports/sample.jpg', skipped: false };
  }
  if (command === 'export_exists' || command === 'log_to_terminal') return null;
  throw Error(`unexpected IPC ${command}`);
});

async function main() {
  if (query.has('target')) {
    const g = new Gpu(document.createElement('canvas'));
    const gl = g.gl;
    const limits = { texture: g.maxTextureSize, renderbuffer: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), renderer: gl.getParameter(gl.RENDERER) };
    const attempts = [];
    for (const [w, h] of [[8192, 8192], [8193, 8192], [11662, 8746]]) {
      try { const t = g.target(w, h, true, true); g.free(t); attempts.push({ w, h, ok: true }); }
      catch (error) { attempts.push({ w, h, ok: false, error: String(error) }); }
    }
    document.body.dataset.result = `${attempts.every(a => a.ok) ? 'PASS' : 'FAIL'}: ` + JSON.stringify({ limits, attempts, allocations, glErrors });
    return;
  }
  // Isolate GPU development first; capture metadata/inference are separate native work.
  const recipe: Recipe = { ...defaultRecipe(query.has('neutral') ? 'neutral' : undefined), captureSharpening: query.has('capture') ? 100 : 0,
    ...(query.has('sensor') ? { crop: FULL } : {}),
    ...(query.has('texture') ? { texture: 30, clarity: 20 } : {}),
    ...(query.has('masked') ? { masks: [{ ...newMask(newEllipse([.5, .5]), 0), texture: 20 }] } : {}),
    ...(query.has('haze') ? { dehaze: 25 } : {}),
    ...(query.has('noise') ? { noiseReduction: { enabled: true, amount: 100, model: 'rawnind-linear-v1' } } : {}),
    ...(query.has('lean') || query.has('neutral') ? { profiledDenoise: null, sharpen: 0 } : {}) };
  const photo: Photo = { path: '/sample.raf', rel: 'sample.raf', name: 'sample.raf', size: 1, modified: 0, recipe, seed: 3,
    white: null, rating: 0, label: null, flag: null, raw: true, pair: null };
  const start = performance.now();
  const result = await exportPhotos([photo], { dir: '/exports', subfolder: '', longEdge: query.has('preview') ? 2560 : null,
    format: query.has('deep') ? { kind: 'tiff', bits: 16, compression: 'zip' } : { kind: 'jpeg', quality: 92 }, existing: 'rename' }, () => {}, { canceled: false });
  const expected = query.has('preview') ? 2560 : 3840;
  const expectedBytes = (query.has('sensor') ? 11662 * 8746 : expected * expected) * (query.has('deep') ? 6 : 4);
  const exportedBytes = outputBytes;
  const sizeMatches = exportedBytes === expectedBytes;
  let compareDiff = 0;
  if (query.has('compare')) {
    if (!query.has('deep') || !output || !sizeMatches) throw Error('compare requires successful deep export');
    const bytes = output as Uint8Array;
    const deep = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    output = null;
    const comparison = await exportPhotos([photo], { dir: '/exports', subfolder: '', longEdge: query.has('preview') ? 2560 : null,
      format: { kind: 'jpeg', quality: 92 }, existing: 'rename' }, () => {}, { canceled: false });
    const rgba = output as Uint8Array | null;
    if (comparison.written.length !== 1 || !rgba || rgba.length / 4 !== deep.length / 3) throw Error('comparison export failed');
    for (let i = 0, o = 0; i < deep.length; i += 3, o += 4)
      for (let k = 0; k < 3; k++) compareDiff = Math.max(compareDiff, Math.abs(deep[i + k] / 257 - rgba[o + k]));
  }
  document.body.dataset.result = `${result.written.length === 1 && sizeMatches && compareDiff <= 2 && !glErrors.length ? 'PASS' : 'FAIL'}: ` + JSON.stringify({ result, outputBytes: exportedBytes, expectedBytes, compareDiff, decodes, ms: performance.now() - start, allocations, glErrors, memory: memory() });
}
main().catch(error => { document.body.dataset.result = `FAIL: ${String(error)}`; });
