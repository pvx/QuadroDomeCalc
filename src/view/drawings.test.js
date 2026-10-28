import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  strutOverallLength,
  layoutPanelOnSheet,
  hubRayAngles,
  OSB_SHEET_MM,
} from './drawings.js';

describe('strutOverallLength', () => {
  it('matches cutLength when ends are square', () => {
    assert.equal(strutOverallLength(1000, 200, 0, 0), 1000);
  });

  it('adds (w/2)·(tan α + tan β)', () => {
    const w = 200;
    const a = 10;
    const b = 15;
    const L = 1200;
    const expected =
      L +
      (w / 2) *
        (Math.tan((a * Math.PI) / 180) + Math.tan((b * Math.PI) / 180));
    assert.ok(Math.abs(strutOverallLength(L, w, a, b) - expected) < 1e-9);
  });
});

describe('layoutPanelOnSheet', () => {
  it('puts a vertex at the sheet origin and longest side along +x', () => {
    const sides = [800, 600, 500];
    const { panel, sheetW, sheetH } = layoutPanelOnSheet(sides);
    assert.equal(sheetW, OSB_SHEET_MM.long);
    assert.equal(sheetH, OSB_SHEET_MM.short);

    const nearOrigin = panel.some(
      (p) => Math.hypot(p.x, p.y) < 1e-6,
    );
    assert.ok(nearOrigin);

    const lens = [0, 1, 2].map((i) => {
      const p = panel[i];
      const q = panel[(i + 1) % 3];
      return Math.hypot(q.x - p.x, q.y - p.y);
    });
    const maxLen = Math.max(...lens);
    const longEdge = [0, 1, 2].find((i) => Math.abs(lens[i] - maxLen) < 1e-6);
    const p = panel[longEdge];
    const q = panel[(longEdge + 1) % 3];
    const dy = Math.abs(q.y - p.y);
    assert.ok(dy < 1e-6, 'longest side should be horizontal');
    assert.ok(q.x > p.x - 1e-6, 'longest side along +x');
  });

  it('keeps a small panel inside the sheet bbox', () => {
    const { panel, sheetW, sheetH } = layoutPanelOnSheet([400, 350, 300]);
    for (const p of panel) {
      assert.ok(p.x >= -1e-6 && p.x <= sheetW + 1e-6);
      assert.ok(p.y >= -1e-6 && p.y <= sheetH + 1e-6);
    }
  });

  it('allows a large panel to extend past the sheet', () => {
    const { panel, sheetW, sheetH } = layoutPanelOnSheet([3000, 2800, 2500]);
    const maxX = Math.max(...panel.map((p) => p.x));
    const maxY = Math.max(...panel.map((p) => p.y));
    assert.ok(maxX > sheetW || maxY > sheetH);
  });
});

describe('hubRayAngles', () => {
  it('spaces support gaps 37.7/322.3, not equal 180', () => {
    const gaps = [37.7, 322.3];
    const angs = hubRayAngles(gaps);
    assert.equal(angs.length, 2);
    assert.ok(Math.abs(angs[0] - -Math.PI / 2) < 1e-12);
    let d = ((angs[1] - angs[0]) * 180) / Math.PI;
    if (d < 0) d += 360;
    assert.ok(Math.abs(d - 37.7) < 1e-9, `gap ${d} should be 37.7`);
    assert.ok(Math.abs(d - 180) > 1, 'must not be equal spacing');
  });

  it('keeps equal gaps at equal spacing', () => {
    const angs = hubRayAngles([90, 90, 90, 90]);
    for (let i = 0; i < 4; i++) {
      const expect = -Math.PI / 2 + (i * Math.PI) / 2;
      assert.ok(Math.abs(angs[i] - expect) < 1e-12);
    }
  });
});
