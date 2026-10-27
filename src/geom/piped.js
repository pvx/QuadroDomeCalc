/**
 * Piped hub + timber cutting layer (engineering approximation, not Acidome clone).
 * Input geom units: mm. Timber/pipe also mm.
 *
 * cutLength ≈ chord − cutA − cutB, cut ≈ (pipeR+gap) / |dir·wallN|
 * End face || pipe axis (radial). Bevels from face normals — not CNC-certified.
 * Cover panels sit on timber top faces with PANEL_GAP_MM between neighbors.
 */

import { timberPrism } from './members.js';

/** Clearance between timber end face and pipe outer wall (mm). */
export const HUB_GAP_MM = 5;

/** Gap between neighboring cover panels on timber tops (mm). */
export const PANEL_GAP_MM = 8;

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
function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function len(v) {
  return Math.hypot(v.x, v.y, v.z);
}
function norm(v) {
  const L = len(v) || 1;
  return { x: v.x / L, y: v.y / L, z: v.z / L };
}

/**
 * Normal of timber end plane at hub: ⊥ pipe axis (radial), in strut–radial plane.
 * Oriented so dot(n, strutDir) ≥ 0 (points into the timber along the strut).
 */
export function hubWallNormal(strutDir, radial) {
  const side = cross(strutDir, radial);
  if (len(side) < 1e-12) {
    // strut || radial: pick any ⊥ to radial
    const ref =
      Math.abs(radial.z) < 0.9
        ? { x: 0, y: 0, z: 1 }
        : { x: 1, y: 0, z: 0 };
    let n = norm(cross(radial, ref));
    if (dot(n, strutDir) < 0) n = scale(n, -1);
    return n;
  }
  let wallN = norm(cross(side, radial));
  if (dot(wallN, strutDir) < 0) wallN = scale(wallN, -1);
  return wallN;
}

/**
 * Distance along strut from hub node to end plane at offset `clearance` from pipe axis.
 * End plane || pipe axis. clearance = pipeR + gap.
 */
export function hubCut(clearance, strutDir, radial) {
  const wallN = hubWallNormal(strutDir, radial);
  const cos = Math.abs(dot(wallN, strutDir));
  if (cos < 1e-6) return clearance;
  return clearance / cos;
}

/** End-cut angle vs square cut (deg): acos(|dir·wallN|). */
export function endCutDeg(strutDir, radial) {
  const wallN = hubWallNormal(strutDir, radial);
  const cos = Math.min(1, Math.max(0, Math.abs(dot(wallN, strutDir))));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Rotate ring of tokens to lexicographically smallest joining. */
function canonicalRing(tokens) {
  if (!tokens.length) return '';
  let best = null;
  for (let i = 0; i < tokens.length; i++) {
    const s = tokens.slice(i).concat(tokens.slice(0, i)).join(';');
    if (best == null || s < best) best = s;
  }
  return best;
}

/** Reverse winding (mirror), vertex 0 fixed: sides/angles stay matched to edges/verts. */
function mirrorFace(sideLengths, anglesDeg) {
  const n = sideLengths.length;
  const sides = [sideLengths[n - 1]];
  const angs = [anglesDeg[0]];
  for (let k = n - 1; k >= 1; k--) {
    sides.push(sideLengths[k - 1]);
    angs.push(anglesDeg[k]);
  }
  return { sides, angs };
}

/** Min key over rotations and mirror — enantiomers count as one type. */
export function faceKey(sideLengths, anglesDeg) {
  const n = sideLengths.length;
  let best = null;
  const variants = [
    { sides: sideLengths, angs: anglesDeg },
    mirrorFace(sideLengths, anglesDeg),
  ];
  for (const v of variants) {
    for (let i = 0; i < n; i++) {
      const sides = [];
      const angs = [];
      for (let k = 0; k < n; k++) {
        sides.push(Math.round(v.sides[(i + k) % n]));
        angs.push(Math.round(v.angs[(i + k) % n] * 10) / 10);
      }
      const s = `${sides.join('x')}|${angs.join(',')}`;
      if (best == null || s < best) best = s;
    }
  }
  return best;
}

/**
 * @param {ReturnType<import('./index.js').buildQuadroGeometry>} geom
 * @param {{ pipeD:number, beamsWidth:number, beamsThickness:number, hubGapMm?:number, panelGapMm?:number }} mats mm
 */
export function applyPipedProducts(geom, mats) {
  const pipeD = Math.max(1, mats.pipeD);
  const beamsWidth = Math.max(1, mats.beamsWidth);
  const beamsThickness = Math.max(1, mats.beamsThickness);
  const hubGapMm = Math.max(0, mats.hubGapMm ?? HUB_GAP_MM);
  const panelGapMm = Math.max(0, mats.panelGapMm ?? PANEL_GAP_MM);
  const pipeR = pipeD / 2;
  const { nodes, edges, triangles, normalAngles, sphere } = geom;
  const center = { x: 0, y: 0, z: sphere.c };

  const angleByEdge = new Map();
  for (const na of normalAngles) {
    angleByEdge.set(na.edgeId, na.angleBetweenNormals);
  }

  const edgeProducts = edges.map((e) => {
    const A = nodes[e.startNodeId];
    const B = nodes[e.endNodeId];
    const chord = e.length;
    const dir = norm(sub(B, A));
    const radA = norm(sub(A, center));
    const radB = norm(sub(B, center));

    const clear = pipeR + hubGapMm;
    const cutA = hubCut(clear, dir, radA);
    const cutB = hubCut(clear, scale(dir, -1), radB);
    const cutLength = Math.max(1, chord - cutA - cutB);
    const endCutDegA = endCutDeg(dir, radA);
    const endCutDegB = endCutDeg(scale(dir, -1), radB);

    const adj = e.triangleIds.map((id) => triangles[id]).filter(Boolean);
    let bevelL = 0;
    let bevelR = 0;
    let bevelInner = 0;

    const mid = scale(add(A, B), 0.5);
    const radial = norm(sub(mid, center));
    // edge plane ≈ average of face normals or cross(dir, radial)
    let planeN;
    if (adj.length >= 1) {
      planeN = { ...adj[0].normal };
      if (adj.length === 2) {
        planeN = norm(add(adj[0].normal, adj[1].normal));
      }
    } else {
      planeN = norm(cross(dir, radial));
    }

    // Inner bevel: timber width faces inward toward sphere
    const inward = scale(radial, -1);
    const tipAlong = Math.abs(dot(inward, dir));
    const tipPerp = Math.sqrt(Math.max(0, 1 - tipAlong * tipAlong));
    const innerAngle = Math.atan2(tipPerp, tipAlong || 1e-9) - Math.PI / 2;
    // use small slope from plane vs radial
    const planeVsRad = Math.acos(Math.min(1, Math.max(-1, Math.abs(dot(planeN, radial)))));
    bevelInner = Math.tan(planeVsRad * 0.5) * (beamsWidth / 2);

    if (adj.length === 2) {
      const ang = angleByEdge.get(e.id) ?? Math.acos(
        Math.min(1, Math.max(-1, dot(adj[0].normal, adj[1].normal))),
      );
      const half = (Math.PI - ang) / 2;
      const sideOff = Math.tan(Math.max(0, half)) * (beamsThickness / 2);
      bevelL = sideOff;
      bevelR = sideOff;
    } else if (adj.length === 1) {
      bevelL = Math.tan(0.12) * (beamsThickness / 2);
      bevelR = 0;
    }

    // snap tiny bevels
    const thresh = beamsThickness / 100;
    if (Math.abs(bevelL) < thresh) bevelL = 0;
    if (Math.abs(bevelR) < thresh) bevelR = 0;
    if (Math.abs(bevelInner) < thresh) bevelInner = 0;

    void innerAngle;

    return {
      edgeId: e.id,
      startNodeId: e.startNodeId,
      endNodeId: e.endNodeId,
      category: e.category,
      chord,
      cutLength,
      cutA,
      cutB,
      endCutDegA,
      endCutDegB,
      width: beamsWidth,
      thickness: beamsThickness,
      bevelSides: [bevelL, bevelR],
      bevelInner,
      angleBetweenNormalsDeg:
        adj.length === 2
          ? ((angleByEdge.get(e.id) ?? 0) * 180) / Math.PI
          : null,
    };
  });

  const edgeGroups = groupBy(edgeProducts, (p) => {
    const L = Math.round(p.cutLength);
    const ends = [Math.round(p.endCutDegA), Math.round(p.endCutDegB)].sort(
      (a, b) => a - b,
    );
    const bL = Math.round(p.bevelSides[0] * 10);
    const bR = Math.round(p.bevelSides[1] * 10);
    const bi = Math.round(p.bevelInner * 10);
    return `${L}|${ends[0]}|${ends[1]}|${bL}|${bR}|${bi}|${p.category}`;
  });

  const faceProducts = buildFacePanels(
    nodes,
    triangles,
    edgeProducts,
    center,
    beamsThickness,
    beamsWidth,
    panelGapMm,
  );

  const faceGroups = groupBy(faceProducts, (p) =>
    faceKey(p.sideLengths, p.anglesDeg),
  );

  // adjacency for hubs
  const neighbors = nodes.map(() => []);
  for (const e of edges) {
    neighbors[e.startNodeId].push(e.endNodeId);
    neighbors[e.endNodeId].push(e.startNodeId);
  }

  const hubs = nodes.map((p, i) => {
    const rays = neighbors[i].map((j) => {
      const d = norm(sub(nodes[j], p));
      return { to: j, dir: d, length: len(sub(nodes[j], p)) };
    });
    const radial = norm(sub(p, center));
    const ref =
      Math.abs(radial.z) < 0.9
        ? cross(radial, { x: 0, y: 0, z: 1 })
        : cross(radial, { x: 1, y: 0, z: 0 });
    const u = norm(ref);
    const v = norm(cross(radial, u));
    rays.sort((ra, rb) => {
      const aa = Math.atan2(dot(ra.dir, v), dot(ra.dir, u));
      const bb = Math.atan2(dot(rb.dir, v), dot(rb.dir, u));
      return aa - bb;
    });
    for (const r of rays) {
      const c = Math.min(1, Math.max(-1, dot(r.dir, radial)));
      r.polarDeg = (Math.acos(c) * 180) / Math.PI;
    }
    const gapDeg = rays.map((r, k) => {
      const n = rays[(k + 1) % rays.length];
      if (!n) return 0;
      // azimuth gap in tangent plane (project dirs off radial)
      const pa = norm(sub(r.dir, scale(radial, dot(r.dir, radial))));
      const pb = norm(sub(n.dir, scale(radial, dot(n.dir, radial))));
      const ang = Math.atan2(dot(pb, v), dot(pb, u)) - Math.atan2(dot(pa, v), dot(pa, u));
      let deg = (ang * 180) / Math.PI;
      if (deg < 0) deg += 360;
      return deg;
    });
    // keep anglesDeg as 3D angle between rays for backward compat summaries
    const anglesDeg = rays.map((r, k) => {
      const n = rays[(k + 1) % rays.length];
      if (!n) return 0;
      return (
        (Math.acos(Math.min(1, Math.max(-1, dot(r.dir, n.dir)))) * 180) / Math.PI
      );
    });
    return {
      id: i,
      point: p,
      valence: rays.length,
      rays,
      gapDeg,
      anglesDeg,
      pipeD,
      base: p.z < 1e-3,
    };
  });

  const hubGroups = groupBy(
    hubs.filter((h) => h.valence > 0),
    (h) => {
      const tokens = h.rays.map((r, k) => {
        const g = Math.round(h.gapDeg[k]);
        const p = Math.round(r.polarDeg);
        return `${g},${p}`;
      });
      return `${h.valence}:${canonicalRing(tokens)}`;
    },
  );

  const timberTotal = edgeProducts.reduce((s, e) => s + e.cutLength, 0);
  const chordTotal = edgeProducts.reduce((s, e) => s + e.chord, 0);

  return {
    connectionType: 'Piped',
    pipeD,
    beamsWidth,
    beamsThickness,
    hubGapMm,
    panelGapMm,
    note:
      `Piped + timber: end face parallel to the pipe axis, gap ${hubGapMm} mm; ` +
      `panels from the top of the timber, gap ${panelGapMm} mm; bevels are an approximation. ` +
      'Not a safety certificate. Angle between normals is not the machine cut angle.',
    edgeProducts,
    edgeGroups,
    faceProducts,
    faceGroups,
    hubs,
    hubGroups,
    stats: {
      timberTotalMm: timberTotal,
      chordTotalMm: chordTotal,
      edgeTypeCount: edgeGroups.length,
      faceTypeCount: faceGroups.length,
      hubTypeCount: hubGroups.length,
    },
  };
}

/**
 * Cover panels from timber top faces (+axisZ). Contact line inset PANEL_GAP/2
 * toward each triangle; vertex = midpoint of closest approach of two lines.
 */
function buildFacePanels(
  nodes,
  triangles,
  edgeProducts,
  center,
  beamsThickness,
  beamsWidth,
  panelGap,
) {
  const halfGap = panelGap / 2;
  const prisms = edgeProducts.map((ep) => {
    const A = nodes[ep.startNodeId];
    const B = nodes[ep.endNodeId];
    return timberPrism(
      A,
      B,
      ep.cutA,
      ep.cutB,
      radialAt(A, center),
      radialAt(B, center),
      beamsThickness,
      beamsWidth,
    );
  });

  return triangles.map((t) => {
    const P = t.nodeIds.map((i) => nodes[i]);
    const centroid = {
      x: (P[0].x + P[1].x + P[2].x) / 3,
      y: (P[0].y + P[1].y + P[2].y) / 3,
      z: (P[0].z + P[1].z + P[2].z) / 3,
    };
    const lines = t.edgeIds.map((eid) =>
      topContactLine(prisms[eid], centroid, halfGap),
    );
    // corner i = closest approach of lines[i] and lines[(i+1)%3]
    // → sits at node shared by those two edges (nodeIds[(i+1)%3])
    const corners = [0, 1, 2].map((i) =>
      lineClosestMid(lines[i], lines[(i + 1) % 3]),
    );
    const sideLengths = [0, 1, 2].map((i) =>
      len(sub(corners[(i + 1) % 3], corners[i])),
    );
    const anglesDeg = [0, 1, 2].map((i) => {
      const prev = corners[(i + 2) % 3];
      const cur = corners[i];
      const next = corners[(i + 1) % 3];
      return (angleAt(cur, prev, next) * 180) / Math.PI;
    });
    const area = 0.5 * len(cross(sub(corners[1], corners[0]), sub(corners[2], corners[0])));
    return {
      id: t.id,
      nodeIds: t.nodeIds.slice(),
      edgeIds: t.edgeIds.slice(),
      corners,
      sideLengths,
      anglesDeg,
      area,
    };
  });
}

function radialAt(p, center) {
  return norm(sub(p, center));
}

/** Midline of timber top (+Z corners 2,3), shifted halfGap toward triangle. */
function topContactLine(prism, triCentroid, halfGap) {
  const midA = scale(add(prism.cornersA[2], prism.cornersA[3]), 0.5);
  const midB = scale(add(prism.cornersB[2], prism.cornersB[3]), 0.5);
  const mid = scale(add(midA, midB), 0.5);
  const across = norm(sub(prism.cornersA[2], prism.cornersA[3]));
  const sign = Math.sign(dot(across, sub(triCentroid, mid))) || 1;
  const shift = scale(across, sign * halfGap);
  return { a: add(midA, shift), b: add(midB, shift) };
}

/** Midpoint of shortest segment between two skew lines (infinite). */
function lineClosestMid(L1, L2) {
  const d1 = norm(sub(L1.b, L1.a));
  const d2 = norm(sub(L2.b, L2.a));
  const r = sub(L1.a, L2.a);
  const a = dot(d1, d1);
  const b = dot(d1, d2);
  const c = dot(d2, d2);
  const d = dot(d1, r);
  const e = dot(d2, r);
  const denom = a * c - b * b;
  let s;
  let t;
  if (Math.abs(denom) < 1e-12) {
    s = 0;
    t = c > 1e-12 ? e / c : 0;
  } else {
    s = (b * e - c * d) / denom;
    t = (a * e - b * d) / denom;
  }
  return scale(add(add(L1.a, scale(d1, s)), add(L2.a, scale(d2, t))), 0.5);
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

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const k = keyFn(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  const colors = palette(map.size);
  return [...map.entries()].map(([key, units], gi) => {
    const sample = units[0];
    return {
      key,
      index:
        String.fromCharCode(65 + (gi % 26)) +
        (gi >= 26 ? String(1 + Math.floor(gi / 26)) : ''),
      color: colors[gi],
      units,
      sample,
      count: units.length,
    };
  });
}

function palette(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const h = (i * 47) % 360;
    // comma form: THREE.Color rejects modern "hsl(h s% l%)"
    out.push(`hsl(${h}, 55%, 42%)`);
  }
  return out;
}
