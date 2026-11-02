import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  strutOverallLength,
  layoutPanelOnSheet,
  hubRayAngles,
  OSB_SHEET_MM,
  nestOverlapMm,
  packStockBars,
} from './drawings.js';

function piece(overallMm, cutA, cutB, widthMm = 150, extra = {}) {
  return { overallMm, cutA, cutB, widthMm, index: 'A', color: 'hsl(0, 78%, 52%)', ...extra };
}

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

describe('packStockBars', () => {
  it('packs three 1638 / 80°/80° on one 6000 bar; fourth needs a second', () => {
    const nest = nestOverlapMm(150, 80);
    assert.ok(Math.abs(nest - 150 * Math.tan((10 * Math.PI) / 180)) < 1e-9);

    const pieces = Array.from({ length: 4 }, () => piece(1638, 80, 80, 150));
    const { bars, barCount } = packStockBars(pieces, 6000, 3);
    assert.equal(barCount, 2);
    assert.equal(bars[0].pieces.length, 3);
    assert.equal(bars[1].pieces.length, 1);

    const b0 = bars[0].pieces;
    assert.equal(b0[0].flipped, false);
    assert.equal(b0[1].flipped, true);
    assert.equal(b0[2].flipped, false);

    const naive = 3 * 1638 + 2 * 3;
    assert.ok(bars[0].usedMm < naive - 1, `used ${bars[0].usedMm} should nest below ${naive}`);
  });

  it('joins 80°/80° with 70°/70° on one bar without nesting', () => {
    const a = piece(1000, 80, 80, 150);
    const b = piece(1000, 70, 70, 150);
    const { bars, barCount } = packStockBars([a, b], 6000, 3);
    assert.equal(barCount, 1);
    assert.equal(bars[0].pieces.length, 2);
    assert.equal(bars[0].pieces[1].nestMm, 0);
    assert.ok(Math.abs(bars[0].usedMm - (1000 + 3 + 1000)) < 1e-6);
  });

  it('packs 1781×2 @75° plus 2081 @72° onto one 6000 bar', () => {
    const pieces = [
      piece(1781, 75, 75, 150, { index: 'A' }),
      piece(1781, 75, 75, 150, { index: 'A' }),
      piece(2081, 72, 72, 150, { index: 'B' }),
    ];
    const { bars, barCount } = packStockBars(pieces, 6000, 3);
    assert.equal(barCount, 1);
    assert.equal(bars[0].pieces.length, 3);
    const naiveNoNest = 1781 + 3 + 1781 + 3 + 2081;
    assert.ok(
      bars[0].usedMm < naiveNoNest - 1,
      `used ${bars[0].usedMm} should nest the 75° pair below ${naiveNoNest}`,
    );
  });

  it('combines 70 + 30 with shared 80° into two bars instead of three', () => {
    const long = [piece(70, 80, 80, 150, { index: 'L' }), piece(70, 80, 80, 150, { index: 'L' })];
    const short = [
      piece(30, 80, 80, 150, { index: 'S' }),
      piece(30, 80, 80, 150, { index: 'S' }),
    ];
    // Same-length-only: two 70s cannot share a 100 bar (70+70-nest > 100)
    const onlyLong = packStockBars(long, 100, 0);
    const onlyShort = packStockBars(short, 100, 0);
    assert.equal(onlyLong.barCount, 2);
    assert.equal(onlyShort.barCount, 1);
    assert.equal(onlyLong.barCount + onlyShort.barCount, 3);

    const mixed = packStockBars([...long, ...short], 100, 0);
    assert.equal(mixed.barCount, 2);
  });

  it('square cuts: 4×4000 on 6000 need four bars', () => {
    const pieces = Array.from({ length: 4 }, () => piece(4000, 90, 90, 150));
    const { barCount } = packStockBars(pieces, 6000, 0);
    assert.equal(barCount, 4);
  });

  it('does not add kerf for a single piece', () => {
    const { bars, barCount } = packStockBars([piece(5900, 90, 90)], 6000, 50);
    assert.equal(barCount, 1);
    assert.equal(bars[0].usedMm, 5900);
  });

  it('leaves oversized pieces out of the bar count', () => {
    const { barCount, oversized } = packStockBars(
      [piece(7000, 80, 80), piece(1000, 80, 80)],
      6000,
      3,
    );
    assert.equal(barCount, 1);
    assert.equal(oversized.length, 1);
    assert.equal(oversized[0].overallMm, 7000);
  });

  it('returns 0 bars for an empty list', () => {
    const { barCount, bars, oversized } = packStockBars([], 6000, 3);
    assert.equal(barCount, 0);
    assert.equal(bars.length, 0);
    assert.equal(oversized.length, 0);
  });
});
