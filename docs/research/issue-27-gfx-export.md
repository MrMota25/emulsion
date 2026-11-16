# GFX100RF export and AI denoise checkpoint

Issues [#27](https://github.com/mowerol/emulsion/issues/27) and
[#13](https://github.com/mowerol/emulsion/issues/13), investigated 2026-11-15–16
against main `7c8b61c` / Emulsion 0.1.8.

The supplied RAW decodes to 11662 × 8746 (101,995,852 pixels). Its camera frame is
3840² (1:1, 80 mm tele), but intermediate filters still process the whole source.
Before this fix, Emulsion Standard with AI denoise off fails in Chrome creating
a full-source RGBA32F target; WKWebView hits the readback watchdog with roughly
16.6 GB of logical texture storage requested at peak. Neutral passes. The
colour equalizer alone needs five RGBA32F scratch images plus its look output;
each is about 1.63 GB at this source size.

## Checkpoint scope

- Colour and Sharpening run their unchanged filter passes on padded 1024 px
  cores above eight million source pixels. Consecutive colour instances use the
  complete combined overlap. Finished maps retain full source density and 32-bit
  precision: RGB32F is stored as RG32F + R32F, and sharpening as RG32F.
- 16-bit export renders and reads its final float target in strips of at most
  48 MiB, retaining the full frame's geometry, effect scales and seed.
- AI denoise admits up to 128 MP. Its disk budget increases to 4 GiB so the
  GFX original/result pair (~2.45 GB) can persist. Payload packing borrows the
  float planes and writes directly into one final buffer, removing several
  large RGB/RGBA/byte copies. Ordinary RAW packing also avoids the RGBA32F copy.
- At 100% AI strength, export uploads the denoised result alone. Original and
  denoised inputs remain available to Develop's Before/Split workflow.
- Failed export frames reach the persistent error reporter. Worker replies keep
  their stack, and failed render-target allocation reports format/GL/FBO status.

This checkpoint fixes the demonstrated default-look and AI-denoise failures.
**Full-resolution Dehaze and Texture still need separate tiling.** That broader
work is intentionally outside this commit, in `/Users/oli/Dev/emulsion-gfx-export`
on `fix/gfx-large-images`. Do not close #27 as universally solved or merge that
work without resolving its masked-Texture regression. No resolution reduction,
undenoised fallback, or preview-map approximation was introduced here.

## Validation

The actual native decoder and denoiser processed the reporter's RAW. Its source
plane in the new paired payload matches the earlier native decode byte for byte.
The real cache test passes inference, full-resolution payload packing and cache
reuse after shutdown without loading the model again (about 62 s total).

The export harness uses actual native decoder/capture/denoise payloads and the
real export/stills/Engine path, with filesystem and final encoder IPC substituted:

- Emulsion Standard: passes in Chrome and WKWebView; logical texture peak ~5.64 GB.
- Capture sharpening: passes; peak ~6.83 GB.
- AI denoise + capture: passes in WKWebView; peak ~6.83 GB.
- Full-sensor 16-bit: passes in both backends, returning 611,975,112 RGB16 bytes.
- Worker-mode export passes. Existing worker/page Remove output comparison is
  byte-identical; 16-bit/8-bit and multi-strip comparisons remain within tolerance.
- `spatial-tiles` compares ordinary rendering with forced small scratch tiles:
  look + sharpening, consecutive colour instances, and crop/rotation/Clarity.
  All three cases and their cached redraws have zero differing output bytes.
- GPU reference probe: no top-level error; colour and sharpening errors remain
  about 1e-6–3.3e-6. Unit/type/build/native checks are recorded in the handoff.

Logical texture storage is not process RSS or physical residency. The harness is
not an installed Tauri application replay, and the reporter's exact saved recipe
and export settings were not supplied.

## Reproduce locally

The original RAW, native payloads and logs live in the investigation worktree's
untracked `.scratch/issue-27/`; the checkpoint worktree links that directory.
RAW SHA-256: `64758c4da83ac423a0809ba62c3fef50ff66e912298de96ae15e0af2b437f4ee`.

```sh
node tools/browser-tests/realtime.mjs spatial-tiles 60
node tools/browser-tests/realtime.mjs export-large 60
VITE_ENGINE=worker node tools/browser-tests/realtime.mjs export-large 60 worker
node tools/browser-tests/realtime.mjs export-large 90 'sensor&deep'
node .scratch/issue-27/wk.mjs 'capture&noise'
```

`decode::tests::dump_engine_payloads` takes `EMULSION_LOOKFIT_DUMP` lines of
`edge<TAB>RAW<TAB>output`; use 16384 → `full.bin`, 2560 → `preview.bin`, and
7775 → `export-small.bin` (the camera crop requires this larger decode for a
2560² export). `capture::tests::dump_engine_capture_payload` takes
`EMULSION_CAPTURE_DUMP=width<TAB>height<TAB>RAW<TAB>output`.
`noise_cache::tests::real_raw_cache_reuses_inference_after_restart` accepts
`EMULSION_NOISE_RAW`, `EMULSION_DENOISE_ASSETS` and optional
`EMULSION_NOISE_FULL_DUMP` for real inference and export payload extraction.
These ignored native tests use scratch data and do not change original photos.
