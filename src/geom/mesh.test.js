import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sphereFromSupports } from './sphere.js';
import { buildSymmetricXYMesh } from './mesh.js';
import { buildTopology } from './topology.js';
import { aFromDiagonalOnAxes, REFERENCE_MM, buildQuadroGeometry } from './index.js';

function rotate90(p) {
  return { x: -p.y, y: p.x, z: p.z };
}

describe('symmetric XY mesh', () => {
  const a = aFromDiagonalOnAxes(REFERENCE_MM.diagonalOnAxes);
  const h = REFERENCE_MM.heightSurface;
  const sphere = sphereFromSupports(a, h);

  it('requires even n', () => {
    assert.throws(() => buildSymmetricXYMesh(sphere, 3), /even integer/);
  });

  it('node count equals (n+1)²', () => {
    const n = 8;
    const mesh = buildSymmetricXYMesh(sphere, n);
    assert.equal(mesh.nodes.length, (n + 1) * (n + 1));
  });

  it('has D4 rotational symmetry of nodes', () => {
    const mesh = buildSymmetricXYMesh(sphere, 6);
    const key = (p) =>
      `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)},${Math.round(p.z * 1e6)}`;
    const set = new Set(mesh.nodes.map(key));
    for (const p of mesh.nodes) {
      let q = p;
      for (let k = 0; k < 4; k++) {
        q = rotate90(q);
        assert.ok(set.has(key(q)), 'missing rotate image of node');
      }
    }
  });

  it('outward normals point away from sphere center', () => {
    const mesh = buildSymmetricXYMesh(sphere, 4);
    const topo = buildTopology(mesh, sphere);
    const C = { x: 0, y: 0, z: sphere.c };
    for (const t of topo.triangles) {
      const [i, j, k] = t.nodeIds;
      const mid = {
        x: (mesh.nodes[i].x + mesh.nodes[j].x + mesh.nodes[k].x) / 3,
        y: (mesh.nodes[i].y + mesh.nodes[j].y + mesh.nodes[k].y) / 3,
        z: (mesh.nodes[i].z + mesh.nodes[j].z + mesh.nodes[k].z) / 3,
      };
      const outward =
        t.normal.x * (mid.x - C.x) +
        t.normal.y * (mid.y - C.y) +
        t.normal.z * (mid.z - C.z);
      assert.ok(outward > 0, 'normal not outward');
    }
  });

  it('buildQuadroGeometry returns edges with unique endpoints', () => {
    const g = buildQuadroGeometry({ a, h, n: 8, units: 'mm', supportBrace: false });
    const keys = new Set();
    for (const e of g.edges) {
      const k = `${e.startNodeId}|${e.endNodeId}`;
      assert.ok(!keys.has(k));
      keys.add(k);
      assert.ok(e.category === 'internal' || e.category === 'arch-boundary');
      assert.ok(e.typeId);
    }
    assert.equal(g.meta.safeForConstruction, false);
    assert.ok(g.arches.midHeightIdeal > 0);
  });

  it('supportBrace flips corner diagonal on all 4 supports', () => {
    const n = 8;
    const step = a / n;
    const halfA = a / 2;
    const off = buildQuadroGeometry({ a, h, n, units: 'mm', supportBrace: false });
    const on = buildQuadroGeometry({ a, h, n, units: 'mm', supportBrace: true });

    const hasEdge = (g, i, j) =>
      g.edges.some(
        (e) =>
          (e.startNodeId === i && e.endNodeId === j) ||
          (e.startNodeId === j && e.endNodeId === i),
      );

    const findXY = (nodes, x, y) => {
      const id = nodes.findIndex(
        (p) => Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6,
      );
      assert.ok(id >= 0, `node ${x},${y}`);
      return id;
    };

    for (const [sx, sy] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      const S = findXY(off.nodes, sx * halfA, sy * halfA);
      const nX = findXY(off.nodes, sx * (halfA - step), sy * halfA);
      const nY = findXY(off.nodes, sx * halfA, sy * (halfA - step));
      const O = findXY(off.nodes, sx * (halfA - step), sy * (halfA - step));

      assert.ok(hasEdge(off, S, O), 'OFF keeps S–O');
      assert.ok(!hasEdge(off, nX, nY), 'OFF has no nX–nY');

      const S2 = findXY(on.nodes, sx * halfA, sy * halfA);
      const nX2 = findXY(on.nodes, sx * (halfA - step), sy * halfA);
      const nY2 = findXY(on.nodes, sx * halfA, sy * (halfA - step));
      const O2 = findXY(on.nodes, sx * (halfA - step), sy * (halfA - step));
      assert.ok(!hasEdge(on, S2, O2), 'ON removes S–O');
      assert.ok(hasEdge(on, nX2, nY2), 'ON adds nX–nY');
    }
  });
});
