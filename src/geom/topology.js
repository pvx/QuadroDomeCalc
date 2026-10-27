/**
 * Edges, triangles, normals, angle between outward normals.
 * Geometry only — not cut angles or structural design.
 */
import { isBoundaryNode } from './mesh.js';

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function len(v) {
  return Math.hypot(v.x, v.y, v.z);
}

function edgeKey(i, j) {
  return i < j ? `${i}|${j}` : `${j}|${i}`;
}

/**
 * @param {{ nodes: object[], faces: number[][] }} mesh
 * @param {{ a:number, c:number }} sphere
 */
export function buildTopology(mesh, sphere) {
  const { nodes, faces: rawFaces } = mesh;
  const sphereCenter = { x: 0, y: 0, z: sphere.c };

  const edgeMap = new Map();
  const triangles = [];

  function ensureEdge(i, j) {
    const k = edgeKey(i, j);
    if (!edgeMap.has(k)) {
      const A = nodes[i];
      const B = nodes[j];
      const length = Math.hypot(B.x - A.x, B.y - A.y, B.z - A.z);
      const onBoundary =
        isBoundaryNode(A, sphere.a) && isBoundaryNode(B, sphere.a);
      edgeMap.set(k, {
        id: edgeMap.size,
        startNodeId: Math.min(i, j),
        endNodeId: Math.max(i, j),
        length,
        category: onBoundary ? 'arch-boundary' : 'internal',
        typeId: null,
        triangleIds: [],
      });
    }
    return edgeMap.get(k);
  }

  rawFaces.forEach((nodeIds, fi) => {
    const [i0, i1, i2] = nodeIds;
    const A = nodes[i0];
    const B = nodes[i1];
    const C = nodes[i2];

    let n = cross(sub(B, A), sub(C, A));
    const nLen = len(n);
    if (nLen < 1e-14) return; // degenerate
    n = { x: n.x / nLen, y: n.y / nLen, z: n.z / nLen };

    // Outward = away from sphere center (0,0,c)
    const mid = {
      x: (A.x + B.x + C.x) / 3,
      y: (A.y + B.y + C.y) / 3,
      z: (A.z + B.z + C.z) / 3,
    };
    const fromCenter = sub(mid, sphereCenter);
    let oriented = [...nodeIds];
    if (dot(n, fromCenter) < 0) {
      n = { x: -n.x, y: -n.y, z: -n.z };
      oriented = [i0, i2, i1];
    }

    const e01 = ensureEdge(oriented[0], oriented[1]);
    const e12 = ensureEdge(oriented[1], oriented[2]);
    const e20 = ensureEdge(oriented[2], oriented[0]);
    const edgeIds = [e01.id, e12.id, e20.id];

    const sideLengths = [
      e01.length,
      e12.length,
      e20.length,
    ];
    // Recompute lengths in oriented order
    const P = [nodes[oriented[0]], nodes[oriented[1]], nodes[oriented[2]]];
    const sides = [
      len(sub(P[1], P[0])),
      len(sub(P[2], P[1])),
      len(sub(P[0], P[2])),
    ];
    const angles = [
      angleAt(P[0], P[1], P[2]),
      angleAt(P[1], P[2], P[0]),
      angleAt(P[2], P[0], P[1]),
    ];
    const area = 0.5 * len(cross(sub(P[1], P[0]), sub(P[2], P[0])));

    const tri = {
      id: triangles.length,
      nodeIds: oriented,
      edgeIds,
      sideLengths: sides,
      angles,
      area,
      normal: n,
    };
    triangles.push(tri);
    e01.triangleIds.push(tri.id);
    e12.triangleIds.push(tri.id);
    e20.triangleIds.push(tri.id);
  });

  // typeId by unique rounded length (mm if meters input — keep raw units)
  const edges = [...edgeMap.values()].sort((a, b) => a.id - b.id);
  const lengthBuckets = new Map();
  let typeCounter = 0;
  for (const e of edges) {
    const bucket = Math.round(e.length * 1e6) / 1e6; // stable key in model units
    if (!lengthBuckets.has(bucket)) {
      lengthBuckets.set(bucket, `L${++typeCounter}`);
    }
    e.typeId = lengthBuckets.get(bucket);
  }

  // Angle between outward normals for adjacent triangle pairs (shared edge)
  const normalAngles = [];
  for (const e of edges) {
    if (e.triangleIds.length !== 2) continue;
    const t0 = triangles[e.triangleIds[0]];
    const t1 = triangles[e.triangleIds[1]];
    const cos = Math.min(1, Math.max(-1, dot(t0.normal, t1.normal)));
    normalAngles.push({
      edgeId: e.id,
      triangleIds: [t0.id, t1.id],
      angleBetweenNormals: Math.acos(cos),
      note: 'Angle between outward normals — not the profile cut angle.',
    });
  }

  return {
    nodes,
    edges,
    triangles,
    normalAngles,
    edgeTypeCount: typeCounter,
  };
}

function angleAt(vertex, pPrev, pNext) {
  const u = sub(pPrev, vertex);
  const v = sub(pNext, vertex);
  const lu = len(u);
  const lv = len(v);
  if (lu < 1e-14 || lv < 1e-14) return 0;
  const cos = Math.min(1, Math.max(-1, dot(u, v) / (lu * lv)));
  return Math.acos(cos);
}
