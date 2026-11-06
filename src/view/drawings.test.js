import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  strutOverallLength,
  edgeCutListJson,
  layoutPanelOnSheet,
  hubRayAngles,
  OSB_SHEET_MM,
  nestOverlapMm,
  packStockBars,
  earTrapezoid,
  earPairLengthMm,
  earPerimeterMm,
  earSlantLenMm,
  earSheetsCutLengthMm,
  earHoleCenters,
  earsFromEdgeProducts,
  hubColorByNodeFromGroups,
  packEarSheets,
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

describe('edgeCutListJson', () => {
  it('emits string fields; length is overall', () => {
    const groups = [
      {
        index: 'A',
        count: 4,
        sample: {
          cutLength: 1200,
          width: 200,
          endCutDegA: 10,
          endCutDegB: 15,
        },
      },
    ];
    const overall = Math.round(strutOverallLength(1200, 200, 10, 15));
    const data = JSON.parse(edgeCutListJson(groups, 6000));
    assert.deepEqual(data, {
      r: '6000',
      rows: [{ name: 'A', length: String(overall), qty: '4' }],
    });
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

function makeEar(endCutDeg, lengthMm = 200, widthMm = 150) {
  const t = earTrapezoid(lengthMm, widthMm, endCutDeg);
  return {
    edgeId: 0,
    endCutDeg,
    lengthMm: t.L,
    widthMm: t.W,
    shortMm: t.S,
    areaMm2: t.area,
    valid: t.valid,
  };
}

describe('earTrapezoid', () => {
  it('α = 0 is a rectangle with area L·W', () => {
    const t = earTrapezoid(200, 150, 0);
    assert.equal(t.S, 200);
    assert.equal(t.area, 200 * 150);
    assert.ok(t.valid);
  });

  it('α = 45°, W = 100, L = 200 → S = 100', () => {
    const t = earTrapezoid(200, 100, 45);
    assert.ok(Math.abs(t.S - 100) < 1e-9);
    assert.ok(t.valid);
  });

  it('marks invalid when short side ≤ 0', () => {
    const t = earTrapezoid(100, 150, 45);
    assert.ok(t.S <= 0);
    assert.equal(t.valid, false);
  });
});

describe('earPairLengthMm', () => {
  it('α = 0, g = 0 → pair length 2L', () => {
    assert.equal(earPairLengthMm(200, 150, 0, 0), 400);
  });

  it('α = 45°, W = 100, L = 200, g = 0 → pair length 300', () => {
    assert.ok(Math.abs(earPairLengthMm(200, 100, 45, 0) - 300) < 1e-9);
  });

  it('g = 3, α = 0 → pair length 2L + 3', () => {
    assert.equal(earPairLengthMm(200, 150, 0, 3), 403);
  });

  it('g = 3, α = 45° → adds 3/cos(45°)', () => {
    const add = 3 / Math.cos((45 * Math.PI) / 180);
    const got = earPairLengthMm(200, 100, 45, 3);
    assert.ok(Math.abs(got - (300 + add)) < 1e-9);
  });
});

describe('earHoleCenters', () => {
  it('places C holes at k·L/(C+1) when α = 0', () => {
    const holes = earHoleCenters(200, 150, 2, 12, 0);
    assert.equal(holes.length, 2);
    assert.ok(Math.abs(holes[0].x - 200 / 3) < 1e-9);
    assert.ok(Math.abs(holes[1].x - 400 / 3) < 1e-9);
    assert.equal(holes[0].y, 75);
    assert.equal(holes[0].r, 6);
  });

  it('spaces holes along short side S away from the slant', () => {
    // L=200, W=100, α=45° → S=100
    const holes = earHoleCenters(200, 100, 2, 12, 45);
    assert.equal(holes.length, 2);
    assert.ok(Math.abs(holes[0].x - 100 / 3) < 1e-9);
    assert.ok(Math.abs(holes[1].x - 200 / 3) < 1e-9);
    assert.ok(holes[1].x < 100);
  });
});

describe('earsFromEdgeProducts', () => {
  it('emits one ear per strut end', () => {
    const edges = [
      { edgeId: 1, endCutDegA: 10, endCutDegB: 12 },
      { edgeId: 2, endCutDegA: 0, endCutDegB: 5 },
    ];
    const ears = earsFromEdgeProducts(edges, 200, 150);
    assert.equal(ears.length, 4);
    assert.equal(ears[0].endCutDeg, 10);
    assert.equal(ears[1].endCutDeg, 12);
  });

  it('tags each ear with hub node color', () => {
    const edges = [
      { edgeId: 1, startNodeId: 3, endNodeId: 7, endCutDegA: 10, endCutDegB: 12 },
    ];
    const colors = new Map([
      [3, 'hsl(0, 78%, 52%)'],
      [7, 'hsl(47, 78%, 52%)'],
    ]);
    const ears = earsFromEdgeProducts(edges, 200, 150, colors);
    assert.equal(ears[0].hubNodeId, 3);
    assert.equal(ears[0].hubColor, 'hsl(0, 78%, 52%)');
    assert.equal(ears[1].hubNodeId, 7);
    assert.equal(ears[1].hubColor, 'hsl(47, 78%, 52%)');
  });
});

describe('hubColorByNodeFromGroups', () => {
  it('maps unit id → group color', () => {
    const map = hubColorByNodeFromGroups([
      { color: 'red', units: [{ id: 1 }, { id: 2 }] },
      { color: 'blue', units: [{ id: 5 }] },
    ]);
    assert.equal(map.get(1), 'red');
    assert.equal(map.get(5), 'blue');
  });
});

describe('packEarSheets', () => {
  it('packs four identical ears on a large sheet → 1 sheet', () => {
    const ears = [0, 0, 0, 0].map((a) => makeEar(a));
    const packed = packEarSheets(ears, 1500, 3000, 0);
    assert.equal(packed.sheetCount, 1);
    assert.equal(packed.oversized.length, 0);
    assert.equal(packed.invalid.length, 0);
    const n = packed.sheets[0].placements.reduce(
      (s, p) => s + p.ears.length,
      0,
    );
    assert.equal(n, 4);
  });

  it('single ear uses L×W bbox', () => {
    const packed = packEarSheets([makeEar(0)], 1500, 3000, 0);
    assert.equal(packed.sheetCount, 1);
    assert.equal(packed.sheets[0].placements.length, 1);
    const pl = packed.sheets[0].placements[0];
    assert.equal(pl.kind, 'single');
    assert.equal(pl.boxW, 200);
    assert.equal(pl.boxH, 150);
  });

  it('marks oversized when ear exceeds both sheet sides', () => {
    const ears = [makeEar(0, 4000, 2000)];
    const packed = packEarSheets(ears, 1500, 3000, 0);
    assert.equal(packed.sheetCount, 0);
    assert.equal(packed.oversized.length, 1);
  });

  it('pair area matches two trapezoids; scrap uses sheet area', () => {
    const ears = [makeEar(0), makeEar(0)];
    const packed = packEarSheets(ears, 1500, 3000, 0);
    assert.equal(packed.totalAreaMm2, 2 * 200 * 150);
    assert.equal(packed.sheetCount, 1);
    const expectedScrap =
      (1500 * 3000 - packed.totalAreaMm2) / (1500 * 3000);
    assert.ok(Math.abs(packed.scrapRatio - expectedScrap) < 1e-12);
  });

  it('invalid ears stay out of sheets', () => {
    const ears = [makeEar(45, 100, 150)];
    const packed = packEarSheets(ears, 1500, 3000, 0);
    assert.equal(packed.invalid.length, 1);
    assert.equal(packed.sheetCount, 0);
  });

  it('cut length shares slant and sides when gap = 0', () => {
    // One nested pair, α=0 → rectangle 400×150; perimeter each = 2*(200+150)=700
    // Shared slant when α=0 is the short vertical? α=0 slant = W = 150
    const ears = [makeEar(0), makeEar(0)];
    const withGap = packEarSheets(ears, 1500, 3000, 3, {
      count: 0,
      diameterMm: 0,
    });
    const noGap = packEarSheets(ears, 1500, 3000, 0, {
      count: 0,
      diameterMm: 0,
    });
    const peri = earPerimeterMm(200, 150, 0);
    assert.equal(peri, 700);
    assert.equal(earSlantLenMm(200, 150, 0), 150);
    // g>0: both full perimeters
    assert.ok(Math.abs(withGap.cutLengthMm - 2 * peri) < 1e-6);
    // g=0: minus shared slant once
    assert.ok(Math.abs(noGap.cutLengthMm - (2 * peri - 150)) < 1e-6);
  });

  it('cut length shares touching pair sides when gap = 0', () => {
    // Two α=0 pairs on one row → touch on vertical W=150
    const ears = [0, 0, 0, 0].map((a) => makeEar(a));
    const packed = packEarSheets(ears, 1500, 3000, 0, {
      count: 0,
      diameterMm: 0,
    });
    const peri = earPerimeterMm(200, 150, 0);
    const slant = earSlantLenMm(200, 150, 0);
    // 4 ears, 2 pairs → −2 slants; pairs touch → −1 side W
    const expected = 4 * peri - 2 * slant - 150;
    assert.ok(Math.abs(packed.cutLengthMm - expected) < 1e-6);
    assert.ok(
      Math.abs(
        earSheetsCutLengthMm(packed.sheets, 0, 0, 0) - packed.cutLengthMm,
      ) < 1e-9,
    );
  });

  it('fills row residual with shorter pairs instead of leaving a gap', () => {
    // α=0 → pair 400; α=45°, W=150 → pair 250. Sheet 1100: 2×400 leaves 300.
    const L = 200;
    const W = 150;
    const longs = Array.from({ length: 6 }, () => makeEar(0, L, W)); // 3 pairs
    const shorts = Array.from({ length: 2 }, () => makeEar(45, L, W)); // 1 pair
    const sheetW = 1100;
    const packed = packEarSheets([...longs, ...shorts], sheetW, 3000, 0);
    assert.equal(packed.sheetCount, 1);
    assert.equal(packed.oversized.length, 0);

    const shortPair = earPairLengthMm(L, W, 45, 0);
    assert.ok(Math.abs(shortPair - 250) < 1e-9);

    const rows = new Map();
    for (const pl of packed.sheets[0].placements) {
      const key = Math.round(pl.y * 10) / 10;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(pl);
    }
    const mixed = [...rows.values()].filter(
      (pls) =>
        pls.some((p) => p.alpha === 0) && pls.some((p) => p.alpha === 45),
    );
    assert.ok(mixed.length >= 1, 'short pair should fill a long-pair row gap');
    for (const pls of mixed) {
      const used = pls.reduce((s, p) => s + p.boxW, 0);
      assert.ok(
        sheetW - used < shortPair - 1e-6,
        `mixed row leftover ${sheetW - used} still fits short pair`,
      );
    }
  });
});
