# GFX100RF handoff — 2026-11-16

User resumed on 2026-11-16 to improve GFX handling and fix the Texture regression,
then authorized committing and pushing this checkpoint. The combined branch is
`fix/gfx-large-images`; no PR or merge was requested. Oli also requested a dev app
from this branch to assess GFX browsing/zoom/control performance.

## Checkpoint and worktrees

- Core checkpoint: **0636871**, branch `fix/gfx-core`, clean worktree
  `/Users/oli/Dev/emulsion-gfx-core`. It remains unchanged.
  Colour/Sharpening scratch tiling, full-precision split output maps, 16-bit output
  strips, 128 MP AI admission/4 GiB disk cache, direct borrowed payload packing,
  full-strength AI export upload optimization, persistent error/worker stacks.
- Combined follow-up: `/Users/oli/Dev/emulsion-gfx-export`, branch
  `fix/gfx-large-images`, reconciled to descend from `0636871` so the core commit
  is preserved without duplication. The reconciliation preserves the tested tree.
  Adds exact Texture/Dehaze tiling, early-input release/strip reuse, the Texture
  border fix, and the 16-bit Remove-context lifetime fix. Heavy WK memory failure
  below remains unresolved. Main checkout source remains unchanged.
- The original core engine/module were recovered from successful 13:22 production
  source maps at `sourcemaps/0.1.8+7c8b61cf1ec1.dirty.20261116T132208` in the
  research worktree and verified before the separate core commit.

## Real data and successful checks

`.scratch/issue-27/` in the research worktree holds the real public sample RAW,
`full.bin`, `preview.bin`, `export-small.bin`, `capture.bin`, `noise-full.bin`,
model setup links and before/after outputs. The core worktree symlinks this folder.
The original RAW was read only. The user's catalog/settings were not changed.

The source is 11662 x 8746 (101.996 MP); the as-shot 1:1 / 80 mm crop is 3840².
A 2560² export needs a 7775 px decode, not a 2560 px source (the initial harness
mistake was corrected). Do not repeat that mistake when judging small-export tests.

- Actual denoise/inference, full paired payload packing, shutdown/reopen and disk
  cache reuse passed in ~62 s. New payload's original plane is byte-identical to
  the old ordinary native decode. See `noise-before.log` (100 MP rejection) and
  `noise-after.log` (pass). No model download needed: installed assets are linked
  read-only via `.scratch/issue-27/noise-assets/runtime.json`.
- Core full source Emulsion Standard: Chrome/WK pass, ~5.64 GB logical texture peak.
- Capture sharpening: pass, ~6.83 GB. AI + capture: WK pass, ~6.83 GB.
- Full sensor 16-bit output: Chrome/WK pass, 611,975,112 bytes.
- Worker export, ordinary worker/page Remove pixel comparison, 16/8-bit and tall
  multi-strip comparisons pass.
- Core `spatial-tiles`: 3 cases, max pixel diff 0, cache redraw diff 0.
- GPU reference probe: 43 sections, no top-level error; colour/USM errors ~1e-6.
- Before broader work, full check passed 1021 JS / 161 Rust (+25 ignored), TS/build.
  Latest isolated-core rerun is `core-checkpoint-check.log`.

## Texture regression fixed — resumed 2026-11-16

```
cd /Users/oli/Dev/emulsion-gfx-export
node tools/browser-tests/realtime.mjs spatial-tiles 60
```

The original seven-case harness failed at 42/255 on photo Texture 30 + masked
Texture 20. A minimised input readback showed exactly the last column of the
185 x 237 padded tile was wrong, before wavelet decomposition: global (316,162)
read L* ~65 instead of 92.726234. Scale parameters and the other input pixels
matched. The fold itself and mask weighting were not the cause.

`develop.frag.glsl` sampled the mipmapped source after a varying off-image early
return. With odd image/tile sizes, helper fragments just outside the image can
return before sampling, leaving implicit mip derivatives undefined for the edge
pixel. An explicit LOD-0 probe passed; the final fix moves the normal texture read
before that bounds return, retaining ordinary mipmap behaviour. No filter maths,
precision, output size or wavelet bands were changed.

Expanded regression: 12 cases, including negative Texture, multiple sequential
masks, log detail order, masked-only Texture and combined Dehaze/Texture/Clarity.
Output max diff 0 except the combined case (1/255); Texture map max error <7e-6;
cache redraws all identical. Restoring the old shader made four cases fail
(38–42/255); restoring the fix passed. Evidence:
`texture-expanded-red.log`, `texture-expanded-green.log` in `.scratch/issue-27/`.
All temporary `__gfxDebug`/input-map probes were removed from engine and page.
The clip reset in SpatialTiles remains necessary and is retained.

## 16-bit strip follow-up fixed and verified

The new queued 400 x 9000 render places a Remove spot in the second output strip.
Before the fix it differed from the reference by **59160/65535**: StillRenderer
restored `removeContext` after starting readPixels16Async, before later strips
rendered. It now retains that context until the full 16-bit render completes,
restoring it in finally. Queued versus reference output is now byte-identical.
The existing 8-bit submission/readback lifetime is preserved.

- `VITE_ENGINE=worker node tools/browser-tests/realtime.mjs export-worker 60`:
  Remove inputs/output diff 0; 16/8-bit max diff 1; tall strips max diff 1.15 in
  8-bit steps; queued/reference 16-bit strips diff 0.
- Actual GFX source, AI payload + capture + 16-bit/8-bit comparison in WK:
  `node .scratch/issue-27/wk.mjs 'capture&noise&deep&compare'` passes in 32.6 s,
  max diff 1 in 8-bit steps; logical texture peak 5.85 GB. The 16-bit output was
  3840² RGB16. The log's outputBytes describes the later 8-bit comparison; the
  harness now preserves and reports the first export's byte count separately.
- Actual full-sensor Chrome RGB16 export (`sensor&deep`) passes in 9.45 s,
  **611,975,112 bytes**, logical texture peak 4.30 GB, no GL/allocation errors.
- Strict TypeScript check of the three touched browser pages passes.
- `node tools/browser-tests/realtime.mjs region-detail 60` passes the full suite,
  including crop/region, masked detail, cache, warm and live/settle checks.
  Log: `.scratch/issue-27/region-detail-resume.log`.

## Remaining blocker: heavy masked export can hit WK's memory limit

```
node tools/browser-tests/realtime.mjs export-large 120 'texture&masked&haze'
node .scratch/issue-27/wk.mjs 'texture&masked&haze'
```

The page uses the real 102 MP native payload, default Emulsion Standard/profiler/
USM, Texture 30, Clarity 20, Dehaze 25 and an ellipse Texture 20. Chrome passes in
37.8 s with the correct 3840² output and no GL/allocation errors; logical texture
peak 10.02 GB. **Uninstrumented WK terminates its content process**. System logs
explicitly report `didExceedActiveMemoryLimit` / `ExceededMemoryLimit`.

One native run with allocation-peak tracing passed in 28.2 s, at the same logical
peak. This timing-sensitive pass does not establish that the memory issue is fixed.
The unmasked `texture&haze` control passes in current WK (22.7 s). A gl.finish per
tile and asynchronous fenced batches both still failed; both attempts were removed.
Do not revive pacing as an established fix. Trace code was removed from the page.
The trace runner and captured evidence are confined to `.scratch/issue-27/`.

The trace shows Clarity pyramids are already retained while tiled Texture runs;
Texture reaches ~8.40 GB logical live storage, final USM ~10.02 GB. These counters
are not RSS or physical residency. Next work should measure actual process memory
and reduce retained export intermediates (including Clarity scratch lifetime),
using the native masked export as the red loop. No universal #27 resolution yet.

## Other broader changes to verify

- `SpatialTiles.render` now supports r/rg/rgb/rgba output planes and resets clip
  before each tile. Core checkpoint still uses the simpler boolean rgb version.
- Exact Texture tiling keeps all full-resolution wavelet bands, with full combined
  support, and uses `uTextureTile` for a masked instance's local accumulated map.
- Dehaze tiling processes each affine instance over the full source in padded
  tiles, uses full-source ambient measurements, and splits RGBA32F into two RG32F
  maps. Small photo/masked Dehaze cases match. Large `haze` passes in Chrome; see the native memory blocker above.
- `node .scratch/issue-27/wk.mjs 'texture&haze'` passed on the real RAW, ~10.02 GB
  logical texture requests. This is NOT process RSS/physical residency, and more
  memory work may be needed with the real app's simultaneous Develop context.
- Large stills release intermediate profiled/capture sources after lens correction
  to reduce retained GPU buffers. This is only in the research tree.
- Research `readPixels16Async` has a new `preparedInput` checkpoint and
  `Source.lensApplied` to avoid repeating noise/capture for each output strip after
  early-buffer release, plus a per-strip watchdog. These additions pass the worker/16-bit and actual AI/capture
  comparisons above.
- Keep upstream port maths/precision. Do not use regional preview approximations
  as an automatic full-export replacement or silently downsample exports.

## Latest repository checks

`CARGO_TARGET_DIR=/Users/oli/Dev/emulsion/src-tauri/target npm run check` passes:
1021 frontend tests, 161 Rust tests (+25 ignored), TypeScript and production build.
Log: `.scratch/issue-27/resume-check.log`. The combined follow-up is committed on top of core and pushed to
`origin/fix/gfx-large-images`. No PR or merge. The isolated core worktree was not
modified. Dev app log: `.scratch/issue-27/dev-app.log`.

## Useful commands

```
node tools/browser-tests/realtime.mjs export-large 90 texture
node tools/browser-tests/realtime.mjs export-large 60 haze
node tools/browser-tests/realtime.mjs export-large 90 'sensor&deep'
VITE_ENGINE=worker node tools/browser-tests/realtime.mjs export-worker 60
node .scratch/issue-27/wk.mjs 'capture&noise'
source ~/.cargo/env
CARGO_TARGET_DIR=/Users/oli/Dev/emulsion/src-tauri/target npm run check
```

The source RAW, model inference and native payload machinery need not be rebuilt
or downloaded to resume the masked-Texture diagnosis. The reporter's exact saved
recipe/export settings remain unavailable, but the supplied RAW suffices for the
current reproductions. Read the core report for its deliberate scope; do not mark
all of #27 solved until broader heavy edits are verified.
