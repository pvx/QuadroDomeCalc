import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuadroGeometry, defaultAssumptionsMm } from './index.js';
import { applyPipedProducts, faceKey, PANEL_GAP_MM } from './piped.js';

function len(v) {
  return Math.hypot(v.x, v.y, v.z);
}
function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function scale(v, s) {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}
function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Min distance from segment pq to segment ab (sampled). */
function segDist(p, q, a, b) {
  function distPointToSeg(pt, a0, b0) {
    const ab = sub(b0, a0);
    const L2 = dot(ab, ab) || 1;
    let t = dot(sub(pt, a0), ab) / L2;
    t = Math.max(0, Math.min(1, t));
    return len(sub(pt, add(a0, scale(ab, t))));
  }
  let mn = Infinity;
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const pt = add(scale(p, 1 - t), scale(q, t));
    mn = Math.min(mn, distPointToSeg(pt, a, b));
  }
  return mn;
}

/** Panel edge for triangle edge index k (corners[i]=meet of lines i and i+1). */
function panelEdge(corners, k) {
  return [corners[(k + 2) % 3], corners[k]];
}

describe('applyPipedProducts', () => {
  const d = defaultAssumptionsMm();
  const geom = buildQuadroGeometry({ a: d.a, h: d.h, n: 6, units: 'mm' });
  const mats = { pipeD: 108, beamsWidth: 200, beamsThickness: 60 };
  const products = applyPipedProducts(geom, mats);

  it('shortens every edge vs chord', () => {
    assert.equal(products.edgeProducts.length, geom.edges.length);
    for (const e of products.edgeProducts) {
      assert.ok(e.cutLength < e.chord, `cut ${e.cutLength} >= chord ${e.chord}`);
      assert.ok(e.cutLength > 0);
      assert.ok(Number.isFinite(e.bevelSides[0]));
      assert.ok(Number.isFinite(e.bevelInner));
    }
  });

  it('groups edges faces hubs', () => {
    assert.ok(products.edgeGroups.length >= 1);
    assert.ok(products.faceGroups.length >= 1);
    assert.ok(products.hubGroups.length >= 1);
    assert.equal(products.faceProducts.length, geom.triangles.length);
    assert.ok(products.stats.timberTotalMm < products.stats.chordTotalMm);
  });

  it('larger pipe shortens more', () => {
    const small = applyPipedProducts(geom, { ...mats, pipeD: 50 });
    const large = applyPipedProducts(geom, { ...mats, pipeD: 150 });
    assert.ok(large.stats.timberTotalMm < small.stats.timberTotalMm);
  });

  it('mirror faces share the same group key', () => {
    const sides = [100, 150, 180];
    const angs = [40, 60, 80];
    const mirSides = [180, 150, 100];
    const mirAngs = [40, 80, 60];
    assert.equal(faceKey(sides, angs), faceKey(mirSides, mirAngs));
  });

  it('edges have endCutDeg; hubs have polar/gap; groups ≤ items', () => {
    for (const e of products.edgeProducts) {
      assert.ok(Number.isFinite(e.endCutDegA));
      assert.ok(Number.isFinite(e.endCutDegB));
      assert.ok(e.endCutDegA >= 0 && e.endCutDegA <= 90);
      assert.ok(e.endCutDegB >= 0 && e.endCutDegB <= 90);
    }
    for (const h of products.hubs.filter((x) => x.valence > 0)) {
      assert.equal(h.gapDeg.length, h.valence);
      assert.equal(h.rays.length, h.valence);
      let sum = 0;
      for (let i = 0; i < h.valence; i++) {
        assert.ok(Number.isFinite(h.rays[i].polarDeg));
        assert.ok(h.rays[i].polarDeg >= 0 && h.rays[i].polarDeg <= 180);
        sum += h.gapDeg[i];
      }
      assert.ok(Math.abs(sum - 360) < 1.5, `gap sum ${sum}`);
    }
    assert.ok(products.edgeGroups.length <= products.edgeProducts.length);
    assert.ok(products.faceGroups.length <= products.faceProducts.length);
    assert.ok(
      products.hubGroups.length <= products.hubs.filter((h) => h.valence > 0).length,
    );
  });

  it('panels sit on timber tops with 5–10 mm gap between neighbors', () => {
    assert.equal(products.panelGapMm, PANEL_GAP_MM);
    assert.equal(PANEL_GAP_MM, 8);
    const byEdge = new Map();
    for (const f of products.faceProducts) {
      assert.equal(f.corners.length, 3);
      for (let k = 0; k < 3; k++) {
        const eid = f.edgeIds[k];
        if (!byEdge.has(eid)) byEdge.set(eid, []);
        byEdge.get(eid).push({ corners: f.corners, k });
      }
    }
    let paired = 0;
    for (const [, arr] of byEdge) {
      if (arr.length !== 2) continue;
      paired++;
      const [p, q] = panelEdge(arr[0].corners, arr[0].k);
      const [u, v] = panelEdge(arr[1].corners, arr[1].k);
      const gap = segDist(p, q, u, v);
      assert.ok(gap >= 5 && gap <= 10, `gap ${gap} mm outside 5–10`);
    }
    assert.ok(paired > 0);
  });
});
