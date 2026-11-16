// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it, vi } from 'vitest';
import { SpatialTiles } from './spatialtiles';
import type { Gpu, Program, Target } from './gpu';

it.each(['cancel', 'filter error', 'allocation error'])('releases an unfinished tiled map after %s and restores the caller clip', reason => {
  const live = new Set<Target>();
  const clip = { x: 1, y: 2, w: 3, h: 4, tw: 8, th: 8 };
  let allocations = 0;
  const free = (t: Target) => { if (t.blue) free(t.blue); live.delete(t); };
  const g = {
    clip,
    target(w: number, h: number) {
      if (++allocations === 2 && reason === 'allocation error') throw Error('allocation failed');
      const t = { w, h, tex: {}, fbo: {}, hdr: true } as Target;
      live.add(t); return t;
    },
    free, group: (targets: Target[]) => ({ ...targets[0] }), freePair: vi.fn(), bind: vi.fn(), draw: vi.fn(),
  };
  const maps = new SpatialTiles(g as unknown as Gpu, { set: vi.fn() } as unknown as Program);
  const work = maps.render(100, 80, 20, 32, 'rgb', function* () {
    g.clip = { ...clip, x: 50 };
    if (reason === 'filter error') throw Error('filter failed');
    yield;
    return {} as Target;
  });
  if (reason === 'cancel') { work.next(); expect(live.size).toBe(2); work.return({} as Target); }
  else expect(() => work.next()).toThrow(/failed/);
  expect(live.size).toBe(0);
  expect(g.clip).toBe(clip);
  maps.release();
  expect(live.size).toBe(0);
});
