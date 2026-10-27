import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuadroGeometry, defaultAssumptionsMm } from './index.js';
import {
  applyPipedProducts,
  HUB_GAP_MM,
  hubCut,
  hubWallNormal,
} from './piped.js';
import { timberSegment, timberPrism } from './members.js';

function len(v) {
  return Math.hypot(v.x, v.y, v.z);
}
function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function scale(v, s) {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}
function norm(v) {
  const L = len(v) || 1;
  return { x: v.x / L, y: v.y / L, z: v.z / L };
}

describe('timberSegment', () => {
  const d = defaultAssumptionsMm();
  const geom = buildQuadroGeometry({ a: d.a, h: d.h, n: 6, units: 'mm' });
  const products = applyPipedProducts(geom, {
    pipeD: 108,
    beamsWidth: 200,
    beamsThickness: 60,
  });
  const center = { x: 0, y: 0, z: geom.sphere.c };

  it('length matches cutLength; frame orthonormal; width outward', () => {
    for (const ep of products.edgeProducts) {
      const A = geom.nodes[ep.startNodeId];
      const B = geom.nodes[ep.endNodeId];
      const mid = {
        x: (A.x + B.x) / 2,
        y: (A.y + B.y) / 2,
        z: (A.z + B.z) / 2,
      };
      const outward = {
        x: mid.x - center.x,
        y: mid.y - center.y,
        z: mid.z - center.z,
      };
      const seg = timberSegment(A, B, ep.cutA, ep.cutB, outward);

      assert.ok(
        Math.abs(seg.length - ep.cutLength) < 1e-6,
        `length ${seg.length} vs cut ${ep.cutLength}`,
      );
      assert.ok(Math.abs(len(seg.axisX) - 1) < 1e-9);
      assert.ok(Math.abs(len(seg.axisY) - 1) < 1e-9);
      assert.ok(Math.abs(len(seg.axisZ) - 1) < 1e-9);
      assert.ok(Math.abs(dot(seg.axisX, seg.axisY)) < 1e-9);
      assert.ok(Math.abs(dot(seg.axisY, seg.axisZ)) < 1e-9);
      assert.ok(Math.abs(dot(seg.axisZ, seg.axisX)) < 1e-9);
      assert.ok(dot(seg.axisZ, outward) > 0, 'width axis should point outward');
    }
  });
});

describe('hub gap and timberPrism', () => {
  const d = defaultAssumptionsMm();
  const geom = buildQuadroGeometry({ a: d.a, h: d.h, n: 6, units: 'mm' });
  const mats = { pipeD: 108, beamsWidth: 200, beamsThickness: 60 };
  const products = applyPipedProducts(geom, mats);
  const center = { x: 0, y: 0, z: geom.sphere.c };
  const pipeR = mats.pipeD / 2;

  it('gap increases cut vs pipe wall only', () => {
    const e = geom.edges[0];
    const A = geom.nodes[e.startNodeId];
    const B = geom.nodes[e.endNodeId];
    const dir = norm(sub(B, A));
    const radA = norm(sub(A, center));
    const wallOnly = hubCut(pipeR, dir, radA);
    const withGap = hubCut(pipeR + HUB_GAP_MM, dir, radA);
    assert.ok(withGap > wallOnly);
    assert.equal(products.hubGapMm, 5);
    const ep0 = products.edgeProducts.find((p) => p.edgeId === e.id);
    assert.ok(Math.abs(withGap - ep0.cutA) < 1e-6);
  });

  it('prism ends parallel to pipe axis; offset ≈ pipeR+gap', () => {
    for (const ep of products.edgeProducts) {
      const A = geom.nodes[ep.startNodeId];
      const B = geom.nodes[ep.endNodeId];
      const radA = norm(sub(A, center));
      const radB = norm(sub(B, center));
      const prism = timberPrism(
        A,
        B,
        ep.cutA,
        ep.cutB,
        radA,
        radB,
        mats.beamsThickness,
        mats.beamsWidth,
      );
      assert.equal(prism.cornersA.length, 4);
      assert.equal(prism.cornersB.length, 4);

      // edges on end face A should be || radial (dot with wallN varies; face edges ⊥ wallN)
      const nA = hubWallNormal(norm(sub(B, A)), radA);
      for (let i = 0; i < 4; i++) {
        const p = prism.cornersA[i];
        const q = prism.cornersA[(i + 1) % 4];
        const edge = sub(q, p);
        assert.ok(
          Math.abs(dot(edge, nA)) < 1e-3 * (len(edge) + 1),
          'end-face edge should lie in cut plane',
        );
        // cut plane || pipe: edge · radial can be nonzero if edge along width;
        // face contains radial direction component — check plane || radial:
        assert.ok(
          Math.abs(dot(nA, radA)) < 1e-6,
          'cut normal ⊥ pipe axis',
        );
      }

      // distance from hub A to plane ≈ pipeR+gap (along wallN)
      const clear = pipeR + HUB_GAP_MM;
      for (const p of prism.cornersA) {
        const dist = Math.abs(dot(sub(p, A), nA));
        assert.ok(
          Math.abs(dist - clear) < 0.05,
          `dist ${dist} vs clear ${clear}`,
        );
      }
    }
  });
});
