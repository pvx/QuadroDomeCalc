/**
 * Parametric XY grid triangulation.
 * Square (a=b): D4 via 90° rotation. Rectangle: mirror four quadrants.
 */
import { surfaceZ, GEOM_EPS } from './sphere.js';

/**
 * @param {*} sphere from sphereFromSupports
 * @param {number} n even number of cells per side
 */
export function buildSymmetricXYMesh(sphere, n) {
  const N = Math.floor(n);
  if (N < 2 || N % 2 !== 0) {
    throw new Error(`n must be an even integer ≥ 2 (got ${n}).`);
  }

  const a = sphere.a;
  const b = sphere.b ?? a;
  const half = N / 2;
  const halfA = a / 2;
  const halfB = b / 2;
  const square = Math.abs(a - b) <= GEOM_EPS;

  // Quadrant nodes: i=0..half, j=0..half → x,y in [0, a/2]×[0, b/2]
  const qIndex = (i, j) => i * (half + 1) + j;
  const qNodes = [];
  for (let i = 0; i <= half; i++) {
    for (let j = 0; j <= half; j++) {
      const x = (i / half) * halfA;
      const y = (j / half) * halfB;
      qNodes.push({ x, y, z: surfaceZ(x, y, sphere), qi: i, qj: j });
    }
  }

  // Quadrant faces: cells i=0..half-1, j=0..half-1
  // Alternating diagonal inside quadrant (local); D4 comes from rotation when square.
  const qFaces = [];
  for (let i = 0; i < half; i++) {
    for (let j = 0; j < half; j++) {
      const a00 = qIndex(i, j);
      const a10 = qIndex(i + 1, j);
      const a01 = qIndex(i, j + 1);
      const a11 = qIndex(i + 1, j + 1);
      // Apex cell (0,0): use axis diamond (a10–a01), not apex→corner diagonal.
      // Skip when half===1 (n=2): that cell is the support corner, flipped later.
      if ((i + j) % 2 === 0 && !(i === 0 && j === 0 && half > 1)) {
        qFaces.push([a00, a10, a11], [a00, a11, a01]);
      } else {
        qFaces.push([a00, a10, a01], [a10, a11, a01]);
      }
    }
  }

  // Rotate / mirror quadrant and merge nodes by rounded key
  const keyOf = (p) =>
    `${Math.round(p.x / GEOM_EPS)},${Math.round(p.y / GEOM_EPS)},${Math.round(p.z / GEOM_EPS)}`;

  const nodes = [];
  const keyToId = new Map();

  function addNode(p) {
    const k = keyOf(p);
    if (keyToId.has(k)) return keyToId.get(k);
    const id = nodes.length;
    nodes.push({ id, x: p.x, y: p.y, z: p.z });
    keyToId.set(k, id);
    return id;
  }

  function rot90(p, k) {
    let x = p.x;
    let y = p.y;
    const z = p.z;
    for (let t = 0; t < k; t++) {
      const nx = -y;
      const ny = x;
      x = nx;
      y = ny;
    }
    return { x, y, z };
  }

  // Sign patterns for four quadrants: (++), (-+), (--), (+-)
  const mirrors = [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ];

  const faces = [];
  if (square) {
    for (let k = 0; k < 4; k++) {
      const mapLocal = qNodes.map((p) => addNode(rot90(p, k)));
      for (const f of qFaces) {
        faces.push(f.map((li) => mapLocal[li]));
      }
    }
  } else {
    for (let q = 0; q < 4; q++) {
      const [sx, sy] = mirrors[q];
      const mapLocal = qNodes.map((p) =>
        addNode({ x: sx * p.x, y: sy * p.y, z: p.z }),
      );
      // Odd mirrors reverse winding so normals stay outward.
      const flip = sx * sy < 0;
      for (const f of qFaces) {
        const ids = f.map((li) => mapLocal[li]);
        faces.push(flip ? [ids[0], ids[2], ids[1]] : ids);
      }
    }
  }

  return {
    generator: square ? 'symmetric-xy-grid' : 'mirror-xy-grid',
    note: square
      ? 'Parametric engineering approximation (uniform XY grid + D4). ' +
        'Not an exact copy of the drawing mesh and not a classic geodesic mesh. ' +
        'Edge lengths can be uneven.'
      : 'Parametric engineering approximation (uniform XY grid + mirrors for a≠b). ' +
        'Not an exact copy of the drawing mesh and not a classic geodesic mesh. ' +
        'Edge lengths can be uneven.',
    n: N,
    nodes,
    faces,
  };
}

/**
 * Classify boundary: node on support rectangle |x|=a/2 or |y|=b/2 (within tol).
 */
export function isBoundaryNode(node, a, b = a, tol = 1e-8) {
  const halfA = a / 2;
  const halfB = b / 2;
  return (
    Math.abs(Math.abs(node.x) - halfA) <= tol ||
    Math.abs(Math.abs(node.y) - halfB) <= tol
  );
}

function findNodeXY(nodes, x, y, tol = GEOM_EPS * 10) {
  for (let i = 0; i < nodes.length; i++) {
    const p = nodes[i];
    if (Math.abs(p.x - x) <= tol && Math.abs(p.y - y) <= tol) return i;
  }
  return -1;
}

/**
 * At each support corner: remove diagonal S–O (support → inner cell corner),
 * add brace nX–nY between the two arch neighbors. Mutates mesh.faces.
 */
export function flipSupportCornerDiagonals(mesh, a, b = a) {
  const { nodes, faces, n } = mesh;
  const halfA = a / 2;
  const halfB = b / 2;
  const stepX = a / n;
  const stepY = b / n;
  const signs = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];

  for (const [sx, sy] of signs) {
    const S = findNodeXY(nodes, sx * halfA, sy * halfB);
    const nX = findNodeXY(nodes, sx * (halfA - stepX), sy * halfB);
    const nY = findNodeXY(nodes, sx * halfA, sy * (halfB - stepY));
    const O = findNodeXY(nodes, sx * (halfA - stepX), sy * (halfB - stepY));
    if (S < 0 || nX < 0 || nY < 0 || O < 0) {
      throw new Error('Support-corner nodes for the brace were not found.');
    }

    const keep = [];
    let removed = 0;
    for (const f of faces) {
      if (f.includes(S) && f.includes(O)) {
        removed++;
        continue;
      }
      keep.push(f);
    }
    if (removed !== 2) {
      throw new Error(
        `Expected 2 faces with the support diagonal, found ${removed} (corner ${sx},${sy}).`,
      );
    }
    // Same coverage as [O,nX,S]+[O,S,nY] with diagonal flipped to nX–nY
    keep.push([O, nX, nY], [nX, S, nY]);
    faces.length = 0;
    faces.push(...keep);
  }
  return mesh;
}
